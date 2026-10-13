/**
 * Memory consolidation — the Commonplace Book's missing verb.
 *
 * The book could append, reinforce, link, and delete; it could not *combine*.
 * This service folds clusters of a character's hot memories about one subject
 * into **digest** rows (`source: 'CONSOLIDATED'`) and sends the members to the
 * cold tier, superseded by the digest that replaced them
 * (docs/developer/features/complete/memory-consolidation-and-tiers.md §4).
 *
 * This module is the planner and the model route; the maintenance job's
 * `consolidate` phase (`maintenance/consolidate.ts`) feeds it and announces
 * what it wrote. One call of {@link consolidate}, per character:
 *
 *   1. **Buckets** arrive from the phase's loader: candidates are AUTO rows
 *      older than `matureAfterDays` with an embedding — hot rows, and cold rows
 *      demoted by the cap with no successor (`supersededById` null, bug 211) —
 *      bucketed by subject (self / another character / no subject), each with
 *      its hot digests as cluster seeds. MANUAL rows are never candidates.
 *   2. **Cluster** each bucket (`consolidation-clustering.ts`, pure) and pick
 *      the qualifying clusters by total `reinforcedImportance`, up to
 *      `maxClustersPerRun`. Clusters below the size floor have their
 *      never-considered rows stamped `consolidatedAt` so they are not rescanned
 *      every run; they re-qualify when a new neighbour arrives.
 *   3. **Consolidate**: one model call per cluster
 *      (`cheap-llm-tasks/consolidation-tasks.ts`), on
 *      `memoryConsolidation.connectionProfileId` or else the cheap LLM. A call
 *      that fails, times out, or answers out of schema skips its cluster —
 *      nothing is written for it, and its rows stay unconsidered so the next
 *      run retries them.
 *   4. **Plan, then write** (`consolidation-plan.ts`, pure). The whole batch is
 *      computed before a single write is issued. Digests are inserted directly
 *      with their embedding — never through admission, which would absorb a
 *      digest into its own members.
 *
 * It announces nothing: the frozen-archive invalidation, the realtime hint and
 * the `Commonplace/` mirror are the maintenance run's effects, after commit.
 * A dry run does steps 1–3 and plans step 4, and writes nothing.
 *
 * Concierge: consolidation reads across chats, so it inherits the posture of
 * the chats its members came from. A Locked member chat wins (no reroute, no
 * failover — the operator said never); otherwise an Unmoderated one routes the
 * call to the uncensored desk; otherwise the global Moderated policy applies.
 *
 * @module memory/consolidation
 */

import crypto from 'crypto'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getMemoryConsolidationSettings, type MemoryConsolidationSettings } from '@/lib/instance-settings'
import type { Character, ChatMetadata, ChatSettings, ConnectionProfile, Memory } from '@/lib/schemas/types'
import {
  buildCheapLLMConfig,
  resolveUncensoredCheapLLMSelection,
  selectionFromProfile,
  type CheapLLMSelection,
} from '@/lib/llm/cheap-llm'
import { selectCheapLLMFromProfiles } from '@/lib/llm/cheap-llm-user-selection'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import { getConciergeState, shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { memoryIndex, embeddingTextFor, lexicalEmbeddingTextFor } from './index-store'
import { refreshMemoryTimeZone } from './time/calendar-refresh'
import { resolveClusterThreshold } from './settings-defaults'
import {
  clusterBucket,
  selectClusters,
  type Cluster,
  type ClusterItem,
} from './consolidation-clustering'
import {
  planConsolidationWrites,
  type ConsolidationWritePlan,
  type LinkIndexRow,
  type PlannedDigest,
  type ResolvedClusterOutcome,
} from './consolidation-plan'
import {
  consolidateMemoryCluster,
  type ConsolidationCallInput,
  type ConsolidationContradiction,
} from './cheap-llm-tasks/consolidation-tasks'
import {
  loadCanonForObserverAboutSubject,
  loadCanonForSelfWithCommonplace,
  renderOtherCanonBlock,
  renderSelfCanonBlock,
} from './cheap-llm-tasks/canon'
import type { UncensoredFallbackOptions } from './cheap-llm-tasks/types'

const log = logger.child({ module: 'memory:consolidation' })

const DAY_MS = 86_400_000

// ============================================================================
// Public types
// ============================================================================

/** Which subject bucket a cluster belongs to. */
export interface ConsolidationBucketRef {
  /** 'self' = about the holder; 'other' = about another character; 'none' = no subject. */
  kind: 'self' | 'other' | 'none'
  /** The subject's character id (the holder's for self; null for none). */
  subjectCharacterId: string | null
  subjectName: string
}

/** One digest as reported. */
export interface ConsolidationDigestReport {
  /** Planned id — the new row's id, or the existing digest's id for an update. */
  id: string
  action: 'create' | 'update'
  content: string
  summary: string
  keywords: string[]
  importance: number
  reinforcedImportance: number
  reinforcementCount: number
  kind: 'semantic' | 'episodic'
  occurredAt: string | null
  memberIds: string[]
}

/** One attempted (or dry-run) cluster. */
export interface ConsolidationClusterReport {
  bucket: ConsolidationBucketRef
  clusterKind: 'semantic' | 'episodic'
  /** Non-digest member ids, oldest first. */
  memberIds: string[]
  /** Member contents, same order as `memberIds`. */
  memberContents: string[]
  /** The digest this cluster formed around, if any. */
  existingDigestId: string | null
  existingDigestContent: string | null
  digests: ConsolidationDigestReport[]
  keepStandalone: string[]
  contradictions: ConsolidationContradiction[]
  /**
   * 'planned' (dry run), 'written', 'failed' (the call failed or timed out),
   * 'invalid' (the answer failed the schema or membership rules),
   * 'embedding-failed' (a digest could not be embedded — nothing written).
   */
  status: 'planned' | 'written' | 'failed' | 'invalid' | 'embedding-failed'
  error?: string
}

export interface ConsolidationStats {
  rowsLoaded: number
  candidates: number
  /** Candidates that were cold — demoted by housekeeping, never superseded (bug 211). */
  demotedCandidates: number
  digestsLoaded: number
  immatureSkipped: number
  noEmbeddingSkipped: number
  bucketsScanned: number
  bucketRowsCapped: number
  clustersFound: number
  clustersQualified: number
  clustersSelected: number
  clustersDeferred: number
  clustersBelowMin: number
  clustersStale: number
  clustersAttempted: number
  clustersSucceeded: number
  clustersFailed: number
  clustersLostToTimeout: number
  digestsCreated: number
  digestsUpdated: number
  membersSuperseded: number
  contradictionsApplied: number
  rowsMarkedConsidered: number
  linksRewired: number
  /** True when the run stopped issuing calls because its time budget ran out. */
  budgetExhausted: boolean
  durationMs: number
}

export interface ConsolidationReport {
  characterId: string
  characterName: string | null
  dryRun: boolean
  trigger: 'scheduled' | 'watermark' | 'manual'
  startedAt: string
  finishedAt: string
  /** The settings the run actually used (stored settings + overrides). */
  settings: MemoryConsolidationSettings
  clusters: ConsolidationClusterReport[]
  stats: ConsolidationStats
  /** Set when the run did nothing at all, and why. */
  skippedReason?: 'no-llm'
}

export interface RunConsolidationOptions {
  /** Cluster and call the model, but write nothing. */
  dryRun?: boolean
  /** Override `maxClustersPerRun`. */
  maxClustersPerRun?: number
  /** Override any stored setting for this run (tuning a dry run, say). */
  settings?: Partial<MemoryConsolidationSettings>
  /** The user whose profiles and embedding provider to use; defaults to the character's owner. */
  userId?: string
  /**
   * Stop issuing model calls after this long (ms) and commit what is done; the
   * rest waits for the next run. The job handler sets one so a run stays
   * inside the dispatcher's stuck-job window. Unset → no budget.
   */
  timeBudgetMs?: number
  /** Recorded in the report and logs. Defaults to 'manual'. */
  trigger?: 'scheduled' | 'watermark' | 'manual'
  /** Clock override for tests. */
  now?: Date
}

// ============================================================================
// Internals
// ============================================================================

/** One subject bucket: its candidate rows and the hot digests that seed its clusters. */
export interface ConsolidationBucket {
  key: string
  ref: ConsolidationBucketRef
  /** `aboutCharacterId` digests in this bucket carry. */
  aboutCharacterId: string | null
  rows: Memory[]
  digests: Memory[]
}

type TaggedCluster = Cluster & { bucketKey: string }

export function createConsolidationStats(): ConsolidationStats {
  return {
    rowsLoaded: 0,
    candidates: 0,
    demotedCandidates: 0,
    digestsLoaded: 0,
    immatureSkipped: 0,
    noEmbeddingSkipped: 0,
    bucketsScanned: 0,
    bucketRowsCapped: 0,
    clustersFound: 0,
    clustersQualified: 0,
    clustersSelected: 0,
    clustersDeferred: 0,
    clustersBelowMin: 0,
    clustersStale: 0,
    clustersAttempted: 0,
    clustersSucceeded: 0,
    clustersFailed: 0,
    clustersLostToTimeout: 0,
    digestsCreated: 0,
    digestsUpdated: 0,
    membersSuperseded: 0,
    contradictionsApplied: 0,
    rowsMarkedConsidered: 0,
    linksRewired: 0,
    budgetExhausted: false,
    durationMs: 0,
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export function hasEmbedding(memory: Memory): memory is Memory & { embedding: Float32Array } {
  return memory.embedding instanceof Float32Array && memory.embedding.length > 0
}

export function eventTimeMs(memory: Memory): number | null {
  const iso = memory.occurredAt ?? memory.createdAt
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function toClusterItem(memory: Memory & { embedding: Float32Array }): ClusterItem {
  const created = Date.parse(memory.createdAt)
  const considered = memory.consolidatedAt ? Date.parse(memory.consolidatedAt) : NaN
  return {
    id: memory.id,
    embedding: memory.embedding,
    kind: memory.kind ?? 'semantic',
    isDigest: memory.source === 'CONSOLIDATED',
    eventTimeMs: eventTimeMs(memory),
    createdAtMs: Number.isFinite(created) ? created : 0,
    consideredAtMs: Number.isFinite(considered) ? considered : null,
    weight: memory.reinforcedImportance ?? memory.importance ?? 0.5,
  }
}

interface ModelRoute {
  base: CheapLLMSelection
  availableProfiles: ConnectionProfile[]
  chatSettings: ChatSettings | null
}

/** The configured consolidation profile, else the user's cheap LLM. */
async function resolveModelRoute(
  settings: MemoryConsolidationSettings,
  userId: string,
): Promise<ModelRoute | null> {
  const repos = getRepositories()
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const availableProfiles = await repos.connections.findByUserId(userId)

  if (settings.connectionProfileId) {
    const profile = availableProfiles.find((p) => p.id === settings.connectionProfileId)
    if (profile) {
      log.debug('Consolidation using its configured connection profile', {
        connectionProfileId: profile.id,
        provider: profile.provider,
        model: profile.modelName,
      })
      return { base: selectionFromProfile(profile, { localBaseUrlFallback: true }), availableProfiles, chatSettings }
    }
    log.warn('Configured consolidation profile no longer exists; falling back to the cheap LLM', {
      connectionProfileId: settings.connectionProfileId,
    })
  }

  const resolved = selectCheapLLMFromProfiles(availableProfiles, buildCheapLLMConfig(chatSettings))
  if (!resolved) return null
  return { base: resolved.selection, availableProfiles, chatSettings }
}

/** Route one cluster's call under the Concierge posture of its members' chats. */
async function routeForCluster(
  route: ModelRoute,
  members: readonly Memory[],
  chatCache: Map<string, ChatMetadata | null>,
): Promise<{ selection: CheapLLMSelection; uncensoredFallback?: UncensoredFallbackOptions; policyChatId: string | null }> {
  const repos = getRepositories()
  const chatIds = Array.from(new Set(members.map((m) => m.chatId).filter((id): id is string => !!id)))
  let locked: ChatMetadata | null = null
  let unmoderated: ChatMetadata | null = null
  for (const chatId of chatIds) {
    let chat = chatCache.get(chatId)
    if (chat === undefined) {
      try {
        chat = await repos.chats.findById(chatId)
      } catch {
        chat = null
      }
      chatCache.set(chatId, chat ?? null)
    }
    if (!chat) continue
    const state = getConciergeState(chat)
    if (state === 'locked' && !locked) locked = chat
    if (state === 'unmoderated' && !unmoderated) unmoderated = chat
  }
  const policyChat = locked ?? unmoderated
  const policy = resolveConciergeSettings(route.chatSettings, policyChat)
  const dangerous = !!policyChat && shouldUseUncensoredRoute(policyChat)
  const selection = dangerous
    ? resolveUncensoredCheapLLMSelection(route.base, true, policy, route.availableProfiles)
    : route.base
  const uncensoredFallback = policy.failoverAllowed
    ? { conciergePolicy: policy, availableProfiles: route.availableProfiles, isDangerousChat: dangerous }
    : undefined
  return { selection, uncensoredFallback, policyChatId: policyChat?.id ?? null }
}

/** Fill in subject names and canon blocks for the buckets that will be consolidated. */
async function describeBuckets(
  holder: Character,
  buckets: Map<string, ConsolidationBucket>,
  keys: ReadonlySet<string>,
): Promise<Map<string, string | null>> {
  const repos = getRepositories()
  const canon = new Map<string, string | null>()
  for (const bucket of buckets.values()) {
    if (!keys.has(bucket.key)) continue
    if (bucket.ref.kind === 'self') {
      bucket.ref.subjectName = holder.name
      // The card fields plus `Commonplace/Self.md`, as the extractor reads them.
      canon.set(
        bucket.key,
        renderSelfCanonBlock(
          await loadCanonForSelfWithCommonplace({
            id: holder.id,
            name: holder.name,
            manifesto: holder.manifesto ?? null,
            personality: holder.personality ?? null,
            description: holder.description ?? null,
            identity: holder.identity ?? null,
            mountPointId: holder.characterDocumentMountPointId ?? null,
          }),
        ),
      )
      continue
    }
    if (bucket.ref.kind === 'none') {
      bucket.ref.subjectName = '(no subject)'
      canon.set(bucket.key, null)
      continue
    }
    const subjectId = bucket.ref.subjectCharacterId as string
    // The overlay read carries the vault-managed identity/description; a
    // broken vault throws, so fall back to the raw row for name-only canon.
    let subject: Character | null = null
    try {
      subject = await repos.characters.findById(subjectId)
    } catch {
      subject = null
    }
    if (!subject) {
      try {
        subject = await repos.characters.findByIdRaw(subjectId)
      } catch {
        subject = null
      }
    }
    if (!subject) {
      bucket.ref.subjectName = 'an unnamed acquaintance'
      canon.set(bucket.key, null)
      continue
    }
    bucket.ref.subjectName = subject.name
    try {
      const source = await loadCanonForObserverAboutSubject(
        { characterId: holder.id, mountPointId: holder.characterDocumentMountPointId ?? null },
        {
          id: subject.id,
          name: subject.name,
          identity: subject.identity ?? null,
          description: subject.description ?? null,
        },
        // The cluster is handed its digest directly; the mirror would only echo it.
        { includeCommonplace: false },
      )
      canon.set(bucket.key, renderOtherCanonBlock(source))
    } catch (error) {
      log.debug('Subject canon unavailable for consolidation; continuing without it', {
        characterId: holder.id,
        subjectId,
        error: error instanceof Error ? error.message : String(error),
      })
      canon.set(bucket.key, null)
    }
  }
  return canon
}

function digestReport(d: PlannedDigest): ConsolidationDigestReport {
  return {
    id: d.id,
    action: d.action,
    content: d.content,
    summary: d.summary,
    keywords: d.keywords,
    importance: d.importance,
    reinforcedImportance: d.reinforcedImportance,
    reinforcementCount: d.reinforcementCount,
    kind: d.kind,
    occurredAt: d.occurredAt,
    memberIds: d.memberIds,
  }
}

/** Issue a plan's writes. In the job child every call buffers; the parent commits them as one batch. */
async function executePlan(
  characterId: string,
  plan: ConsolidationWritePlan,
  extraConsidered: readonly string[],
  nowIso: string,
): Promise<void> {
  const repos = getRepositories()

  for (const create of plan.creates) {
    // The vector rides in the create itself, so a digest never exists
    // without it; the index then caches it without a second write.
    await repos.memories.create(
      create.embedding ? { ...create.data, embedding: create.embedding } : create.data,
      { id: create.id, createdAt: nowIso, updatedAt: nowIso },
    )
    if (create.embedding) {
      await memoryIndex.indexInserted(characterId, [{ id: create.id, embedding: create.embedding, tier: 'hot' }])
    }
    log.debug('Digest created', { characterId, memoryId: create.id, members: create.memberIds.length })
  }

  for (const update of plan.updates) {
    if (update.embedding) {
      // The revised text and its vector land in one row update.
      await memoryIndex.upsert(characterId, [
        { id: update.id, embedding: update.embedding, tier: 'hot', alongside: update.patch },
      ])
    } else {
      await repos.memories.updateForCharacter(characterId, update.id, update.patch)
    }
    log.debug('Digest revised in place', { characterId, memoryId: update.id, newMembers: update.memberIds.length })
  }

  for (const move of plan.tierMoves) {
    await memoryIndex.setTier(characterId, move.ids, 'cold', {
      supersededById: move.supersededById,
      consolidatedAt: nowIso,
    })
  }

  const considered = Array.from(new Set([...plan.considered, ...extraConsidered]))
  if (considered.length > 0) {
    await repos.memories.markConsidered(characterId, considered, nowIso)
  }

  for (const rewrite of plan.linkRewrites) {
    await repos.memories.updateForCharacter(characterId, rewrite.id, { relatedMemoryIds: rewrite.relatedMemoryIds })
  }
}

/**
 * The digest subjects a plan touches — the buckets whose Commonplace files the
 * run changes. The no-subject bucket has no mirror and is left out.
 */
function touchedSubjects(
  buckets: Map<string, ConsolidationBucket>,
  plan: ConsolidationWritePlan,
  bucketKeyByOutcome: readonly string[],
): string[] {
  const subjects = new Set<string>()
  for (const digest of [...plan.creates, ...plan.updates]) {
    const bucket = buckets.get(bucketKeyByOutcome[digest.clusterIndex])
    if (bucket?.aboutCharacterId) subjects.add(bucket.aboutCharacterId)
  }
  return Array.from(subjects)
}

// ============================================================================
// Entry point
// ============================================================================

/** What {@link consolidate} is handed: the holder and its bucketed corpus. */
export interface ConsolidationInput {
  /** The holder, with its vault overlay when it could be read. */
  holder: Character
  /** Every row the holder has (links only), for the link rewrites. */
  rowIndex: Map<string, LinkIndexRow>
  buckets: Map<string, ConsolidationBucket>
  /** Stats seeded by the loader (rows, candidates, skips). */
  stats: ConsolidationStats
}

export interface ConsolidationRun {
  report: ConsolidationReport
  /** The writes the run issued, or would have issued in a dry run. */
  plan: ConsolidationWritePlan
  /** Rows of clusters too small to fold, stamped considered with the plan. */
  belowMinConsidered: string[]
  /** Digest subjects whose Commonplace files the run changes. */
  touchedSubjects: string[]
}

/**
 * Consolidate one character's bucketed candidates: cluster, call the model per
 * cluster, plan, embed the digests, and (unless a dry run) issue the writes.
 * It announces nothing — the maintenance run does that after the writes
 * commit. Never throws for an ordinary failure (a bad call, a missing vault).
 */
export async function consolidate(
  input: ConsolidationInput,
  opts: RunConsolidationOptions = {},
): Promise<ConsolidationRun> {
  const startedMs = Date.now()
  const now = opts.now ?? new Date()
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const dryRun = opts.dryRun === true
  const trigger = opts.trigger ?? 'manual'
  const settings: MemoryConsolidationSettings = {
    ...(await getMemoryConsolidationSettings()),
    ...(opts.settings ?? {}),
  }
  const maxClusters = opts.maxClustersPerRun ?? settings.maxClustersPerRun
  const { holder, rowIndex, buckets, stats } = input
  const characterId = holder.id
  const clusterReports: ConsolidationClusterReport[] = []
  const userId = opts.userId ?? holder.userId

  const finish = (extra: Partial<ConsolidationReport> = {}): ConsolidationReport => {
    stats.durationMs = Date.now() - startedMs
    return {
      characterId,
      characterName: holder.name,
      dryRun,
      trigger,
      startedAt: nowIso,
      finishedAt: new Date().toISOString(),
      settings,
      clusters: clusterReports,
      stats,
      ...extra,
    }
  }

  // The clustered vectors are the default profile's; cluster on its scale.
  let embeddingProvider: string | null = null
  try {
    embeddingProvider = (await getRepositories().embeddingProfiles.findDefault(userId))?.provider ?? null
  } catch (error) {
    log.debug('Could not read the default embedding profile; clustering on the neural scale', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  settings.clusterThreshold = resolveClusterThreshold(settings, embeddingProvider, opts.settings?.clusterThreshold)

  log.debug('Consolidation starting', {
    characterId,
    trigger,
    dryRun,
    maxClusters,
    clusterThreshold: settings.clusterThreshold,
    embeddingProvider,
    minClusterSize: settings.minClusterSize,
    maxClusterSize: settings.maxClusterSize,
    matureAfterDays: settings.matureAfterDays,
    timeBudgetMs: opts.timeBudgetMs ?? null,
  })

  const rowsById = new Map<string, Memory>()
  const digestsById = new Map<string, Memory>()
  for (const bucket of buckets.values()) {
    for (const row of bucket.rows) rowsById.set(row.id, row)
    for (const digest of bucket.digests) digestsById.set(digest.id, digest)
  }

  // ── 2. Cluster ────────────────────────────────────────────────────────────
  const itemsById = new Map<string, ClusterItem>()
  const allClusters: TaggedCluster[] = []
  for (const bucket of buckets.values()) {
    if (bucket.rows.length === 0) continue
    stats.bucketsScanned++
    const items = [...bucket.digests, ...bucket.rows]
      .filter(hasEmbedding)
      .map(toClusterItem)
    for (const item of items) itemsById.set(item.id, item)
    const clusters = clusterBucket(items, {
      threshold: settings.clusterThreshold,
      maxClusterSize: settings.maxClusterSize,
    })
    for (const cluster of clusters) allClusters.push({ ...cluster, bucketKey: bucket.key })
    log.debug('Bucket clustered', {
      characterId,
      bucket: bucket.key,
      rows: bucket.rows.length,
      digests: bucket.digests.length,
      clusters: clusters.length,
    })
    await yieldToEventLoop()
  }
  stats.clustersFound = allClusters.length

  const selection = selectClusters(allClusters, itemsById, {
    minClusterSize: settings.minClusterSize,
    matureAfterDays: settings.matureAfterDays,
    maxClusters,
    nowMs,
  })
  stats.clustersQualified = selection.selected.length + selection.deferred.length
  stats.clustersSelected = selection.selected.length
  stats.clustersDeferred = selection.deferred.length
  stats.clustersBelowMin = selection.belowMin.length
  stats.clustersStale = selection.stale.length

  // Rows in clusters too small to fold: stamp them so they are not rescanned.
  const belowMinConsidered = selection.belowMin.flatMap((c) =>
    c.memberIds.filter((id) => itemsById.get(id)?.consideredAtMs === null),
  )

  // ── 3. Consolidate ────────────────────────────────────────────────────────
  const outcomes: ResolvedClusterOutcome[] = []
  const outcomeReportIndex: number[] = []
  const outcomeBucketKey: string[] = []
  let route: ModelRoute | null = null
  if (selection.selected.length > 0) {
    route = await resolveModelRoute(settings, userId)
    if (!route) {
      log.warn('Consolidation has clusters to fold but no model to fold them with', { characterId })
    }
  }

  const canonByBucket = route
    ? await describeBuckets(holder, buckets, new Set(selection.selected.map((c) => c.bucketKey)))
    : new Map<string, string | null>()
  const chatCache = new Map<string, ChatMetadata | null>()

  for (let i = 0; route && i < selection.selected.length; i++) {
    if (opts.timeBudgetMs !== undefined && Date.now() - startedMs > opts.timeBudgetMs) {
      stats.budgetExhausted = true
      stats.clustersDeferred += selection.selected.length - i
      log.info('Consolidation time budget spent; remaining clusters wait for the next run', {
        characterId,
        remaining: selection.selected.length - i,
        timeBudgetMs: opts.timeBudgetMs,
      })
      break
    }
    const cluster = selection.selected[i]
    const bucket = buckets.get(cluster.bucketKey)!
    const members = cluster.memberIds
      .map((id) => rowsById.get(id))
      .filter((m): m is Memory => m !== undefined)
      .sort((a, b) => (eventTimeMs(a) ?? 0) - (eventTimeMs(b) ?? 0))
    const existingDigest = cluster.digestId ? digestsById.get(cluster.digestId) ?? null : null
    const handleToId = new Map<string, string>()
    const callInput: ConsolidationCallInput = {
      holderName: holder.name,
      subjectName: bucket.ref.subjectName,
      bucket: bucket.ref.kind,
      clusterKind: cluster.kind,
      canonBlock: canonByBucket.get(bucket.key) ?? null,
      existingDigest: existingDigest?.content ?? null,
      members: members.map((m, idx) => {
        const handle = `m${idx + 1}`
        handleToId.set(handle, m.id)
        return {
          handle,
          when: m.occurredAt ?? m.createdAt,
          importance: m.reinforcedImportance ?? m.importance,
          reinforcementCount: m.reinforcementCount ?? 1,
          content: m.content,
        }
      }),
    }

    const report: ConsolidationClusterReport = {
      bucket: { ...bucket.ref },
      clusterKind: cluster.kind,
      memberIds: members.map((m) => m.id),
      memberContents: members.map((m) => m.content),
      existingDigestId: existingDigest?.id ?? null,
      existingDigestContent: existingDigest?.content ?? null,
      digests: [],
      keepStandalone: [],
      contradictions: [],
      status: 'failed',
    }
    clusterReports.push(report)
    stats.clustersAttempted++

    const routed = await routeForCluster(route, existingDigest ? [existingDigest, ...members] : members, chatCache)
    const result = await consolidateMemoryCluster(callInput, routed.selection, userId, {
      characterId,
      uncensoredFallback: routed.uncensoredFallback,
    })

    if (!result.success || !result.result) {
      report.status = 'failed'
      report.error = result.error ?? 'no result'
      stats.clustersFailed++
      if (result.timedOut) stats.clustersLostToTimeout++
      log.warn('Consolidation call failed; cluster skipped', {
        characterId,
        bucket: bucket.key,
        members: members.length,
        timedOut: result.timedOut ?? false,
        error: report.error,
      })
      continue
    }
    if (!result.result.ok) {
      report.status = 'invalid'
      report.error = result.result.reason
      stats.clustersFailed++
      log.warn('Consolidation answer failed validation; cluster skipped', {
        characterId,
        bucket: bucket.key,
        members: members.length,
        reason: result.result.reason,
      })
      continue
    }

    const toId = (handle: string): string => handleToId.get(handle) as string
    const validated = result.result.value
    const outcome: ResolvedClusterOutcome = {
      aboutCharacterId: bucket.aboutCharacterId,
      clusterKind: cluster.kind,
      existingDigest,
      members,
      digests: validated.digests.map((d) => ({ ...d, memberIds: d.memberIds.map(toId) })),
      keepStandalone: validated.keepStandalone.map(toId),
      contradictions: validated.contradictions.map((c) => ({ ...c, olderId: toId(c.olderId), newerId: toId(c.newerId) })),
      embeddings: validated.digests.map(() => null),
    }
    report.keepStandalone = outcome.keepStandalone
    report.contradictions = outcome.contradictions
    report.status = dryRun ? 'planned' : 'written'
    outcomes.push(outcome)
    outcomeReportIndex.push(clusterReports.length - 1)
    outcomeBucketKey.push(bucket.key)
    log.debug('Cluster consolidated', {
      characterId,
      bucket: bucket.key,
      clusterKind: cluster.kind,
      members: members.length,
      digests: outcome.digests.length,
      standalone: outcome.keepStandalone.length,
      unlisted: validated.unlisted.length,
      contradictions: outcome.contradictions.length,
      policyChatId: routed.policyChatId,
    })
  }

  // ── 4. Plan (and embed), then write ──────────────────────────────────────
  const makePlan = (list: ResolvedClusterOutcome[]) =>
    planConsolidationWrites({ characterId, clusters: list, rowIndex, nowIso, newId: () => crypto.randomUUID() })

  let finalOutcomes = outcomes
  let finalReportIndex = outcomeReportIndex
  let finalBucketKey = outcomeBucketKey
  let plan = makePlan(finalOutcomes)

  if (!dryRun && outcomes.length > 0) {
    // Embed every planned digest from its final fields; a digest that cannot
    // be embedded would be invisible to recall and the gate, so its whole
    // cluster is dropped (no partial writes) and the plan rebuilt without it.
    const failed = new Set<number>()
    // Anchor dates render on the instance's memory calendar (cold cache in the child).
    const memoryTimeZone = await refreshMemoryTimeZone()
    for (const digest of [...plan.creates, ...plan.updates]) {
      if (failed.has(digest.clusterIndex)) continue
      try {
        const result = await generateEmbeddingForUser(
          embeddingTextFor({
            summary: digest.summary,
            content: digest.content,
            occurredAt: digest.occurredAt,
            narrativeTime: digest.narrativeTime,
            entities: digest.entities,
          }, memoryTimeZone),
          userId,
          undefined,
          { priority: 'background', lexicalText: lexicalEmbeddingTextFor(digest) },
        )
        const k = plan.digestsByCluster[digest.clusterIndex].findIndex((d) => d.id === digest.id)
        outcomes[digest.clusterIndex].embeddings[k] = result.embedding
      } catch (error) {
        failed.add(digest.clusterIndex)
        log.warn('Digest embedding failed; its cluster is skipped', {
          characterId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (failed.size > 0) {
      for (const index of failed) {
        const report = clusterReports[outcomeReportIndex[index]]
        report.status = 'embedding-failed'
        report.error = 'digest embedding failed'
        stats.clustersFailed++
      }
      const keep = outcomes.map((_, idx) => idx).filter((idx) => !failed.has(idx))
      finalOutcomes = keep.map((idx) => outcomes[idx])
      finalReportIndex = keep.map((idx) => outcomeReportIndex[idx])
      finalBucketKey = keep.map((idx) => outcomeBucketKey[idx])
    }
    // Re-plan with the embeddings attached (and failed clusters gone).
    plan = makePlan(finalOutcomes)
  }

  plan.digestsByCluster.forEach((digests, idx) => {
    clusterReports[finalReportIndex[idx]].digests = digests.map(digestReport)
  })
  stats.clustersSucceeded = finalOutcomes.length
  stats.digestsCreated = plan.creates.length
  stats.digestsUpdated = plan.updates.length
  stats.membersSuperseded = plan.tierMoves.reduce((sum, m) => sum + m.ids.length, 0)
  stats.contradictionsApplied = finalOutcomes.reduce((sum, o) => sum + o.contradictions.length, 0)
  stats.linksRewired = plan.linkRewrites.length
  stats.rowsMarkedConsidered = new Set([...plan.considered, ...belowMinConsidered]).size

  if (!dryRun) {
    await executePlan(characterId, plan, belowMinConsidered, nowIso)
  }
  const touched = touchedSubjects(buckets, plan, finalBucketKey)

  const report = finish(route || selection.selected.length === 0 ? {} : { skippedReason: 'no-llm' })
  log.info('Consolidation run complete', {
    characterId,
    characterName: holder.name,
    trigger,
    dryRun,
    candidates: stats.candidates,
    demotedCandidates: stats.demotedCandidates,
    digestsLoaded: stats.digestsLoaded,
    clustersFound: stats.clustersFound,
    clustersSelected: stats.clustersSelected,
    clustersSucceeded: stats.clustersSucceeded,
    clustersFailed: stats.clustersFailed,
    clustersDeferred: stats.clustersDeferred,
    digestsCreated: stats.digestsCreated,
    digestsUpdated: stats.digestsUpdated,
    membersSuperseded: stats.membersSuperseded,
    rowsMarkedConsidered: stats.rowsMarkedConsidered,
    linksRewired: stats.linksRewired,
    budgetExhausted: stats.budgetExhausted,
    durationMs: stats.durationMs,
  })
  return { report, plan, belowMinConsidered, touchedSubjects: touched }
}
