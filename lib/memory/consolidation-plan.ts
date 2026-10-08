/**
 * Consolidation write planning — pure.
 *
 * The consolidation job runs in the forked job child, where repository reads
 * never see the job's own buffered writes. So it computes *everything* first —
 * this module — and only then issues the writes (memory-consolidation-and-tiers.md
 * §C5). Keeping the planner pure is also what makes the write rules testable
 * without a database:
 *
 *   - **New digest** (`source: 'CONSOLIDATED'`): `consolidatedFrom` = its
 *     members; `reinforcementCount` = Σ member counts, capped at
 *     {@link DIGEST_REINFORCEMENT_CAP}; `importance` = the model's value clamped
 *     to `[min, max]` of the members' `reinforcedImportance`;
 *     `reinforcedImportance` by the gate's formula; `relatedMemoryIds` = the
 *     union of the members' links that point *outside* the cluster (re-aimed at
 *     a digest when they pointed at a row folded elsewhere in the same run);
 *     `occurredAt` = the earliest member event time for an episode digest, null
 *     for a standing fact; `chatId` / `projectId` only when every member shares
 *     one; keywords end with the three targeting tags.
 *   - **Existing digest** (the cluster formed around it): updated in place —
 *     the model's first digest is its revision, `consolidatedFrom` grows, the
 *     digest's own count and links are carried, and it is re-embedded.
 *   - **Members** go cold with `supersededById` = their digest and
 *     `consolidatedAt` = now.
 *   - **Contradictions**: the older row goes cold, superseded by the digest
 *     carrying the newer fact (or by the newer row itself when that row stands
 *     alone).
 *   - **Inbound links**: any surviving row that pointed at a superseded row now
 *     points at its digest, de-duplicated.
 *   - **Standalones** stay hot and only get `consolidatedAt`.
 *
 * @module memory/consolidation-plan
 */

import type { Memory } from '@/lib/schemas/types'
import type { MemoryCreateInput } from '@/lib/database/repositories/memories.repository'
import { calculateReinforcedImportance } from './memory-gate'
import {
  CONTEXT_VALUES,
  SCOPE_VALUES,
  TEMPORAL_VALUES,
  parseTargetingTags,
  type ContextTag,
  type ScopeTag,
  type TemporalTag,
} from './recall-tags'
import type { ConsolidationContradiction, ConsolidationDigestOutput } from './cheap-llm-tasks/consolidation-tasks'

/** Ceiling on a digest's `reinforcementCount`. */
export const DIGEST_REINFORCEMENT_CAP = 50

/** The model's importance is first held to this band (spec: 0.2–1.0). */
const IMPORTANCE_FLOOR = 0.2

/** Bounds on the unions a digest inherits from its members. */
const MAX_DIGEST_ENTITIES = 12
const MAX_FREE_KEYWORDS = 8

/** One cluster's validated outcome, mapped from handles back to memory ids. */
export interface ResolvedClusterOutcome {
  /** `aboutCharacterId` the digests carry (holder id for self, null for the null bucket). */
  aboutCharacterId: string | null
  clusterKind: 'semantic' | 'episodic'
  /** The digest the cluster formed around, if any. */
  existingDigest: Memory | null
  /** Non-digest members, as loaded. */
  members: Memory[]
  /** Model digests, `memberIds` already mapped to memory ids. */
  digests: ConsolidationDigestOutput[]
  /** Member ids the model kept standalone (unlisted included). */
  keepStandalone: string[]
  /** Contradictions in id space. */
  contradictions: ConsolidationContradiction[]
  /** One embedding per digest, same order; null entries in a dry run. */
  embeddings: Array<Float32Array | null>
}

/** A digest as the plan (and the dry-run report) describes it. */
export interface PlannedDigest {
  id: string
  action: 'create' | 'update'
  clusterIndex: number
  content: string
  summary: string
  keywords: string[]
  importance: number
  reinforcedImportance: number
  reinforcementCount: number
  kind: 'semantic' | 'episodic'
  occurredAt: string | null
  narrativeTime: string | null
  entities: string[]
  /** Members this digest replaces in this run. */
  memberIds: string[]
  aboutCharacterId: string | null
  embedding: Float32Array | null
}

export interface PlannedDigestCreate extends PlannedDigest {
  action: 'create'
  data: MemoryCreateInput
}

export interface PlannedDigestUpdate extends PlannedDigest {
  action: 'update'
  patch: Partial<Memory>
}

export interface ConsolidationWritePlan {
  creates: PlannedDigestCreate[]
  updates: PlannedDigestUpdate[]
  /** Rows to send cold, grouped by the row that supersedes them. */
  tierMoves: Array<{ supersededById: string; ids: string[] }>
  /** Standalone rows that stay hot and only get `consolidatedAt`. */
  considered: string[]
  /** Surviving rows whose links are re-aimed at digests. */
  linkRewrites: Array<{ id: string; relatedMemoryIds: string[] }>
  /** Every superseded row → the row that supersedes it. */
  supersededBy: Map<string, string>
  /** Planned digests per input cluster, in cluster order (for the report). */
  digestsByCluster: PlannedDigest[][]
}

/** The minimal row view inbound-link rewiring needs. */
export interface LinkIndexRow {
  id: string
  relatedMemoryIds: readonly string[]
}

export interface PlanInput {
  characterId: string
  clusters: readonly ResolvedClusterOutcome[]
  /** Every row the character holds (both tiers), for inbound-link rewiring. */
  rowIndex: ReadonlyMap<string, LinkIndexRow>
  nowIso: string
  /** Id factory for new digests. */
  newId: () => string
}

// ============================================================================
// Field helpers (exported for tests)
// ============================================================================

function eventTimeIso(row: Memory): string {
  return row.occurredAt ?? row.createdAt
}

function referenceTimeIso(row: Memory): string {
  const created = Date.parse(row.createdAt)
  const reinforced = row.lastReinforcedAt ? Date.parse(row.lastReinforcedAt) : 0
  return reinforced > created ? (row.lastReinforcedAt as string) : row.createdAt
}

/** The value every row shares, or null when they disagree or any is empty. */
export function sharedValue(values: ReadonlyArray<string | null | undefined>): string | null {
  if (values.length === 0) return null
  const first = values[0] ?? null
  if (!first) return null
  return values.every((v) => (v ?? null) === first) ? first : null
}

/**
 * A digest's witnessed context: the members' shared value; otherwise
 * `'user_present'` when the user witnessed any of it; otherwise null.
 */
export function deriveWitnessedContext(
  values: ReadonlyArray<Memory['witnessedContext']>,
): Memory['witnessedContext'] {
  const normalized = values.map((v) => v ?? null)
  const first = normalized[0] ?? null
  if (first && normalized.every((v) => v === first)) return first
  if (normalized.includes('user_present')) return 'user_present'
  return null
}

/** Clamp the model's importance to 0.2–1.0, then to `[min, max]` of the members' reinforced importance. */
export function clampDigestImportance(modelImportance: number, rows: readonly Memory[]): number {
  const banded = Math.min(1, Math.max(IMPORTANCE_FLOOR, modelImportance))
  const values = rows.map((r) => r.reinforcedImportance ?? r.importance)
  if (values.length === 0) return banded
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return Math.min(hi, Math.max(lo, banded))
}

function majority<T extends string>(values: readonly T[], fallback: T): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = fallback
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * A digest's keywords: the model's free words (vocabulary words stripped,
 * de-duplicated, capped) followed by exactly one value per targeting axis —
 * the model's when it gave one, else the members' majority (episode digests
 * default `temporal` to `past`). Same materialization as the extractor:
 * `temporal` and `context` bare, `scope` as `scope: <value>`, at the end.
 */
export function normalizeDigestKeywords(
  modelKeywords: readonly string[],
  memberKeywords: ReadonlyArray<readonly string[]>,
  kind: 'semantic' | 'episodic',
): string[] {
  let temporal: TemporalTag | null = null
  let scope: ScopeTag | null = null
  let context: ContextTag | null = null
  const free: string[] = []
  for (const raw of modelKeywords) {
    if (typeof raw !== 'string') continue
    const kw = raw.trim().toLowerCase()
    if (!kw) continue
    if (kw.startsWith('scope:')) {
      const value = kw.slice('scope:'.length).trim()
      if (SCOPE_VALUES.has(value)) scope = value as ScopeTag
      continue
    }
    if (TEMPORAL_VALUES.has(kw)) {
      temporal = kw as TemporalTag
      continue
    }
    if (CONTEXT_VALUES.has(kw)) {
      context = kw as ContextTag
      continue
    }
    if (!free.includes(kw)) free.push(kw)
  }

  const memberTags = memberKeywords.map((k) => parseTargetingTags(k))
  const finalTemporal =
    temporal ?? (kind === 'episodic' ? 'past' : majority(memberTags.map((t) => t.temporal), 'present'))
  const finalScope = scope ?? majority(memberTags.map((t) => t.scope), 'wide')
  const finalContext = context ?? majority(memberTags.map((t) => t.context), 'information')

  return [...free.slice(0, MAX_FREE_KEYWORDS), finalTemporal, `scope: ${finalScope}`, finalContext]
}

function union(lists: ReadonlyArray<readonly string[] | null | undefined>, cap?: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const v of list ?? []) {
      const key = v.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(v)
      if (cap !== undefined && out.length >= cap) return out
    }
  }
  return out
}

// ============================================================================
// The planner
// ============================================================================

/**
 * Plan every write for one run. Pure: the same input always yields the same
 * plan (given a deterministic `newId`).
 */
export function planConsolidationWrites(input: PlanInput): ConsolidationWritePlan {
  const { characterId, clusters, rowIndex, nowIso, newId } = input

  // ── Pass 1: give every digest an id and record who it supersedes. ────────
  const digestIds: string[][] = []
  const supersededBy = new Map<string, string>()
  const digestOfMember = new Map<string, string>()
  const plannedDigestIds = new Set<string>()
  clusters.forEach((cluster, c) => {
    const ids = cluster.digests.map((_, k) =>
      k === 0 && cluster.existingDigest ? cluster.existingDigest.id : newId(),
    )
    digestIds[c] = ids
    cluster.digests.forEach((digest, k) => {
      plannedDigestIds.add(ids[k])
      for (const memberId of digest.memberIds) {
        supersededBy.set(memberId, ids[k])
        digestOfMember.set(memberId, ids[k])
      }
    })
  })

  // Contradictions: the older row goes cold under whatever carries the newer fact.
  clusters.forEach((cluster) => {
    for (const { olderId, newerId } of cluster.contradictions) {
      const target = digestOfMember.get(newerId) ?? newerId
      if (target === olderId) continue
      supersededBy.set(olderId, target)
    }
  })

  const remap = (id: string): string => {
    let current = id
    for (let hop = 0; hop < 5; hop++) {
      const next = supersededBy.get(current)
      if (!next || next === current) break
      current = next
    }
    return current
  }

  const linkTargetExists = (id: string): boolean => rowIndex.has(id) || plannedDigestIds.has(id)

  // ── Pass 2: build each digest. ───────────────────────────────────────────
  const creates: PlannedDigestCreate[] = []
  const updates: PlannedDigestUpdate[] = []
  const digestsByCluster: PlannedDigest[][] = []

  clusters.forEach((cluster, c) => {
    const membersById = new Map(cluster.members.map((m) => [m.id, m]))
    const planned: PlannedDigest[] = []

    cluster.digests.forEach((digest, k) => {
      const id = digestIds[c][k]
      const isUpdate = k === 0 && cluster.existingDigest !== null
      const existing = isUpdate ? cluster.existingDigest : null
      const memberRows = digest.memberIds
        .map((mid) => membersById.get(mid))
        .filter((m): m is Memory => m !== undefined)
      const rows = existing ? [existing, ...memberRows] : memberRows

      const kind: 'semantic' | 'episodic' = cluster.clusterKind === 'episodic' ? 'episodic' : digest.kind
      const importance = clampDigestImportance(digest.importance, rows)
      const reinforcementCount = Math.min(
        DIGEST_REINFORCEMENT_CAP,
        Math.max(1, rows.reduce((sum, r) => sum + (r.reinforcementCount ?? 1), 0)),
      )
      const reinforcedImportance = calculateReinforcedImportance(importance, reinforcementCount)

      // "Outside the cluster" = outside this digest's own membership: a link
      // between two of its members remaps to the digest itself and drops; a
      // link to a sibling kept standalone, or to a row folded elsewhere this
      // run (re-aimed at that digest), survives.
      const relatedMemoryIds = union([
        rows
          .flatMap((r) => r.relatedMemoryIds ?? [])
          .map(remap)
          .filter((rid) => rid !== id && linkTargetExists(rid)),
      ])

      const earliestRow = [...rows].sort((a, b) => eventTimeIso(a).localeCompare(eventTimeIso(b)))[0]
      const occurredAt = kind === 'episodic' && earliestRow ? eventTimeIso(earliestRow) : null
      const narrativeTime = kind === 'episodic' ? earliestRow?.narrativeTime ?? null : null
      const keywords = normalizeDigestKeywords(digest.keywords, rows.map((r) => r.keywords ?? []), kind)
      const entities = union(rows.map((r) => r.entities ?? []), MAX_DIGEST_ENTITIES)
      const tags = union(rows.map((r) => r.tags ?? []))
      const chatId = sharedValue(rows.map((r) => r.chatId))
      const projectId = sharedValue(rows.map((r) => r.projectId))
      const witnessedContext = deriveWitnessedContext(rows.map((r) => r.witnessedContext))
      const consolidatedFrom = union([existing?.consolidatedFrom ?? [], digest.memberIds])
      const lastReinforcedAt = isUpdate
        ? nowIso
        : memberRows.map(referenceTimeIso).sort().at(-1) ?? nowIso

      const base: PlannedDigest = {
        id,
        action: isUpdate ? 'update' : 'create',
        clusterIndex: c,
        content: digest.content,
        summary: digest.summary,
        keywords,
        importance,
        reinforcedImportance,
        reinforcementCount,
        kind,
        occurredAt,
        narrativeTime,
        entities,
        memberIds: [...digest.memberIds],
        aboutCharacterId: cluster.aboutCharacterId,
        embedding: cluster.embeddings[k] ?? null,
      }
      planned.push(base)

      if (isUpdate) {
        updates.push({
          ...base,
          action: 'update',
          patch: {
            content: digest.content,
            summary: digest.summary,
            keywords,
            tags,
            importance,
            reinforcementCount,
            reinforcedImportance,
            lastReinforcedAt,
            relatedMemoryIds,
            consolidatedFrom,
            consolidatedAt: nowIso,
            occurredAt,
            narrativeTime,
            entities,
            chatId,
            projectId,
            witnessedContext,
          },
        })
      } else {
        creates.push({
          ...base,
          action: 'create',
          data: {
            characterId,
            aboutCharacterId: cluster.aboutCharacterId,
            chatId,
            projectId,
            content: digest.content,
            summary: digest.summary,
            keywords,
            tags,
            importance,
            source: 'CONSOLIDATED',
            witnessedContext,
            occurredAt,
            narrativeTime,
            entities,
            kind,
            sourceMessageId: null,
            lastAccessedAt: null,
            reinforcementCount,
            lastReinforcedAt,
            relatedMemoryIds,
            reinforcedImportance,
            tier: 'hot',
            supersededById: null,
            consolidatedFrom,
            consolidatedAt: nowIso,
          },
        })
      }
    })
    digestsByCluster.push(planned)
  })

  // ── Pass 3: tier moves, standalones, inbound links. ──────────────────────
  const moves = new Map<string, string[]>()
  for (const [rowId, target] of supersededBy) {
    if (plannedDigestIds.has(rowId)) continue // a digest never goes cold here
    const finalTarget = remap(target)
    const list = moves.get(finalTarget) ?? []
    list.push(rowId)
    moves.set(finalTarget, list)
  }
  const tierMoves = Array.from(moves, ([supersededById, ids]) => ({ supersededById, ids }))

  const considered = union(
    clusters.map((cluster) => cluster.keepStandalone.filter((id) => !supersededBy.has(id))),
  )

  const linkRewrites: Array<{ id: string; relatedMemoryIds: string[] }> = []
  for (const row of rowIndex.values()) {
    if (supersededBy.has(row.id) || plannedDigestIds.has(row.id)) continue
    const links = row.relatedMemoryIds ?? []
    if (!links.some((l) => supersededBy.has(l))) continue
    const rewired = union([links.map(remap).filter((l) => l !== row.id)])
    linkRewrites.push({ id: row.id, relatedMemoryIds: rewired })
  }

  return {
    creates,
    updates,
    tierMoves,
    considered,
    linkRewrites,
    supersededBy,
    digestsByCluster,
  }
}
