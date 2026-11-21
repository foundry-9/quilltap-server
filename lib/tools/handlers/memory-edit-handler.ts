/**
 * `read_memory` and `edit_memory` — a character reading and rewriting their
 * own memories.
 *
 * Both are scoped to the calling character: a memory is found only through
 * `findByIdForCharacter`, so another character's memory reads as missing.
 * The write is `requestMemoryEdit`, i.e. `updateMemory` (re-embed, reinforced
 * importance, two-sided links, archive and mirror refresh) — in the parent,
 * by host-RPC when the call comes from the job child. Whether the character
 * may use them at all is the tool offer's question (`canEditMemories`), not
 * this module's.
 *
 * @module tools/handlers/memory-edit-handler
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { requestMemoryEdit, type MemoryEditPatch } from '@/lib/memory/admission'
import type { Memory } from '@/lib/schemas/types'
import {
  readMemoryToolInputSchema,
  type EditableMemoryObject,
  type MemoryReadOnlyContext,
  type ReadMemoryToolOutput,
} from '../read-memory-tool'
import { editMemoryToolInputSchema, type EditMemoryToolInput, type EditMemoryToolOutput } from '../edit-memory-tool'

const log = logger.child({ module: 'tools:memory-edit' })

export interface MemoryEditToolContext {
  userId: string
  characterId: string
}

/** The object `edit_memory` takes, from a stored row. */
export function editableMemoryObject(memory: Memory): EditableMemoryObject {
  return {
    id: memory.id,
    content: memory.content,
    summary: memory.summary,
    keywords: [...(memory.keywords ?? [])],
    importance: memory.importance,
    about_character_id: memory.aboutCharacterId ?? null,
    related_memory_ids: [...(memory.relatedMemoryIds ?? [])],
  }
}

async function characterName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  try {
    const row = await getRepositories().characters.findByIdRaw(id)
    return row?.name ?? null
  } catch (error) {
    log.warn('Could not read the subject character of a memory', {
      aboutCharacterId: id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function inputError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`).join('; ')
}

export async function executeReadMemoryTool(
  input: unknown,
  context: MemoryEditToolContext,
): Promise<ReadMemoryToolOutput> {
  const parsed = readMemoryToolInputSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: `Invalid input — ${inputError(parsed.error)}` }

  const memory = await getRepositories().memories.findByIdForCharacter(context.characterId, parsed.data.id)
  if (!memory) {
    log.debug('read_memory: no such memory for this character', {
      characterId: context.characterId,
      memoryId: parsed.data.id,
    })
    return { success: false, error: `You have no memory with the id ${parsed.data.id}.` }
  }

  const readOnly: MemoryReadOnlyContext = {
    kind: memory.kind ?? 'semantic',
    source: memory.source,
    archived: (memory.tier ?? 'hot') === 'cold',
    keystone: !!memory.keystone,
    created_at: memory.createdAt,
    occurred_at: memory.occurredAt ?? null,
    narrative_time: memory.narrativeTime ?? null,
    reinforcement_count: memory.reinforcementCount ?? 1,
    about_character_name: await characterName(memory.aboutCharacterId),
    source_conversation_id: memory.chatId ?? null,
  }

  log.debug('read_memory', { characterId: context.characterId, memoryId: memory.id })
  return { success: true, memory: editableMemoryObject(memory), context: readOnly }
}

/** The fields of `next` that differ from `current`, by their tool names. */
function changedFields(current: EditableMemoryObject, next: EditMemoryToolInput): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return (['content', 'summary', 'keywords', 'importance', 'about_character_id', 'related_memory_ids'] as const)
    .filter((field) => !same(current[field], next[field]))
}

export async function executeEditMemoryTool(
  input: unknown,
  context: MemoryEditToolContext,
): Promise<EditMemoryToolOutput> {
  const parsed = editMemoryToolInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: `Invalid input — ${inputError(parsed.error)}. Call read_memory and pass back its whole \`memory\` object.`,
    }
  }
  const next = parsed.data
  const repos = getRepositories()

  const existing = await repos.memories.findByIdForCharacter(context.characterId, next.id)
  if (!existing) {
    return { success: false, error: `You have no memory with the id ${next.id}.` }
  }
  if (existing.keystone) {
    log.debug('edit_memory refused: keystone', { characterId: context.characterId, memoryId: next.id })
    return {
      success: false,
      error: 'That memory is a keystone — a standing fact your author has set in stone — and only they may change it.',
    }
  }

  const changed = changedFields(editableMemoryObject(existing), next)
  if (changed.length === 0) {
    return { success: true, id: next.id, changed: [] }
  }

  if (next.about_character_id && changed.includes('about_character_id')) {
    if (!(await characterName(next.about_character_id))) {
      return { success: false, error: `There is no character with the id ${next.about_character_id}.` }
    }
  }

  // Only what changed: an untouched summary and content are not re-embedded.
  const patch: MemoryEditPatch = {}
  if (changed.includes('content')) patch.content = next.content
  if (changed.includes('summary')) patch.summary = next.summary
  if (changed.includes('keywords')) patch.keywords = next.keywords
  if (changed.includes('importance')) patch.importance = next.importance
  if (changed.includes('about_character_id')) patch.aboutCharacterId = next.about_character_id
  if (changed.includes('related_memory_ids')) patch.relatedMemoryIds = next.related_memory_ids

  const result = await requestMemoryEdit({
    characterId: context.characterId,
    memoryId: next.id,
    patch,
    userId: context.userId,
  })

  if (!result.ok) {
    log.debug('edit_memory refused by the edit chokepoint', {
      characterId: context.characterId,
      memoryId: next.id,
      reason: result.reason,
    })
    switch (result.reason) {
      case 'not-found':
        return { success: false, error: `You have no memory with the id ${next.id}.` }
      case 'invalid-related':
        return {
          success: false,
          error: `related_memory_ids may only name your own memories; these are not: ${result.invalidIds.join(', ')}.`,
        }
      case 'keystone-refused':
      case 'embedding-failed':
        return { success: false, error: `${result.message} Nothing was changed.` }
    }
  }

  log.info('Character edited a memory', {
    characterId: context.characterId,
    memoryId: next.id,
    changed,
  })
  return { success: true, id: next.id, changed }
}
