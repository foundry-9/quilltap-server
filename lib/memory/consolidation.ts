/**
 * Memory consolidation — the Commonplace Book's missing verb.
 *
 * The book could append, reinforce, link, and delete; it could not *combine*.
 * This service folds clusters of a character's hot memories about one subject
 * into **digest** rows (`source: 'CONSOLIDATED'`) and sends the members to the
 * cold tier, superseded by the digest that replaced them
 * (docs/developer/features/memory-consolidation-and-tiers.md §4).
 *
 * One run, per character:
 *
 *   1. **Load** (paged, yielding between pages): every row feeds the link
 *      index; hot AUTO rows older than `matureAfterDays` with an embedding are
 *      candidates, bucketed by subject (self / another character / no subject);
 *      each bucket's existing hot digests come along as cluster seeds. MANUAL
 *      rows are never candidates — nothing sends a hand-written row cold.
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
 *   4. **Plan, then write** (`consolidation-plan.ts`, pure). The job runs in
 *      the forked child, whose reads never see its own buffered writes, so the
 *      whole batch is computed before a single write is issued. Digests are
 *      inserted directly with their embedding — never through the memory gate,
 *      which would absorb a digest into its own members.
 *   5. **Mirror** each touched bucket's digests into the holder's vault
 *      (`Commonplace/<Subject>.md`, `Commonplace/Self.md`) through the
 *      host-RPC bridge, where the extractor's canon loaders read them back.
 *
 * A dry run does steps 1–3 and plans step 4, writes nothing, and returns the
 * report. {@link runConsolidation} is callable in-process (CLI, API) as well
 * as from the MEMORY_CONSOLIDATION job handler.
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
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { publishRealtime } from '@/lib/realtime/bus'
import { buildMemoryEmbeddingText } from './episodic'
import { invalidateFrozenArchive } from './frozen-archive-cache'
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
  loadCanonForSelf,
  renderOtherCanonBlock,
  renderSelfCanonBlock,
} from './cheap-llm-tasks/canon'
import type { UncensoredFallbackOptions } from './cheap-llm-tasks/types'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import type { CommonplaceDigestEntry } from './commonplace-file'

const log = logger.child({ module: 'memory:consolidation' })

/** Rows per page when loading a character's corpus. */
export const CONSOLIDATION_LOAD_PAGE_SIZE = 250

/**
 * Most candidate rows clustered per subject bucket in one run. Clustering is
 * O(n²) in memory and time; a bucket past this keeps its never-considered rows
 * first, then the weightiest, and the rest wait for the next run.
 */
export const CONSOLIDATION_MAX_BUCKET_ROWS = 2000

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
  mirrorFilesWritten: number
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
  skippedReason?: 'character-not-found' | 'archived' | 'no-llm'
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

interface Bucket {
  key: string
  ref: ConsolidationBucketRef
  /** `aboutCharacterId` digests in this bucket carry. */
  aboutCharacterId: string | null
  rows: Memory[]
  digests: Memory[]
  /** False when the subject character no longer exists — no mirror file then. */
  subjectExists: boolean
}

type TaggedCluster = Cluster & { bucketKey: string }

function emptyStats(): ConsolidationStats {
  return {
    rowsLoaded: 0,
    candidates: 0,
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
    mirrorFilesWritten: 0,
    budgetExhausted: false,
    durationMs: 0,
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function bucketKeyOf(memory: Memory, holderId: string): string {
  const about = memory.aboutCharacterId ?? null
  if (!about) return 'none'
  if (about === holderId) return 'self'
  return `other:${about}`
}

function hasEmbedding(memory: Memory): memory is Memory & { embedding: Float32Array } {
  return memory.embedding instanceof Float32Array && memory.embedding.length > 0
}

function eventTimeMs(memory: Memory): number | null {
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

/** Load the corpus: the full link index plus per-bucket candidates and digests. */
async function loadCorpus(
  characterId: string,
  matureCutoffMs: number,
  stats: ConsolidationStats,
): Promise<{ rowIndex: Map<string, LinkIndexRow>; buckets: Map<string, Bucket> }> {
  const repos = getRepositories()
  const rowIndex = new Map<string, LinkIndexRow>()
  const buckets = new Map<string, Bucket>()

  const bucketFor = (memory: Memory): Bucket => {
    const key = bucketKeyOf(memory, characterId)
    let bucket = buckets.get(key)
    if (!bucket) {
      const about = memory.aboutCharacterId ?? null
      bucket = {
        key,
        ref: {
          kind: key === 'self' ? 'self' : key === 'none' ? 'none' : 'other',
          subjectCharacterId: key === 'none' ? null : about,
          subjectName: '',
        },
        aboutCharacterId: key === 'none' ? null : about,
        rows: [],
        digests: [],
        subjectExists: key !== 'none',
      }
      buckets.set(key, bucket)
    }
    return bucket
  }

  for await (const page of repos.memories.findByCharacterIdInBatches(characterId, CONSOLIDATION_LOAD_PAGE_SIZE)) {
    for (const memory of page) {
      stats.rowsLoaded++
      rowIndex.set(memory.id, { id: memory.id, relatedMemoryIds: memory.relatedMemoryIds ?? [] })
      if ((memory.tier ?? 'hot') !== 'hot') continue

      if (memory.source === 'CONSOLIDATED') {
        if (!hasEmbedding(memory)) {
          stats.noEmbeddingSkipped++
          continue
        }
        bucketFor(memory).digests.push(memory)
        stats.digestsLoaded++
        continue
      }
      // Hand-written rows are never sent cold by policy (spec §B4).
      if (memory.source !== 'AUTO') continue
      const created = Date.parse(memory.createdAt)
      if (!Number.isFinite(created) || created > matureCutoffMs) {
        stats.immatureSkipped++
        continue
      }
      if (!hasEmbedding(memory)) {
        stats.noEmbeddingSkipped++
        continue
      }
      bucketFor(memory).rows.push(memory)
      stats.candidates++
    }
    await yieldToEventLoop()
  }

  return { rowIndex, buckets }
}

/** Cap a bucket's candidate rows: never-considered first, then weightiest. */
function capBucketRows(rows: Memory[]): Memory[] {
  if (rows.length <= CONSOLIDATION_MAX_BUCKET_ROWS) return rows
  return [...rows]
    .sort((a, b) => {
      const ac = a.consolidatedAt ? 1 : 0
      const bc = b.consolidatedAt ? 1 : 0
      if (ac !== bc) return ac - bc
      return (b.reinforcedImportance ?? 0) - (a.reinforcedImportance ?? 0)
    })
    .slice(0, CONSOLIDATION_MAX_BUCKET_ROWS)
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
  buckets: Map<string, Bucket>,
  keys: ReadonlySet<string>,
): Promise<Map<string, string | null>> {
  const repos = getRepositories()
  const canon = new Map<string, string | null>()
  for (const bucket of buckets.values()) {
    if (!keys.has(bucket.key)) continue
    if (bucket.ref.kind === 'self') {
      bucket.ref.subjectName = holder.name
      canon.set(
        bucket.key,
        renderSelfCanonBlock(
          loadCanonForSelf({
            id: holder.id,
            name: holder.name,
            manifesto: holder.manifesto ?? null,
            personality: holder.personality ?? null,
            description: holder.description ?? null,
            identity: holder.identity ?? null,
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
      bucket.subjectExists = false
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
  let store: Awaited<ReturnType<typeof getCharacterVectorStore>> | null = null
  try {
    store = await getCharacterVectorStore(characterId)
  } catch (error) {
    log.warn('Vector store unavailable during consolidation; digests are written without vectors', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const addOrUpdateVector = async (id: string, embedding: Float32Array): Promise<void> => {
    if (!store) return
    try {
      if (store.hasVector(id)) {
        await store.updateVector(id, embedding)
      } else {
        await store.addVector(id, embedding, { memoryId: id, characterId, tier: 'hot' })
      }
    } catch (error) {
      log.warn('Failed to stage digest vector', {
        characterId,
        memoryId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const create of plan.creates) {
    await repos.memories.create(create.data, { id: create.id, createdAt: nowIso, updatedAt: nowIso })
    if (create.embedding) {
      await repos.memories.updateForCharacter(characterId, create.id, { embedding: create.embedding })
      await addOrUpdateVector(create.id, create.embedding)
    }
    log.debug('Digest created', { characterId, memoryId: create.id, members: create.memberIds.length })
  }

  for (const update of plan.updates) {
    await repos.memories.updateForCharacter(characterId, update.id, {
      ...update.patch,
      ...(update.embedding ? { embedding: update.embedding } : {}),
    })
    if (update.embedding) await addOrUpdateVector(update.id, update.embedding)
    log.debug('Digest revised in place', { characterId, memoryId: update.id, newMembers: update.memberIds.length })
  }

  for (const move of plan.tierMoves) {
    await repos.memories.updateTierBulk(characterId, move.ids, 'cold', {
      supersededById: move.supersededById,
      consolidatedAt: nowIso,
    })
    store?.setTier(move.ids, 'cold')
  }

  const considered = Array.from(new Set([...plan.considered, ...extraConsidered]))
  if (considered.length > 0) {
    await repos.memories.markConsidered(characterId, considered, nowIso)
  }

  for (const rewrite of plan.linkRewrites) {
    await repos.memories.updateForCharacter(characterId, rewrite.id, { relatedMemoryIds: rewrite.relatedMemoryIds })
  }

  if (store) {
    try {
      await store.save()
    } catch (error) {
      log.warn('Failed to save vector store after consolidation', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/** Mirror every touched bucket's post-run digests into the holder's vault. */
async function mirrorTouchedBuckets(
  holder: Character,
  buckets: Map<string, Bucket>,
  plan: ConsolidationWritePlan,
  bucketKeyByOutcome: readonly string[],
  nowIso: string,
): Promise<number> {
  const touched = new Map<string, PlannedDigest[]>()
  for (const digest of [...plan.creates, ...plan.updates]) {
    const key = bucketKeyByOutcome[digest.clusterIndex]
    const list = touched.get(key) ?? []
    list.push(digest)
    touched.set(key, list)
  }

  const files = []
  for (const [key, planned] of touched) {
    const bucket = buckets.get(key)
    if (!bucket || bucket.ref.kind === 'none' || !bucket.subjectExists) continue
    const plannedById = new Map(planned.map((d) => [d.id, d]))
    const entries: CommonplaceDigestEntry[] = []
    for (const existing of bucket.digests) {
      const revised = plannedById.get(existing.id)
      entries.push(
        revised
          ? { content: revised.content, kind: revised.kind, occurredAt: revised.occurredAt, reinforcedImportance: revised.reinforcedImportance }
          : {
              content: existing.content,
              kind: existing.kind ?? 'semantic',
              occurredAt: existing.occurredAt ?? null,
              reinforcedImportance: existing.reinforcedImportance ?? existing.importance,
            },
      )
    }
    for (const d of planned) {
      if (d.action !== 'create') continue
      entries.push({ content: d.content, kind: d.kind, occurredAt: d.occurredAt, reinforcedImportance: d.reinforcedImportance })
    }
    files.push({
      subjectCharacterId: bucket.ref.kind === 'self' ? holder.id : (bucket.ref.subjectCharacterId as string),
      subjectName: bucket.ref.subjectName,
      isSelf: bucket.ref.kind === 'self',
      digests: entries,
    })
  }
  if (files.length === 0) return 0

  try {
    const result = await writeCommonplaceDigestsToVault({ holderCharacterId: holder.id, files, updatedAt: nowIso })
    return result?.written ?? 0
  } catch (error) {
    log.warn('Commonplace mirror failed after consolidation (digests are still written)', {
      characterId: holder.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Run consolidation for one character. See the module docs for the stages.
 * Never throws for an ordinary failure (a bad call, a missing vault); throws
 * only when the corpus itself cannot be read.
 */
export async function runConsolidation(
  characterId: string,
  opts: RunConsolidationOptions = {},
): Promise<ConsolidationReport> {
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
  const stats = emptyStats()
  const clusterReports: ConsolidationClusterReport[] = []

  const finish = (extra: Partial<ConsolidationReport> = {}, characterName: string | null = null): ConsolidationReport => {
    stats.durationMs = Date.now() - startedMs
    return {
      characterId,
      characterName,
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

  const repos = getRepositories()
  // Raw read on purpose: the archived-character tombstone lives on the row,
  // and a broken vault must not hide a character that still holds memories.
  const holderRaw = await repos.characters.findByIdRaw(characterId)
  if (!holderRaw) {
    log.info('Consolidation skipped: character not found', { characterId, trigger })
    return finish({ skippedReason: 'character-not-found' })
  }
  if (holderRaw.archivedAt) {
    log.info('Consolidation skipped: character is archived', { characterId, trigger })
    return finish({ skippedReason: 'archived' }, holderRaw.name)
  }
  let holder: Character = holderRaw
  try {
    holder = (await repos.characters.findById(characterId)) ?? holderRaw
  } catch {
    holder = holderRaw
  }
  const userId = opts.userId ?? holderRaw.userId

  log.debug('Consolidation starting', {
    characterId,
    trigger,
    dryRun,
    maxClusters,
    clusterThreshold: settings.clusterThreshold,
    minClusterSize: settings.minClusterSize,
    maxClusterSize: settings.maxClusterSize,
    matureAfterDays: settings.matureAfterDays,
    timeBudgetMs: opts.timeBudgetMs ?? null,
  })

  // ── 1. Load ───────────────────────────────────────────────────────────────
  const matureCutoffMs = nowMs - settings.matureAfterDays * DAY_MS
  const { rowIndex, buckets } = await loadCorpus(characterId, matureCutoffMs, stats)
  const rowsById = new Map<string, Memory>()
  const digestsById = new Map<string, Memory>()
  for (const bucket of buckets.values()) {
    const capped = capBucketRows(bucket.rows)
    stats.bucketRowsCapped += bucket.rows.length - capped.length
    bucket.rows = capped
    for (const row of capped) rowsById.set(row.id, row)
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
    for (const digest of [...plan.creates, ...plan.updates]) {
      if (failed.has(digest.clusterIndex)) continue
      try {
        const result = await generateEmbeddingForUser(
          buildMemoryEmbeddingText(digest.summary, digest.content, {
            occurredAt: digest.occurredAt,
            narrativeTime: digest.narrativeTime,
            entities: digest.entities,
          }),
          userId,
          undefined,
          { priority: 'background' },
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
    if (plan.creates.length + plan.updates.length + plan.tierMoves.length > 0) {
      // In-process runs (CLI, API) commit here, so announce here. In the job
      // child both calls are harmless no-ops; the dispatcher's commit hooks
      // cover the frozen archive and the realtime hint for job runs.
      invalidateFrozenArchive(characterId)
      publishRealtime('memories')
      stats.mirrorFilesWritten = await mirrorTouchedBuckets(holder, buckets, plan, finalBucketKey, nowIso)
    }
  }

  const report = finish(route || selection.selected.length === 0 ? {} : { skippedReason: 'no-llm' }, holder.name)
  log.info('Consolidation run complete', {
    characterId,
    characterName: holder.name,
    trigger,
    dryRun,
    candidates: stats.candidates,
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
    mirrorFilesWritten: stats.mirrorFilesWritten,
    budgetExhausted: stats.budgetExhausted,
    durationMs: stats.durationMs,
  })
  return report
}
