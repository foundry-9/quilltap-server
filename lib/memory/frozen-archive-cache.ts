/**
 * Frozen Memory Archive Cache (Phase 3a)
 *
 * Per-character memory pool that stays byte-stable across turns within a
 * single `compactionGeneration`. The archive is the cache-friendly bulk of
 * what a character "remembers" generally — the top N memories ranked by
 * effective weight at generation start, then sorted by memory id so the
 * formatted output is deterministic.
 *
 * Cache key: `(characterId, compactionGeneration)`.
 * Eviction: when a new generation appears for a character, prior entries for
 * that character are dropped. The cache is a process-local Map; when the
 * server restarts, the next turn rebuilds the archive on miss.
 *
 * Why an in-memory cache rather than a persisted message: re-posting a
 * message would either grow history per turn or require dedup logic. The
 * archive content is cheap to compute and lives at the front of the LLM
 * context tail (along with the dynamic head); inlining the same archive
 * bytes per turn means provider prefix caches see identical prefix segments
 * — which is exactly the cache hit we want.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { Memory } from '@/lib/schemas/types'
import { calculateEffectiveWeight } from './memory-weighting'

/** Default size of the frozen archive. Phase 3a target. */
export const FROZEN_ARCHIVE_SIZE = 25

/** Pool size to draw from when ranking. Higher than the archive size so the
 *  effective-weight re-rank has room to surface long-tail high-importance
 *  rows that fell below the raw-importance cutoff. */
const FROZEN_ARCHIVE_POOL_FACTOR = 4

interface CacheEntry {
  generation: number
  memories: Memory[]
}

const cache = new Map<string, CacheEntry>()

/**
 * Look up (or compute and cache) the frozen memory archive for a character
 * at a given compaction generation. Returns at most `FROZEN_ARCHIVE_SIZE`
 * memories, sorted ascending by `memory.id` so the formatted output is
 * deterministic across turns.
 */
export async function getOrComputeFrozenArchive(
  characterId: string,
  compactionGeneration: number,
  options: { size?: number } = {},
): Promise<Memory[]> {
  const size = options.size ?? FROZEN_ARCHIVE_SIZE
  const cached = cache.get(characterId)

  if (cached && cached.generation === compactionGeneration) {
    return cached.memories
  }

  const memories = await computeFrozenArchive(characterId, size)
  cache.set(characterId, { generation: compactionGeneration, memories })

  return memories
}

/**
 * Drop any cached archive for a character. Useful when the character's
 * memory corpus has been edited from outside the chat-summary pipeline
 * (manual deletion, housekeeping sweep, import).
 */
export function invalidateFrozenArchive(characterId: string): void {
  cache.delete(characterId)
}

/** Test-only helper: fully reset the cache. */
export function resetFrozenArchiveCacheForTests(): void {
  cache.clear()
}

async function computeFrozenArchive(
  characterId: string,
  size: number,
): Promise<Memory[]> {
  const repos = getRepositories()
  const poolSize = Math.max(size, size * FROZEN_ARCHIVE_POOL_FACTOR)

  // Top-N by raw importance is the cheap pull; we then re-rank by effective
  // weight (importance × time decay) and slice to the final archive size,
  // then sort by id so ordering is stable across turns.
  const candidates = await repos.memories.findMostImportant(characterId, poolSize)
  if (candidates.length === 0) return []

  const ranked = candidates
    .map(memory => ({
      memory,
      effectiveWeight: calculateEffectiveWeight(memory).effectiveWeight,
    }))
    .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
    .slice(0, size)
    .map(({ memory }) => memory)

  ranked.sort((a, b) => a.id.localeCompare(b.id))
  return ranked
}
