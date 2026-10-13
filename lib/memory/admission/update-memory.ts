/**
 * Hand edits to a memory (the memory editor's `PUT /api/v1/memories/[id]`, and
 * search and replace).
 *
 * A memory row carries derived state beside the text a person edits: its
 * vector, `reinforcedImportance`, the character's frozen archive, the
 * `memories` realtime topic and, for a consolidation digest, the Commonplace
 * mirror in the holder's vault. A raw `updateForCharacter` left all of it
 * describing the row as it was before the edit (bug 203). {@link updateMemory}
 * keeps every piece in step:
 *
 *   - a change to the embedded text (summary, content or an anchor) embeds the
 *     edited text first and writes text and vector in one row update through
 *     `memoryIndex.upsert` (anchor line included, tier kept); a failed embed
 *     writes nothing;
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
 * @module memory/admission/update-memory
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { publishRealtime } from '@/lib/realtime/bus'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { calculateReinforcedImportance } from '../scoring'
import { invalidateFrozenArchive } from '../frozen-archive-cache'
import { mirrorCommonplaceForSubjects } from '../commonplace-mirror'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'
import { memoryIndex, embeddingTextFor } from '../index-store'

const log = logger.child({ module: 'memory:update-memory' })

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

export type UpdateMemoryResult =
  | { ok: true; memory: Memory }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid-related'; invalidIds: string[] }
  /** The edited text could not be embedded; nothing was written. */
  | { ok: false; reason: 'embedding-failed'; message: string }

/** Does the patch change the text the row is embedded as? */
function changesEmbeddedText(existing: Memory, patch: Partial<Memory>): boolean {
  return (
    (patch.content !== undefined && patch.content !== existing.content) ||
    (patch.summary !== undefined && patch.summary !== existing.summary) ||
    (patch.occurredAt !== undefined && patch.occurredAt !== existing.occurredAt) ||
    (patch.narrativeTime !== undefined && patch.narrativeTime !== existing.narrativeTime) ||
    (patch.entities !== undefined &&
      JSON.stringify(patch.entities) !== JSON.stringify(existing.entities ?? []))
  )
}

/**
 * Apply a hand edit to one memory and bring its derived state with it.
 */
export async function updateMemory(
  characterId: string,
  memoryId: string,
  patch: MemoryEditPatch,
  options: { userId: string },
): Promise<UpdateMemoryResult> {
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
  // Embed first, write second: a failed embed leaves the row (and so the
  // links below, the archive and the mirror) exactly as they were. The vector
  // rides in the same row update as the text, so they never disagree on disk.
  let memory: Memory | null
  if (changesEmbeddedText(existing, update)) {
    let embedding: Float32Array
    try {
      const merged = { ...existing, ...update } as Memory
      embedding = (await generateEmbeddingForUser(
        embeddingTextFor(merged, await refreshMemoryTimeZone()),
        options.userId,
      )).embedding
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('Memory edit refused: the edited text could not be embedded', {
        characterId,
        memoryId,
        error: message,
      })
      return { ok: false, reason: 'embedding-failed', message: `Could not embed the edited memory: ${message}` }
    }
    const [row] = await memoryIndex.upsert(characterId, [{ id: memoryId, embedding, alongside: update }])
    memory = row
    log.debug('Edited memory re-embedded', { characterId, memoryId })
  } else {
    memory = await repos.memories.updateForCharacter(characterId, memoryId, update)
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
