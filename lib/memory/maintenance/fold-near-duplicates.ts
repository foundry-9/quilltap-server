/**
 * Phase 1 — fold near-duplicates (memory refactor §3.9).
 *
 * Deterministic and LLM-free. Two rows fold when they are both hot AUTO rows
 * with an embedding, about the same subject, of the same kind, of embeddings
 * the same length, on the same occasion (the admission date guard), and at
 * least `nearDuplicate` (0.90) apart by cosine. MANUAL rows, digests and cold
 * rows are never touched (bug 201, decision 4).
 *
 * Grouping is survivor-first rather than transitive: rows are visited by
 * `protection` (the worth-of-keeping score) descending, and each unclaimed row
 * claims every later unclaimed row that is a near-duplicate *of it*. A chain
 * A≈B≈C where A and C are not near-duplicates cannot fold C into A.
 *
 * Planning is pure ({@link planNearDuplicateFolds}). The writes run in the
 * parent ({@link applyNearDuplicateFolds}) under admission's per-character
 * lock — from the job child over host-RPC (`foldNearDuplicates`) — so a fold
 * and an admission never interleave on one row, and the survivor's count,
 * footnotes and links land as deltas through `applyFold` (the one combine).
 *
 * This replaces the old dedup tool (`lib/tools/memory-dedup.ts`) and its
 * transitive O(n²) scan across every row, its own survivor score and its 0.80
 * default.
 *
 * @module memory/maintenance/fold-near-duplicates
 */

import type { Memory } from '@/lib/schemas/types'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { occasionsAreDistinct } from '../admission/decide'
import { foldInto, FOLD_CAPS } from '../admission/fold'
import { applyFold } from '../admission/apply'
import { withAdmissionLock } from '../admission/admit'
import { policyProtectionOf } from '../policy-protection'
import { retireMemories } from '../retire'
import { calculateReinforcedImportance, protection } from '../scoring'
import type { AdmissionThresholds } from '../settings-defaults'
import type { MaintenanceCorpus } from './corpus'
import type { NearDuplicateGroup } from './types'

const log = logger.child({ module: 'memory:maintenance:fold' })

/** Survivors visited between event-loop yields. */
const YIELD_EVERY = 200

/**
 * Most rows compared per bucket in one run (the comparison is quadratic). A
 * bucket past this compares its newest rows — where new repetitions arrive —
 * and the rest wait for a later run.
 */
export const FOLD_MAX_BUCKET_ROWS = 2000

/** A row the phase may fold: hot, AUTO (so never a digest or a MANUAL row), with a vector. */
export function isFoldEligible(memory: Memory): memory is Memory & { embedding: Float32Array } {
  return (
    policyProtectionOf(memory) === null &&
    memory.source === 'AUTO' &&
    memory.embedding instanceof Float32Array &&
    memory.embedding.length > 0
  )
}

function bucketKey(memory: Memory & { embedding: Float32Array }): string {
  const subject = memory.aboutCharacterId || memory.characterId
  return `${subject}|${memory.kind ?? 'semantic'}|${memory.embedding.length}`
}

/**
 * Work out the near-duplicate groups of a corpus. Pure apart from yielding.
 */
export async function planNearDuplicateFolds(
  rows: readonly Memory[],
  thresholds: Pick<AdmissionThresholds, 'nearDuplicate' | 'dateGuardDays'>,
  nowMs: number,
): Promise<{ eligible: number; deferred: number; groups: NearDuplicateGroup[] }> {
  const buckets = new Map<string, Array<Memory & { embedding: Float32Array }>>()
  let eligible = 0
  for (const row of rows) {
    if (!isFoldEligible(row)) continue
    eligible++
    const key = bucketKey(row)
    const list = buckets.get(key) ?? []
    list.push(row)
    buckets.set(key, list)
  }

  const groups: NearDuplicateGroup[] = []
  let visited = 0
  let deferred = 0
  for (const all of buckets.values()) {
    if (all.length < 2) continue
    let list = all
    if (all.length > FOLD_MAX_BUCKET_ROWS) {
      list = [...all].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, FOLD_MAX_BUCKET_ROWS)
      deferred += all.length - list.length
    }
    // Strongest first, so the row most worth keeping survives; ties to the oldest.
    const ordered = list
      .map((m) => ({ m, score: protection(m, { nowMs }).score }))
      .sort((a, b) => b.score - a.score || Date.parse(a.m.createdAt) - Date.parse(b.m.createdAt))
      .map((x) => x.m)
    const claimed = new Set<string>()
    for (let i = 0; i < ordered.length; i++) {
      const survivor = ordered[i]
      if (claimed.has(survivor.id)) continue
      const absorbedIds: string[] = []
      let minCosine = 1
      for (let j = i + 1; j < ordered.length; j++) {
        const other = ordered[j]
        if (claimed.has(other.id)) continue
        if (occasionsAreDistinct(survivor.occurredAt, other.occurredAt, thresholds.dateGuardDays)) continue
        const cosine = cosineSimilarity(survivor.embedding, other.embedding)
        if (cosine < thresholds.nearDuplicate) continue
        absorbedIds.push(other.id)
        minCosine = Math.min(minCosine, cosine)
      }
      if (absorbedIds.length > 0) {
        claimed.add(survivor.id)
        for (const id of absorbedIds) claimed.add(id)
        groups.push({ survivorId: survivor.id, absorbedIds, minCosine })
      }
      if (++visited % YIELD_EVERY === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }
  return { eligible, deferred, groups }
}

/** What the parent did with each group. Structured-clone safe (it crosses host-RPC). */
export interface AppliedNearDuplicateFolds {
  /** Survivors as they now stand, with their vectors, one per group that landed. */
  survivors: Memory[]
  /** Rows retired (folded into a survivor). */
  retiredIds: string[]
  groupsFailed: number
}

export interface ApplyNearDuplicateFoldsRequest {
  characterId: string
  groups: NearDuplicateGroup[]
  userId: string
}

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

/**
 * Apply planned folds in the parent. Each group re-reads its rows first: a row
 * gone, gone cold, or no longer AUTO since planning is left out, and a group
 * whose survivor is no longer eligible is skipped whole. Absorbed rows are
 * retired only after their survivor has taken them in.
 */
export async function applyNearDuplicateFolds(
  request: ApplyNearDuplicateFoldsRequest,
): Promise<AppliedNearDuplicateFolds> {
  if (isJobChild()) {
    throw new Error('applyNearDuplicateFolds runs in the parent; the job child folds through host-RPC (foldNearDuplicates)')
  }
  const { characterId, groups, userId } = request
  const result: AppliedNearDuplicateFolds = { survivors: [], retiredIds: [], groupsFailed: 0 }
  if (groups.length === 0) return result

  return withAdmissionLock(characterId, async () => {
    const repos = getRepositories()
    const ids = Array.from(new Set(groups.flatMap((g) => [g.survivorId, ...g.absorbedIds])))
    const rows = new Map((await repos.memories.findByIds(ids)).filter((m) => m.characterId === characterId).map((m) => [m.id, m]))
    const toRetire: string[] = []

    for (const group of groups) {
      const survivor = rows.get(group.survivorId)
      const absorbed = group.absorbedIds.map((id) => rows.get(id)).filter((m): m is Memory => !!m && isFoldEligible(m))
      if (!survivor || !isFoldEligible(survivor) || absorbed.length === 0) {
        result.groupsFailed++
        log.debug('Near-duplicate group no longer applies; skipped', {
          characterId,
          survivorId: group.survivorId,
          survivorPresent: !!survivor,
          absorbedStill: absorbed.length,
        })
        continue
      }
      let applied: Memory | null = null
      try {
        applied = await applyFold(survivor, foldInto(survivor, absorbed, FOLD_CAPS), { userId })
      } catch (error) {
        log.warn('Near-duplicate fold failed; its rows are kept', {
          characterId,
          survivorId: survivor.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if (!applied) {
        result.groupsFailed++
        continue
      }
      result.survivors.push(applied)
      toRetire.push(...absorbed.map((m) => m.id))
    }

    if (toRetire.length > 0) {
      // The deletion chokepoint scrubs every link to the folded rows (the
      // survivors' new ones included) and evicts their vectors.
      const report = await retireMemories(toRetire, { reason: 'near-duplicate-fold' })
      result.retiredIds = report.retiredIds
      // The job child's cache still holds the folded rows; it reloads on next use.
      try {
        const { notifyChild } = await import('@/lib/background-jobs/host/processor-host')
        notifyChild('vectorStore', characterId)
      } catch (error) {
        log.debug('Could not tell the job child to drop its memory index cache', {
          characterId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    log.debug('Near-duplicate folds applied', {
      characterId,
      groups: groups.length,
      landed: result.survivors.length,
      failed: result.groupsFailed,
      retired: result.retiredIds.length,
    })
    return result
  })
}

/**
 * Run the planned folds from wherever the run is: directly in the parent, over
 * host-RPC from the job child.
 */
export async function foldNearDuplicateGroups(request: ApplyNearDuplicateFoldsRequest): Promise<AppliedNearDuplicateFolds> {
  if (!isJobChild()) return applyNearDuplicateFolds(request)
  const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client')
  return callHost<AppliedNearDuplicateFolds>('foldNearDuplicates', request)
}

/**
 * Bring the run's corpus in step with the folds: live, from what the parent
 * wrote; dry, from the plan (the survivor's text and count as the fold would
 * leave them; its vector unchanged).
 */
export function applyFoldsToCorpus(
  corpus: MaintenanceCorpus,
  groups: readonly NearDuplicateGroup[],
  applied: AppliedNearDuplicateFolds | null,
): void {
  if (applied) {
    for (const survivor of applied.survivors) {
      // `applyFold` returns the row with its vector (the new one after a re-embed).
      corpus.put(survivor.embedding ? survivor : { ...survivor, embedding: corpus.get(survivor.id)?.embedding ?? null })
    }
    corpus.remove(applied.retiredIds)
    return
  }
  for (const group of groups) {
    const survivor = corpus.get(group.survivorId)
    if (!survivor) continue
    const absorbed = group.absorbedIds.map((id) => corpus.get(id)).filter((m): m is Memory => !!m)
    const plan = foldInto(survivor, absorbed, FOLD_CAPS)
    const reinforcementCount = (survivor.reinforcementCount ?? 1) + plan.reinforcementDelta
    corpus.put({
      ...survivor,
      ...plan.patch,
      content: plan.content,
      relatedMemoryIds: [...(survivor.relatedMemoryIds ?? []), ...plan.addLinks],
      reinforcementCount,
      reinforcedImportance: calculateReinforcedImportance(survivor.importance, reinforcementCount),
      lastReinforcedAt: plan.reinforcedAt ?? survivor.lastReinforcedAt,
    })
    corpus.remove(group.absorbedIds)
  }
}

