/**
 * Frozen Memory Archive Cache (Phase 3a)
 *
 * Per-character memory pool that stays byte-stable across turns within a
 * single `compactionGeneration`. The archive is the cache-friendly bulk of
 * what a character "remembers" generally. Composition (consolidation spec §5):
 * the top hot digests about each *other* character present this turn, the top
 * self digests, then a fill of the highest effective-weight hot rows up to the
 * budget-sized N — finally sorted by memory id so the formatted output is
 * deterministic. Cold rows never enter (the repository reads are hot-only).
 *
 * Cache key: `(characterId, chatId)`, with the chat's `compactionGeneration`
 * (and the archive size) as the freshness check. Keying on the chat matters:
 * every new chat starts at generation 0, so a character-only key handed a new
 * chat whatever generation-0 archive an earlier chat had cached. Within one
 * chat and generation the archive is byte-stable.
 *
 * Eviction: LRU-bounded at {@link FROZEN_ARCHIVE_CACHE_MAX_ENTRIES}. Corpus-
 * wide edits — housekeeping sweeps, deduplication, consolidation — call
 * {@link invalidateFrozenArchive}, which drops every chat's entry for that
 * character. Ordinary per-turn memory writes deliberately do NOT invalidate:
 * that would rebuild the archive every turn and defeat the prefix cache.
 * The cache is process-local and lives in the parent (the context builder runs
 * there); a sweep in the job child is announced from the parent's
 * job-completion hook. After a restart the next turn rebuilds on miss.
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

/** Default size of the frozen archive (callers normally pass a budget-sized one). */
export const FROZEN_ARCHIVE_SIZE = 25

/** Most (character, chat) archives held at once. */
export const FROZEN_ARCHIVE_CACHE_MAX_ENTRIES = 64

/** Digests drawn per other character present this turn. */
export const FROZEN_ARCHIVE_DIGESTS_PER_PRESENT = 3

/** Self digests drawn. */
export const FROZEN_ARCHIVE_SELF_DIGESTS = 5

/** Pool size to draw from when ranking. Higher than the archive size so the
 *  effective-weight re-rank has room to surface long-tail high-importance
 *  rows that fell below the reinforced-importance cutoff. */
const FROZEN_ARCHIVE_POOL_FACTOR = 4

interface CacheEntry {
  characterId: string
  generation: number
  size: number
  /** Sorted, joined ids of the other characters present when computed. */
  presence: string
  memories: Memory[]
}

/** Insertion-ordered: the first key is the least recently used. */
const cache = new Map<string, CacheEntry>()

function cacheKey(characterId: string, chatId: string): string {
  return `${characterId}\u0000${chatId}`
}

/**
 * Look up (or compute and cache) the frozen memory archive for a character in
 * a chat at a given compaction generation. Returns at most `size` memories,
 * sorted ascending by `memory.id` so the formatted output is deterministic
 * across turns.
 */
export async function getOrComputeFrozenArchive(
  characterId: string,
  chatId: string,
  compactionGeneration: number,
  options: {
    size?: number
    /** Characters present this turn (the responder is ignored if listed). */
    presentCharacterIds?: readonly string[]
  } = {},
): Promise<Memory[]> {
  const size = options.size ?? FROZEN_ARCHIVE_SIZE
  const present = [...new Set(options.presentCharacterIds ?? [])]
    .filter(id => id && id !== characterId)
    .sort()
  const presence = present.join(',')
  const key = cacheKey(characterId, chatId)
  const cached = cache.get(key)

  if (cached && cached.generation === compactionGeneration && cached.size === size && cached.presence === presence) {
    // Refresh recency.
    cache.delete(key)
    cache.set(key, cached)
    return cached.memories
  }

  const memories = await computeFrozenArchive(characterId, size, present)
  cache.delete(key)
  cache.set(key, { characterId, generation: compactionGeneration, size, presence, memories })
  while (cache.size > FROZEN_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }

  logger.debug('[FrozenArchive] Computed archive', {
    characterId,
    chatId,
    compactionGeneration,
    size,
    presentCharacters: present.length,
    returned: memories.length,
    cacheEntries: cache.size,
  })
  return memories
}

/**
 * Drop every chat's cached archive for a character. Call after corpus-wide
 * edits (housekeeping deletes, deduplication, consolidation) — never after an
 * ordinary per-turn write.
 */
export function invalidateFrozenArchive(characterId: string): void {
  let dropped = 0
  for (const [key, entry] of cache) {
    if (entry.characterId === characterId) {
      cache.delete(key)
      dropped++
    }
  }
  if (dropped > 0) {
    logger.debug('[FrozenArchive] Invalidated archives for character', { characterId, dropped })
  }
}

/** Drop every cached archive (a sweep across all of a user's characters). */
export function invalidateAllFrozenArchives(): void {
  const dropped = cache.size
  cache.clear()
  if (dropped > 0) {
    logger.debug('[FrozenArchive] Invalidated all archives', { dropped })
  }
}

/** Test-only helper: fully reset the cache. */
export function resetFrozenArchiveCacheForTests(): void {
  cache.clear()
}

async function computeFrozenArchive(
  characterId: string,
  size: number,
  presentCharacterIds: readonly string[],
): Promise<Memory[]> {
  const repos = getRepositories()
  const poolSize = Math.max(size, size * FROZEN_ARCHIVE_POOL_FACTOR)

  // 1 + 2: digests first — what the character knows about each person in the
  // room, then about themself. Each fetch is hot-only and ordered by
  // reinforced importance, so membership is deterministic.
  const chosen = new Map<string, Memory>()
  const take = (memories: Memory[]) => {
    for (const m of memories) {
      if (chosen.size >= size) return
      if (!chosen.has(m.id)) chosen.set(m.id, m)
    }
  }
  for (const otherId of presentCharacterIds) {
    take(await repos.memories.findHotDigests(characterId, otherId, FROZEN_ARCHIVE_DIGESTS_PER_PRESENT))
  }
  take(await repos.memories.findHotDigests(characterId, 'self', FROZEN_ARCHIVE_SELF_DIGESTS))
  const digestCount = chosen.size

  // 3: fill with the cheap top-by-reinforced-importance pull, re-ranked by
  // effective weight (importance x time decay), skipping what is already in.
  if (chosen.size < size) {
    const candidates = await repos.memories.findMostImportant(characterId, poolSize)
    const ranked = candidates
      .filter(memory => !chosen.has(memory.id))
      .map(memory => ({
        memory,
        effectiveWeight: calculateEffectiveWeight(memory).effectiveWeight,
      }))
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
      .map(({ memory }) => memory)
    take(ranked)
  }

  logger.debug('[FrozenArchive] Composed archive', {
    characterId,
    size,
    presentCharacters: presentCharacterIds.length,
    digests: digestCount,
    filled: chosen.size - digestCount,
  })

  const result = [...chosen.values()]
  result.sort((a, b) => a.id.localeCompare(b.id))
  return result
}
