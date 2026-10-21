/**
 * Frozen Memory Archive Cache (Phase 3a)
 *
 * Per-character memory pool that stays byte-stable across turns within a
 * single `compactionGeneration`. The archive is the cache-friendly bulk of
 * what a character "remembers" generally. Composition (consolidation spec §5,
 * inner-circle-recall.md B2):
 *
 * 1. the top hot digests about each *other* character present this turn;
 * 2. the top self digests;
 * 3. the **inner circle** — hot digests about each character the holder shares
 *    a group with, tightest group first, capped at a share of the archive;
 * 4. a fill of the highest effective-weight hot rows up to the budget-sized N.
 *
 * Steps 1, 2 and 4 are the anchors, sorted by memory id so the formatted output
 * is deterministic; step 3 is kept apart, in circle order, because it renders
 * in full text under its own heading. Cold rows never enter (the repository
 * reads are hot-only).
 *
 * Cache key: `(characterId, chatId)`, with the chat's `compactionGeneration`,
 * the archive size, who is present and the circle's signature as the
 * freshness check. The circle is re-read each turn (a few small mount-index
 * reads), so a membership change or an archived member reaches the next turn
 * without an explicit invalidation. Keying on the chat matters:
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
import { sortBySalience } from '../scoring'
import { processSingleton } from '@/lib/utils/process-singleton'
import { INNER_CIRCLE_ALLOWANCE, INNER_CIRCLE_ARCHIVE_SHARE } from './tags'
import {
  innerCircleAllowanceFor,
  innerCircleSignature,
  resolveInnerCircle,
  type InnerCircleMember,
} from './inner-circle'
import { innerCircleTrimOrder, type InnerCircleEntry } from './types'

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

/** A frozen archive: the anchors and the inner circle. */
export interface FrozenArchive {
  /** `## Memory Anchors` rows, sorted by memory id. */
  anchors: Memory[]
  /** `## Those Closest to You` rows, in circle order (tier, group, member, then the member's own digest order). */
  circle: InnerCircleEntry[]
}

/** The inner circle's knobs (defaults: {@link INNER_CIRCLE_ARCHIVE_SHARE}, {@link INNER_CIRCLE_ALLOWANCE}). */
export interface InnerCircleOptions {
  share: number
  allowance: readonly number[]
}

interface CacheEntry {
  characterId: string
  generation: number
  size: number
  /** Sorted, joined ids of the other characters present when computed. */
  presence: string
  /** The knobs and {@link innerCircleSignature} the circle was drawn with. */
  circle: string
  archive: FrozenArchive
}

/** Insertion-ordered: the first key is the least recently used. */
const cache = processSingleton('memory.frozenArchiveCache', () => new Map<string, CacheEntry>())

function cacheKey(characterId: string, chatId: string): string {
  return `${characterId}\u0000${chatId}`
}

/**
 * Look up (or compute and cache) the frozen memory archive for a character in
 * a chat at a given compaction generation. Holds at most `size` memories in
 * all: the anchors sorted ascending by `memory.id` and the circle in circle
 * order, so the formatted output is deterministic across turns.
 */
export async function getOrComputeFrozenArchive(
  characterId: string,
  chatId: string,
  compactionGeneration: number,
  options: {
    size?: number
    /** Characters present this turn (the responder is ignored if listed). */
    presentCharacterIds?: readonly string[]
    /**
     * Rows to leave out, and compute without touching the cache — the replay's
     * `asOf` corpus. A live turn never passes it.
     */
    exclude?: ReadonlySet<string>
    /** The inner circle's knobs (the replay's tuning). Absent → the shipped defaults. */
    innerCircle?: InnerCircleOptions
  } = {},
): Promise<FrozenArchive> {
  const size = options.size ?? FROZEN_ARCHIVE_SIZE
  const present = [...new Set(options.presentCharacterIds ?? [])]
    .filter(id => id && id !== characterId)
    .sort()
  const presence = present.join(',')
  const knobs = options.innerCircle ?? { share: INNER_CIRCLE_ARCHIVE_SHARE, allowance: INNER_CIRCLE_ALLOWANCE }
  const members = await resolveInnerCircle(characterId, { excludeIds: new Set(present) })
  if (options.exclude) {
    return computeFrozenArchive(characterId, size, present, members, knobs, options.exclude)
  }
  const circle = `${knobs.share}|${knobs.allowance.join(',')}|${innerCircleSignature(members)}`
  const key = cacheKey(characterId, chatId)
  const cached = cache.get(key)

  if (
    cached &&
    cached.generation === compactionGeneration &&
    cached.size === size &&
    cached.presence === presence &&
    cached.circle === circle
  ) {
    // Refresh recency.
    cache.delete(key)
    cache.set(key, cached)
    return cached.archive
  }

  const archive = await computeFrozenArchive(characterId, size, present, members, knobs)
  cache.delete(key)
  cache.set(key, { characterId, generation: compactionGeneration, size, presence, circle, archive })
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
    circleMembers: members.length,
    anchors: archive.anchors.length,
    circle: archive.circle.length,
    cacheEntries: cache.size,
  })
  return archive
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
  members: readonly InnerCircleMember[],
  knobs: InnerCircleOptions,
  exclude?: ReadonlySet<string>,
): Promise<FrozenArchive> {
  const repos = getRepositories()
  const poolSize = Math.max(size, size * FROZEN_ARCHIVE_POOL_FACTOR)

  // 1 + 2: digests first — what the character knows about each person in the
  // room, then about themself. Each fetch is hot-only and ordered by
  // reinforced importance, so membership is deterministic.
  const chosen = new Map<string, Memory>()
  const take = (memories: Memory[]) => {
    for (const m of memories) {
      if (chosen.size >= size) return
      if (!chosen.has(m.id) && !exclude?.has(m.id)) chosen.set(m.id, m)
    }
  }
  for (const otherId of presentCharacterIds) {
    take(await repos.memories.findHotDigests(characterId, otherId, FROZEN_ARCHIVE_DIGESTS_PER_PRESENT))
  }
  take(await repos.memories.findHotDigests(characterId, 'self', FROZEN_ARCHIVE_SELF_DIGESTS))
  const digestCount = chosen.size

  // 3: the inner circle, capped at its share of the archive.
  const cap = Math.min(Math.floor(size * knobs.share), size - chosen.size)
  const circle = await drawInnerCircle(characterId, members, knobs.allowance, cap, chosen, exclude)
  for (const entry of circle) chosen.set(entry.memory.id, entry.memory)

  // 4: fill with the cheap top-by-reinforced-importance pull, re-ranked by
  // salience (reinforced importance x time decay), skipping what is already in.
  if (chosen.size < size) {
    const candidates = await repos.memories.findMostImportant(characterId, poolSize)
    const ranked = sortBySalience(candidates.filter(memory => !chosen.has(memory.id)))
    take(ranked)
  }

  const circleIds = new Set(circle.map(e => e.memory.id))
  const anchors = [...chosen.values()].filter(m => !circleIds.has(m.id))
  anchors.sort((a, b) => a.id.localeCompare(b.id))

  logger.debug('[FrozenArchive] Composed archive', {
    characterId,
    size,
    presentCharacters: presentCharacterIds.length,
    digests: digestCount,
    circleMembers: members.length,
    circle: circle.length,
    circleCap: cap,
    filled: anchors.length - digestCount,
  })

  return { anchors, circle }
}

/**
 * Step 3: each circle member's hot digests up to their tier's allowance, in
 * circle order. When the draw exceeds `cap` the loosest tier gives up rows
 * first, each member's later digests before anyone's first, so a cut circle
 * keeps one line for as many of the closest as it can. A tier is not read at
 * all once the tighter tiers already fill the cap — it would be cut whole.
 */
async function drawInnerCircle(
  characterId: string,
  members: readonly InnerCircleMember[],
  allowance: readonly number[],
  cap: number,
  chosen: ReadonlyMap<string, Memory>,
  exclude?: ReadonlySet<string>,
): Promise<InnerCircleEntry[]> {
  if (cap <= 0 || members.length === 0) return []
  const repos = getRepositories()
  const drawn: InnerCircleEntry[] = []
  const seen = new Set<string>()
  let tier = -1
  for (const [order, member] of members.entries()) {
    if (member.tier !== tier) {
      if (drawn.length >= cap) break
      tier = member.tier
    }
    const limit = innerCircleAllowanceFor(member.tier, allowance)
    if (limit <= 0) continue
    const digests = await repos.memories.findHotDigests(characterId, member.characterId, limit)
    let rank = 0
    for (const memory of digests) {
      if (chosen.has(memory.id) || seen.has(memory.id) || exclude?.has(memory.id)) continue
      seen.add(memory.id)
      drawn.push({ memory, characterId: member.characterId, tier: member.tier, rank: rank++, order })
    }
  }
  if (drawn.length <= cap) return drawn
  const kept = new Set(innerCircleTrimOrder(drawn).slice(0, cap))
  return drawn.filter(entry => kept.has(entry))
}
