/**
 * Hand edits to a memory (the memory editor's `PUT /api/v1/memories/[id]`).
 *
 * A memory row carries derived state beside the text a person edits: its
 * vector, `reinforcedImportance`, the character's frozen archive, the
 * `memories` realtime topic and, for a consolidation digest, the Commonplace
 * mirror in the holder's vault. A raw `updateForCharacter` left all of it
 * describing the row as it was before the edit (bug 203). {@link editMemory}
 * keeps every piece in step:
 *
 *   - text changes re-embed through `updateMemoryWithEmbedding` (anchor line
 *     included, vector store updated, tier preserved);
 *   - an importance change recomputes `reinforcedImportance` from the row's
 *     reinforcement count;
 *   - `relatedMemoryIds` must name existing memories of the same character, and
 *     the link is written on both sides;
 *   - the frozen archive is invalidated and `memories` is published;
 *   - a digest's Commonplace mirror bucket(s) are rewritten through
 *     `mirrorCommonplaceForSubjects`, the same writer consolidation uses.
 *
 * Parent-process only (it publishes realtime hints and invalidates the
 * parent's archive cache).
 *
 * @module memory/memory-edit
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { publishRealtime } from '@/lib/realtime/bus'
import { calculateReinforcedImportance } from './scoring'
import { MemoryReembedError, updateMemoryWithEmbedding } from './memory-service'
import { invalidateFrozenArchive } from './frozen-archive-cache'
import { mirrorCommonplaceForSubjects } from './commonplace-mirror'

const log = logger.child({ module: 'memory:memory-edit' })

/** The fields a hand edit may change. */
export interface MemoryEditPatch {
  content?: string
  summary?: string
  keywords?: string[]
  tags?: string[]
  importance?: number
  aboutCharacterId?: string | null
  chatId?: string | null
  relatedMemoryIds?: string[]
}

export type EditMemoryResult =
  | { ok: true; memory: Memory }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid-related'; invalidIds: string[] }
  /** The edited text could not be embedded; nothing was written. */
  | { ok: false; reason: 'embedding-failed'; message: string }

/**
 * Apply a hand edit to one memory and bring its derived state with it.
 */
export async function editMemory(
  characterId: string,
  memoryId: string,
  patch: MemoryEditPatch,
  options: { userId: string },
): Promise<EditMemoryResult> {
  const repos = getRepositories()
  const existing = await repos.memories.findByIdForCharacter(characterId, memoryId)
  if (!existing) return { ok: false, reason: 'not-found' }

  const update: Partial<Memory> = { ...patch }
  delete update.relatedMemoryIds

  // --- importance → reinforcedImportance -------------------------------------
  if (patch.importance !== undefined && patch.importance !== existing.importance) {
    update.reinforcedImportance = calculateReinforcedImportance(
      patch.importance,
      existing.reinforcementCount ?? 1,
    )
    log.debug('Recomputed reinforcedImportance for edited importance', {
      characterId,
      memoryId,
      importance: patch.importance,
      reinforcementCount: existing.reinforcementCount ?? 1,
      reinforcedImportance: update.reinforcedImportance,
    })
  }

  // --- relatedMemoryIds: validate, then link both sides ---------------------
  let added: string[] = []
  let removed: string[] = []
  if (patch.relatedMemoryIds !== undefined) {
    const requested = Array.from(new Set(patch.relatedMemoryIds)).filter((id) => id !== memoryId)
    const invalidIds: string[] = []
    for (const id of requested) {
      const neighbour = await repos.memories.findByIdForCharacter(characterId, id)
      if (!neighbour) invalidIds.push(id)
    }
    if (invalidIds.length > 0) {
      log.debug('Refusing memory edit: related ids missing or belong to another character', {
        characterId,
        memoryId,
        invalidIds,
      })
      return { ok: false, reason: 'invalid-related', invalidIds }
    }
    const before = new Set(existing.relatedMemoryIds ?? [])
    const after = new Set(requested)
    added = requested.filter((id) => !before.has(id))
    removed = Array.from(before).filter((id) => !after.has(id))
    update.relatedMemoryIds = requested
  }

  // --- the row, re-embedded when its embedded text changed ------------------
  // Embeds before it writes: a failed embed leaves the row (and so the links
  // below, the archive and the mirror) exactly as they were.
  let memory: Memory | null
  try {
    memory = await updateMemoryWithEmbedding(characterId, memoryId, update, {
      userId: options.userId,
    })
  } catch (error) {
    if (error instanceof MemoryReembedError) {
      log.warn('Memory edit refused: the edited text could not be embedded', {
        characterId,
        memoryId,
        error: error.message,
      })
      return { ok: false, reason: 'embedding-failed', message: error.message }
    }
    throw error
  }
  if (!memory) return { ok: false, reason: 'not-found' }

  // Neighbour links are deltas against the rows at write time, so an
  // extraction job linking the same neighbour keeps its link (bug 231).
  for (const id of added) {
    await repos.memories.addRelatedMemoryIds(characterId, id, [memoryId])
  }
  for (const id of removed) {
    await repos.memories.removeRelatedMemoryIds(characterId, id, [memoryId])
  }
  if (added.length > 0 || removed.length > 0) {
    log.debug('Mirrored edited memory links onto neighbours', { characterId, memoryId, added, removed })
  }

  // --- caches and mirrors ---------------------------------------------------
  invalidateFrozenArchive(characterId)
  publishRealtime('memories')

  if (existing.source === 'CONSOLIDATED' && (existing.tier ?? 'hot') === 'hot') {
    // A digest's bucket is its subject (consolidation's `bucketKeyOf`); an
    // edit that moves `aboutCharacterId` touches both the old and new file.
    // The no-subject bucket has no mirror file. Never throws.
    const subjects = [existing.aboutCharacterId, memory.aboutCharacterId].filter(
      (s): s is string => typeof s === 'string' && s.length > 0
    )
    const written = await mirrorCommonplaceForSubjects(characterId, subjects)
    log.debug('Refreshed Commonplace mirror after digest edit', { characterId, memoryId, subjects, written })
  }

  log.debug('Memory edited', {
    characterId,
    memoryId,
    fields: Object.keys(patch),
  })
  return { ok: true, memory }
}
