/**
 * Memory Merge — fold duplicate memories into a survivor
 *
 * The one place two (or more) memories become one. Deduplication
 * (`lib/tools/memory-dedup.ts`) and housekeeping's similarity pass
 * (`lib/memory/housekeeping.ts`) both call it, so a merged-away row keeps
 * what it knew instead of simply vanishing:
 *
 * - novel details from each loser append to the survivor as `[+]` footnotes,
 *   up to {@link MAX_REINFORCEMENT_FOOTNOTES}
 * - `reinforcementCount` sums (each loser was itself an observation)
 * - `relatedMemoryIds` union, minus the survivor, the losers, and anything
 *   else being deleted in the same pass
 * - `occurredAt` keeps the earliest non-null value
 * - `reinforcedImportance` is recomputed from the survivor's base importance
 * - the survivor is re-embedded when its content changed
 *
 * Order matters: callers apply the merge BEFORE deleting the losers, and
 * delete only the losers whose fold succeeded — a failed fold keeps its
 * losers rather than discarding what the survivor never absorbed. The delete
 * (`deleteMemoriesWithUnlinkBatch`) is passed the patched survivors as
 * `skipScrubIds`: their links already exclude every doomed id, and in the job
 * child the scrub is computed from the pre-merge row, so letting it rewrite a
 * survivor would overwrite the union.
 */

import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import {
  appendCappedFootnotes,
  calculateReinforcedImportance,
  extractNovelDetails,
  patchMemory,
  reembedMemory,
} from './memory-gate'

export interface MemoryMergePlan {
  survivorId: string
  /** Patch to apply to the survivor; empty when the merge changes nothing. */
  patch: Partial<Memory>
  /** Details actually appended as footnotes (after the cap). */
  mergedDetails: string[]
  /** True when the survivor's content changed (so it must be re-embedded). */
  contentChanged: boolean
}

function earliestOccurredAt(values: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestMs = Infinity
  for (const value of values) {
    if (!value) continue
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) continue
    if (ms < bestMs) {
      bestMs = ms
      best = value
    }
  }
  return best
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every(id => set.has(id))
}

/**
 * Work out what folding `losers` into `survivor` changes. Pure — no writes.
 *
 * @param excludeIds ids that must not appear in the survivor's links (the
 *   rest of the batch being deleted alongside the losers).
 */
export function planMemoryMerge(
  survivor: Memory,
  losers: Memory[],
  excludeIds: Iterable<string> = [],
): MemoryMergePlan {
  const excluded = new Set<string>(excludeIds)
  excluded.add(survivor.id)
  for (const loser of losers) excluded.add(loser.id)

  // Novel details, judged against the survivor's content as it grows so two
  // losers carrying the same detail append it once.
  let content = survivor.content
  const mergedDetails: string[] = []
  for (const loser of losers) {
    const novel = extractNovelDetails(loser.content, content)
    if (novel.length === 0) continue
    const { content: next, appended } = appendCappedFootnotes(content, novel)
    content = next
    mergedDetails.push(...appended)
  }
  const contentChanged = content !== survivor.content

  const reinforcementCount = losers.reduce(
    (sum, loser) => sum + (loser.reinforcementCount ?? 1),
    survivor.reinforcementCount ?? 1,
  )

  const existingLinks = survivor.relatedMemoryIds ?? []
  const linkSet = new Set<string>()
  for (const id of [...existingLinks, ...losers.flatMap(l => l.relatedMemoryIds ?? [])]) {
    if (!excluded.has(id)) linkSet.add(id)
  }
  const relatedMemoryIds = Array.from(linkSet)

  const occurredAt = earliestOccurredAt([survivor.occurredAt, ...losers.map(l => l.occurredAt)])

  const lastReinforcedAt = [survivor.lastReinforcedAt, ...losers.map(l => l.lastReinforcedAt)]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort()
    .pop()

  const patch: Partial<Memory> = {}
  if (contentChanged) patch.content = content
  if (reinforcementCount !== (survivor.reinforcementCount ?? 1)) {
    patch.reinforcementCount = reinforcementCount
    patch.reinforcedImportance = calculateReinforcedImportance(survivor.importance, reinforcementCount)
  }
  if (!sameIds(relatedMemoryIds, existingLinks)) patch.relatedMemoryIds = relatedMemoryIds
  if (occurredAt && occurredAt !== survivor.occurredAt) patch.occurredAt = occurredAt
  if (lastReinforcedAt && lastReinforcedAt !== survivor.lastReinforcedAt) {
    patch.lastReinforcedAt = lastReinforcedAt
  }

  return { survivorId: survivor.id, patch, mergedDetails, contentChanged }
}

/**
 * Apply a merge plan to the survivor and re-embed it when its content (or its
 * anchor date) changed. Returns the survivor as it now stands, or null when
 * the row could not be updated.
 *
 * `userId` is needed for the re-embed; without it a changed survivor keeps its
 * old vector (logged) until the next reindex.
 */
export async function applyMemoryMerge(
  survivor: Memory,
  plan: MemoryMergePlan,
  options: { userId?: string; embeddingProfileId?: string } = {},
): Promise<Memory | null> {
  if (Object.keys(plan.patch).length === 0) {
    logger.debug('[MemoryMerge] Nothing to fold into survivor', { survivorId: survivor.id })
    return survivor
  }

  const updated = await patchMemory(survivor, plan.patch)
  if (!updated) {
    logger.warn('[MemoryMerge] Failed to update survivor', {
      survivorId: survivor.id,
      characterId: survivor.characterId,
    })
    return null
  }

  const needsReembed = plan.contentChanged || plan.patch.occurredAt !== undefined
  if (needsReembed) {
    if (options.userId) {
      await reembedMemory(updated, options.userId, options.embeddingProfileId)
    } else {
      logger.warn('[MemoryMerge] Survivor changed but no userId to re-embed with', {
        survivorId: survivor.id,
      })
    }
  }

  logger.debug('[MemoryMerge] Folded losers into survivor', {
    survivorId: survivor.id,
    fields: Object.keys(plan.patch),
    mergedDetails: plan.mergedDetails.length,
    reembedded: needsReembed && !!options.userId,
  })
  return updated
}
