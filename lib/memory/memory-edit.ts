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
 *   - a digest's Commonplace mirror bucket(s) are rewritten.
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
import { calculateReinforcedImportance } from './reinforced-importance'
import { updateMemoryWithEmbedding } from './memory-service'
import { invalidateFrozenArchive } from './frozen-archive-cache'
import type { CommonplaceDigestEntry } from './commonplace-file'

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
  const memory = await updateMemoryWithEmbedding(characterId, memoryId, update, {
    userId: options.userId,
  })
  if (!memory) return { ok: false, reason: 'not-found' }

  for (const id of added) {
    const neighbour = await repos.memories.findByIdForCharacter(characterId, id)
    if (!neighbour) continue
    const links = neighbour.relatedMemoryIds ?? []
    if (!links.includes(memoryId)) {
      await repos.memories.updateForCharacter(characterId, id, { relatedMemoryIds: [...links, memoryId] })
    }
  }
  for (const id of removed) {
    const neighbour = await repos.memories.findByIdForCharacter(characterId, id)
    if (!neighbour) continue
    const links = neighbour.relatedMemoryIds ?? []
    if (links.includes(memoryId)) {
      await repos.memories.updateForCharacter(characterId, id, {
        relatedMemoryIds: links.filter((l) => l !== memoryId),
      })
    }
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
    const subjects = new Set<string | null>([
      existing.aboutCharacterId ?? null,
      memory.aboutCharacterId ?? null,
    ])
    await refreshCommonplaceMirror(characterId, subjects)
  }

  log.debug('Memory edited', {
    characterId,
    memoryId,
    fields: Object.keys(patch),
  })
  return { ok: true, memory }
}

/**
 * Rewrite the holder's Commonplace mirror file for each subject bucket given
 * (null = the no-subject bucket, which has no file). Each file is rebuilt from
 * every hot, embedded digest in that bucket — the same set consolidation
 * mirrors. Best-effort: a failure is logged, never thrown.
 */
async function refreshCommonplaceMirror(
  holderId: string,
  subjects: ReadonlySet<string | null>,
): Promise<void> {
  const targets = Array.from(subjects).filter((s): s is string => s !== null)
  if (targets.length === 0) return
  try {
    const repos = getRepositories()
    const holder = await repos.characters.findByIdRaw(holderId)
    if (!holder) return

    const digestsBySubject = new Map<string, CommonplaceDigestEntry[]>()
    for (const subject of targets) digestsBySubject.set(subject, [])
    for (const row of await repos.memories.findByCharacterId(holderId)) {
      if (row.source !== 'CONSOLIDATED' || (row.tier ?? 'hot') !== 'hot') continue
      if (!row.embedding || row.embedding.length === 0) continue
      const subject = row.aboutCharacterId ?? null
      if (subject === null) continue
      const bucket = digestsBySubject.get(subject)
      if (!bucket) continue
      bucket.push({
        content: row.content,
        kind: row.kind ?? 'semantic',
        occurredAt: row.occurredAt ?? null,
        reinforcedImportance: row.reinforcedImportance ?? row.importance,
      })
    }

    const files = []
    for (const [subject, digests] of digestsBySubject) {
      const isSelf = subject === holderId
      let subjectName = holder.name
      if (!isSelf) {
        const other = await repos.characters.findByIdRaw(subject)
        if (!other) continue // consolidation writes no file for a vanished subject
        subjectName = other.name
      }
      files.push({ subjectCharacterId: subject, subjectName, isSelf, digests })
    }
    if (files.length === 0) return

    const { writeCommonplaceDigestsToVault } = await import(
      '@/lib/file-storage/commonplace-digest-vault-bridge'
    )
    const result = await writeCommonplaceDigestsToVault({
      holderCharacterId: holderId,
      files,
      updatedAt: new Date().toISOString(),
    })
    log.debug('Refreshed Commonplace mirror after digest edit', { characterId: holderId, ...result })
  } catch (error) {
    log.warn('Commonplace mirror refresh failed after digest edit (the digest itself is saved)', {
      characterId: holderId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
