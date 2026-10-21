/**
 * Phase 2 — consolidate (memory refactor §3.9).
 *
 * The loader half of consolidation: picks the candidates out of the run's
 * corpus, buckets them by subject, and hands them to the planner and model
 * route in `consolidation.ts`. Candidates are hot AUTO rows **and cold rows
 * demoted by cap pressure** (`supersededById` null, bug 211), so demotion feeds
 * consolidation instead of stranding rows. MANUAL rows are never candidates.
 *
 * @module memory/maintenance/consolidate
 */

import type { Character, Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import {
  consolidate,
  createConsolidationStats,
  hasEmbedding,
  type ConsolidationBucket,
  type ConsolidationRun,
  type ConsolidationStats,
  type RunConsolidationOptions,
} from '../consolidation'
import type { ConsolidationWritePlan, LinkIndexRow } from '../consolidation-plan'
import { tierOf, type MaintenanceCorpus } from './corpus'

const log = logger.child({ module: 'memory:maintenance:consolidate' })

/**
 * Most candidate rows clustered per subject bucket in one run. Clustering is
 * O(n²) in memory and time; a bucket past this keeps its never-considered rows
 * first, then the weightiest, and the rest wait for the next run.
 */
export const CONSOLIDATION_MAX_BUCKET_ROWS = 2000

const DAY_MS = 86_400_000

function bucketKeyOf(memory: Memory, holderId: string): string {
  const about = memory.aboutCharacterId ?? null
  if (!about) return 'none'
  if (about === holderId) return 'self'
  return `other:${about}`
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

/**
 * Bucket the corpus for consolidation: the link index over every row, and per
 * subject the candidate rows and the hot digests that seed clusters. Pure.
 */
export function bucketCandidates(
  rows: readonly Memory[],
  holderId: string,
  matureCutoffMs: number,
): { rowIndex: Map<string, LinkIndexRow>; buckets: Map<string, ConsolidationBucket>; stats: ConsolidationStats } {
  const stats = createConsolidationStats()
  const rowIndex = new Map<string, LinkIndexRow>()
  const buckets = new Map<string, ConsolidationBucket>()

  const bucketFor = (memory: Memory): ConsolidationBucket => {
    const key = bucketKeyOf(memory, holderId)
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
      }
      buckets.set(key, bucket)
    }
    return bucket
  }

  for (const memory of rows) {
    stats.rowsLoaded++
    rowIndex.set(memory.id, { id: memory.id, relatedMemoryIds: memory.relatedMemoryIds ?? [] })
    const isHot = tierOf(memory) === 'hot'
    // A keystone is never a member and never a seed: a seed digest is
    // rewritten when it takes members in, and a member goes cold.
    if (memory.keystone) continue

    if (memory.source === 'CONSOLIDATED') {
      if (!isHot) continue
      if (!hasEmbedding(memory)) {
        stats.noEmbeddingSkipped++
        continue
      }
      bucketFor(memory).digests.push(memory)
      stats.digestsLoaded++
      continue
    }
    // Hand-written rows are never sent cold by policy.
    if (memory.source !== 'AUTO') continue
    // Cold rows a digest superseded belong to it; cold rows with no successor
    // were demoted by the cap and re-enter here (bug 211).
    if (!isHot) {
      if (memory.supersededById) continue
      stats.demotedCandidates++
    }
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

  for (const bucket of buckets.values()) {
    const capped = capBucketRows(bucket.rows)
    stats.bucketRowsCapped += bucket.rows.length - capped.length
    bucket.rows = capped
  }
  return { rowIndex, buckets, stats }
}

/** Run the phase over the corpus, then bring the corpus in step with the plan. */
export async function runConsolidatePhase(
  corpus: MaintenanceCorpus,
  holder: Character,
  opts: RunConsolidationOptions & { matureAfterDays: number; now: Date },
): Promise<ConsolidationRun> {
  const matureCutoffMs = opts.now.getTime() - opts.matureAfterDays * DAY_MS
  const { rowIndex, buckets, stats } = bucketCandidates(corpus.all(), holder.id, matureCutoffMs)
  log.debug('Consolidation candidates bucketed', {
    characterId: holder.id,
    candidates: stats.candidates,
    demotedCandidates: stats.demotedCandidates,
    digests: stats.digestsLoaded,
    buckets: buckets.size,
  })
  const run = await consolidate({ holder, rowIndex, buckets, stats }, opts)
  applyConsolidationToCorpus(corpus, run.plan, run.belowMinConsidered, opts.now.toISOString())
  return run
}

/** Apply a consolidation plan to the corpus as the writes would leave it. */
export function applyConsolidationToCorpus(
  corpus: MaintenanceCorpus,
  plan: ConsolidationWritePlan,
  belowMinConsidered: readonly string[],
  nowIso: string,
): void {
  for (const create of plan.creates) {
    corpus.put({
      ...(create.data as unknown as Memory),
      id: create.id,
      embedding: create.embedding ?? null,
      tier: 'hot',
      createdAt: nowIso,
      updatedAt: nowIso,
    } as Memory)
  }
  for (const update of plan.updates) {
    corpus.patch(update.id, { ...update.patch, ...(update.embedding ? { embedding: update.embedding } : {}) })
  }
  for (const move of plan.tierMoves) {
    for (const id of move.ids) {
      corpus.patch(id, { tier: 'cold', supersededById: move.supersededById, supersededAt: nowIso, consolidatedAt: nowIso })
    }
  }
  for (const id of new Set([...plan.considered, ...belowMinConsidered])) corpus.patch(id, { consolidatedAt: nowIso })
  for (const rewrite of plan.linkRewrites) corpus.patch(rewrite.id, { relatedMemoryIds: rewrite.relatedMemoryIds })
}
