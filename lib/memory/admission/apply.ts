/**
 * The writes behind an admission decision and a fold, in the parent.
 *
 * Every write here lands on the parent's read-write connection and returns the
 * row as it now stands — no buffered local views (admission moved out of the
 * job child in Phase C). Counts, footnotes and links are written as deltas
 * against the row at write time (`incrementReinforcement`,
 * `appendReinforcementFootnotes`, `addRelatedMemoryIds`), so two admissions of
 * the same row never overwrite each other's (bugs 182, 231).
 *
 * @module memory/admission/apply
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { memoryIndex, embeddingTextFor } from '../index-store'
import { calculateReinforcedImportance } from '../scoring'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'
import type { FoldPlan } from './fold'
import type { AdmissionRow } from './types'

const log = logger.child({ module: 'memory:admission:apply' })

/** A row without its vector, for outcomes and the host-RPC reply. */
export function withoutEmbedding(memory: Memory): Memory {
  if (memory.embedding === undefined) return memory
  const { embedding: _embedding, ...rest } = memory
  return rest as Memory
}

/**
 * Insert a new row together with its embedding and cache the vector. The
 * embedding rides in the `create` itself, so no row exists without its vector
 * (invariant 4) and none is written twice.
 */
export async function insertRow(row: AdmissionRow, embedding: Float32Array): Promise<Memory> {
  const importance = row.importance ?? 0.5
  const memory = await getRepositories().memories.create(
    {
      characterId: row.characterId,
      content: row.content,
      summary: row.summary,
      keywords: row.keywords ?? [],
      tags: row.tags ?? [],
      importance,
      aboutCharacterId: row.aboutCharacterId || null,
      chatId: row.chatId || null,
      projectId: row.projectId ?? null,
      source: row.source || 'MANUAL',
      sourceMessageId: row.sourceMessageId || null,
      witnessedContext: row.witnessedContext ?? null,
      occurredAt: row.occurredAt ?? null,
      narrativeTime: row.narrativeTime ?? null,
      entities: row.entities ?? [],
      kind: row.kind ?? 'semantic',
      reinforcementCount: 1,
      relatedMemoryIds: [],
      // Bug 216: one formula for every writer — at count 1 it equals importance.
      reinforcedImportance: calculateReinforcedImportance(importance, 1),
      embedding,
    },
    row.sourceMessageTimestamp
      ? { createdAt: row.sourceMessageTimestamp, updatedAt: row.sourceMessageTimestamp }
      : undefined,
  )
  // A new row is always hot.
  await memoryIndex.indexInserted(row.characterId, [{ id: memory.id, embedding, tier: 'hot' }])
  log.debug('New memory persisted', { characterId: row.characterId, memoryId: memory.id, source: row.source })
  return memory
}

/**
 * Link a new row and its neighbours both ways. Returns the new row's link
 * list as written.
 */
export async function linkBothWays(characterId: string, memoryId: string, linkTo: readonly string[]): Promise<string[]> {
  const repos = getRepositories()
  const targets = linkTo.filter((id) => id !== memoryId)
  for (const id of targets) {
    await repos.memories.addRelatedMemoryIds(characterId, id, [memoryId])
  }
  const written = targets.length > 0 ? await repos.memories.addRelatedMemoryIds(characterId, memoryId, targets) : []
  log.debug('Linked new memory to neighbours', { characterId, memoryId, linked: targets.length })
  return written ?? targets
}

/**
 * Re-embed a row from its current text and write the vector through the index
 * (tier kept). Best-effort: a failure leaves the old vector and returns false.
 */
export async function reembedRow(memory: Memory, userId: string, embeddingProfileId?: string): Promise<boolean> {
  try {
    const { embedding } = await generateEmbeddingForUser(
      embeddingTextFor(memory, await refreshMemoryTimeZone()),
      userId,
      embeddingProfileId,
      { priority: 'background' },
    )
    await memoryIndex.upsert(memory.characterId, [
      { id: memory.id, embedding, tier: memory.tier === 'cold' ? 'cold' : 'hot' },
    ])
    log.debug('Re-embedded memory', { memoryId: memory.id })
    return true
  } catch (error) {
    log.warn('Failed to re-embed memory; it keeps its old vector', {
      memoryId: memory.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Write a fold plan to its survivor and re-embed it when the plan says so.
 * Returns the survivor as it now stands, or null when nothing landed (the row
 * is gone). The first write that lands is the commit point: once the survivor
 * holds what the absorbed sources knew, a later miss is logged and the fold
 * stands, so a caller deleting the absorbed rows does not keep them beside a
 * survivor that already took them in.
 *
 * Without a `userId` a changed survivor keeps its old vector (logged) until
 * the next reindex.
 */
export async function applyFold(
  survivor: Memory,
  plan: FoldPlan,
  opts: { userId?: string; embeddingProfileId?: string } = {},
): Promise<Memory | null> {
  const repos = getRepositories()
  const { characterId, id } = survivor
  let current: Memory = survivor
  let landed = false
  const missed = (step: string): null | undefined => {
    if (!landed) {
      log.warn('Fold target is gone; nothing folded', { survivorId: id, characterId, step })
      return null
    }
    log.warn('Fold step missed after the fold landed; the fold stands', { survivorId: id, characterId, step })
    return undefined
  }

  if (plan.footnotes.length > 0) {
    const written = await repos.memories.appendReinforcementFootnotes(characterId, id, plan.footnotes)
    if (!written) {
      if (missed('footnotes') === null) return null
    } else {
      current = { ...current, content: written.content }
      landed = true
    }
  }

  if (Object.keys(plan.patch).length > 0) {
    const row = await repos.memories.updateForCharacter(characterId, id, plan.patch)
    if (!row) {
      if (missed('anchors') === null) return null
    } else {
      current = row
      landed = true
    }
  }

  if (plan.addLinks.length > 0) {
    const links = await repos.memories.addRelatedMemoryIds(characterId, id, plan.addLinks)
    if (!links) {
      if (missed('links') === null) return null
    } else {
      current = { ...current, relatedMemoryIds: links }
      landed = true
    }
  }

  if (plan.reinforcementDelta > 0) {
    const counted = await repos.memories.incrementReinforcement(
      characterId,
      id,
      plan.reinforcedAt ?? new Date().toISOString(),
      plan.reinforcementDelta,
    )
    if (!counted) {
      if (missed('reinforcement') === null) return null
    } else {
      current = { ...current, ...counted }
      landed = true
    }
  }

  let reembedded = false
  if (plan.reembed && landed) {
    if (opts.userId) {
      reembedded = await reembedRow(current, opts.userId, opts.embeddingProfileId)
    } else {
      log.warn('Survivor changed but no userId to re-embed with', { survivorId: id })
    }
  }

  log.debug('Folded into survivor', {
    survivorId: id,
    characterId,
    footnotes: plan.footnotes.length,
    anchors: Object.keys(plan.patch),
    links: plan.addLinks.length,
    reinforcementDelta: plan.reinforcementDelta,
    reembedded,
  })
  return current
}

/**
 * A hand-written candidate folded into a row raises that row's importance to
 * the one asked for, when higher, and recomputes `reinforcedImportance` from
 * the row's count. (It never folds into an extracted row: the decider links it
 * instead.)
 */
export async function raiseImportance(memory: Memory, requested: number | undefined): Promise<Memory> {
  if (requested === undefined || requested <= memory.importance) return memory
  const updated = await getRepositories().memories.updateForCharacter(memory.characterId, memory.id, {
    importance: requested,
    reinforcedImportance: calculateReinforcedImportance(requested, memory.reinforcementCount ?? 1),
  })
  if (!updated) {
    log.warn('Failed to raise the importance of a row a manual memory folded into', { memoryId: memory.id })
    return memory
  }
  log.debug('Raised importance for a manual write', { memoryId: memory.id, importance: requested })
  return updated
}
