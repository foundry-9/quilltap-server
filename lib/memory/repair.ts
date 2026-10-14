/**
 * The memory graph repair behind `quilltap memories validate --repair` and
 * `POST /api/v1/memories?action=repair` (memory refactor §3.11).
 *
 * Finds what the chokepoints now prevent but older data may still carry:
 * links in `relatedMemoryIds`, `consolidatedFrom` or `supersededById` that
 * name a row which no longer exists, and rows with no embedding. A dry run
 * reports them; a live run scrubs the links through
 * {@link scrubDanglingMemoryLinks} (the retirement's own removal deltas) and
 * queues an embedding job for each unembedded row. Runs in the parent.
 *
 * @module memory/repair
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { scrubDanglingMemoryLinks, type DanglingScrubReport } from './retire'
import { enqueueMissingEmbeddings } from './index-store'

const log = logger.child({ module: 'memory:repair' })

/** Embedding jobs a single repair queues at most; run it again to queue more. */
export const REPAIR_EMBEDDING_BATCH = 2000

export interface MemoryGraphRepairReport {
  dryRun: boolean
  /** The holder scanned, or null for every memory in the instance. */
  characterId: string | null
  found: {
    /** Dangling entries in `relatedMemoryIds`, and the rows holding them. */
    related: { links: number; rows: number }
    /** Missing members named by digests' `consolidatedFrom`. */
    consolidatedFrom: { links: number; digests: number }
    /** Members whose `supersededById` names a digest that is gone. */
    supersededBy: number
    /** Rows with no embedding. */
    missingEmbeddings: number
  }
  /** Live runs only. */
  repaired?: DanglingScrubReport & {
    embeddingJobsQueued: number
    /** Why no embedding job was queued, when rows needed one. */
    embeddingSkippedReason?: 'no-embedding-profile'
  }
}

export async function repairMemoryGraph(options: {
  userId: string
  characterId?: string
  dryRun: boolean
}): Promise<MemoryGraphRepairReport> {
  const repos = getRepositories()
  const scope = options.characterId ? [options.characterId] : undefined
  const links = await repos.memories.findDanglingLinks(scope)
  const missingEmbeddings = await repos.memories.countWithoutEmbedding(options.characterId)

  const report: MemoryGraphRepairReport = {
    dryRun: options.dryRun,
    characterId: options.characterId ?? null,
    found: {
      related: { links: links.related.length, rows: new Set(links.related.map((l) => l.id)).size },
      consolidatedFrom: {
        links: links.consolidatedFrom.length,
        digests: new Set(links.consolidatedFrom.map((l) => l.id)).size,
      },
      supersededBy: links.supersededBy.length,
      missingEmbeddings,
    },
  }

  if (!options.dryRun) {
    const scrubbed = await scrubDanglingMemoryLinks(links)
    let embeddingJobsQueued = 0
    let embeddingSkippedReason: 'no-embedding-profile' | undefined
    if (missingEmbeddings > 0) {
      const queued = await enqueueMissingEmbeddings({
        userId: options.userId,
        characterId: options.characterId,
        limit: REPAIR_EMBEDDING_BATCH,
      })
      if (queued.status === 'ok') embeddingJobsQueued = queued.enqueued
      else embeddingSkippedReason = 'no-embedding-profile'
    }
    report.repaired = {
      ...scrubbed,
      embeddingJobsQueued,
      ...(embeddingSkippedReason ? { embeddingSkippedReason } : {}),
    }
  }

  log.info('Memory graph repair', {
    dryRun: options.dryRun,
    characterId: options.characterId ?? 'all',
    found: report.found,
    repaired: report.repaired ?? null,
  })
  return report
}
