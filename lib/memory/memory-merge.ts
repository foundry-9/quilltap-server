/**
 * Memory Merge — fold duplicate memories into a survivor
 *
 * The one place two (or more) memories become one. The dedup tool
 * (`lib/tools/memory-dedup.ts`) calls it, so a merged-away row keeps what it
 * knew instead of simply vanishing:
 *
 * - novel details from each loser append to the survivor as `[+]` footnotes,
 *   up to {@link MAX_REINFORCEMENT_FOOTNOTES}
 * - `reinforcementCount` grows by the losers' counts (each loser was itself an
 *   observation), applied as a delta through the atomic
 *   `incrementReinforcement` — never an absolute total read at the start of
 *   the run, which would overwrite a reinforcement an extraction job
 *   committed meanwhile (bug 226, the lost update bug 182 fixed in the gate)
 * - `relatedMemoryIds` union, minus the survivor, the losers, and anything
 *   else being deleted in the same pass
 * - `occurredAt` keeps the earliest non-null value
 * - `reinforcedImportance` is recomputed from the survivor's base importance
 * - the survivor is re-embedded when its content changed
 *
 * Order matters: callers apply the merge BEFORE deleting the losers, and
 * delete only the losers whose fold succeeded — a failed fold keeps its
 * losers rather than discarding what the survivor never absorbed. A plan's
 * links exclude only its own group; `deleteMemoriesWithUnlinkBatch` then
 * scrubs the ids actually deleted with a removal delta applied after the
 * survivor's write, so the union loses only what was deleted (bug 234).
 * Links to anything that is kept survive.
 */

import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import {
  appendCappedFootnotes,
  countReinforcement,
  extractNovelDetails,
  patchMemory,
  reembedMemory,
} from './memory-gate'

export interface MemoryMergePlan {
  survivorId: string
  /**
   * Patch to apply to the survivor; empty when the merge changes nothing.
   * Never carries `reinforcementCount`, `reinforcedImportance` or
   * `lastReinforcedAt` — those move only through {@link reinforcementDelta}.
   */
  patch: Partial<Memory>
  /** Observations the losers bring; added to the survivor's count atomically. */
  reinforcementDelta: number
  /** Latest observation time among survivor and losers (never rewinds the row). */
  reinforcedAt: string | null
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

  const reinforcementDelta = losers.reduce((sum, loser) => sum + (loser.reinforcementCount ?? 1), 0)

  const existingLinks = survivor.relatedMemoryIds ?? []
  const linkSet = new Set<string>()
  for (const id of [...existingLinks, ...losers.flatMap(l => l.relatedMemoryIds ?? [])]) {
    if (!excluded.has(id)) linkSet.add(id)
  }
  const relatedMemoryIds = Array.from(linkSet)

  const occurredAt = earliestOccurredAt([survivor.occurredAt, ...losers.map(l => l.occurredAt)])

  // A loser that was never reinforced was still observed when it was created.
  const reinforcedAt = [
    survivor.lastReinforcedAt,
    ...losers.map(l => l.lastReinforcedAt ?? l.createdAt),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort()
    .pop() ?? null

  const patch: Partial<Memory> = {}
  if (contentChanged) patch.content = content
  if (!sameIds(relatedMemoryIds, existingLinks)) patch.relatedMemoryIds = relatedMemoryIds
  if (occurredAt && occurredAt !== survivor.occurredAt) patch.occurredAt = occurredAt

  return { survivorId: survivor.id, patch, reinforcementDelta, reinforcedAt, mergedDetails, contentChanged }
}

/**
 * Apply a merge plan to the survivor and re-embed it when its content (or its
 * anchor date) changed. Returns the survivor as it now stands, or null when
 * the row could not be updated. The survivor patch is the commit point: if it
 * lands and the reinforcement step then misses, the survivor is still returned
 * (with a warning) so callers delete the losers it absorbed.
 *
 * `userId` is needed for the re-embed; without it a changed survivor keeps its
 * old vector (logged) until the next reindex.
 */
export async function applyMemoryMerge(
  survivor: Memory,
  plan: MemoryMergePlan,
  options: { userId?: string; embeddingProfileId?: string } = {},
): Promise<Memory | null> {
  if (Object.keys(plan.patch).length === 0 && plan.reinforcementDelta === 0) {
    logger.debug('[MemoryMerge] Nothing to fold into survivor', { survivorId: survivor.id })
    return survivor
  }

  // The survivor patch is the commit point: once it lands, the survivor holds
  // what the losers knew, so a later miss on the separate reinforcement step
  // must not report the whole fold as failed (callers would then keep the
  // losers beside a survivor that already absorbed them).
  let updated: Memory | null = survivor
  const patched = Object.keys(plan.patch).length > 0
  if (patched) {
    updated = await patchMemory(survivor, plan.patch)
    if (!updated) {
      logger.warn('[MemoryMerge] Failed to update survivor', {
        survivorId: survivor.id,
        characterId: survivor.characterId,
      })
      return null
    }
  }

  if (plan.reinforcementDelta > 0) {
    const counted = await countReinforcement(updated, {
      by: plan.reinforcementDelta,
      at: plan.reinforcedAt ?? undefined,
    })
    if (!counted) {
      logger.warn('[MemoryMerge] Failed to count losers into survivor', {
        survivorId: survivor.id,
        characterId: survivor.characterId,
        reinforcementDelta: plan.reinforcementDelta,
        survivorPatched: patched,
      })
      // Nothing committed yet: the fold failed outright and the losers stay.
      if (!patched) return null
      // The patch already committed; the losers' counts are lost but their
      // content and links are not, so the fold stands.
    } else {
      updated = { ...updated, ...counted }
    }
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
    reinforcementDelta: plan.reinforcementDelta,
    mergedDetails: plan.mergedDetails.length,
    reembedded: needsReembed && !!options.userId,
  })
  return updated
}
