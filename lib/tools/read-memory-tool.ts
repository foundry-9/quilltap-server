/**
 * Read Memory Tool Definition
 *
 * `read_memory` returns one of the calling character's own memories as the
 * object `edit_memory` takes (`memory`), beside the facts about it that an
 * edit cannot change (`context`). It exists to prepare an edit: `search`
 * already shows a memory's text. Gated by the character's `canEditMemories`.
 *
 * @module tools/read-memory-tool
 */

import { z } from 'zod'
import type { ToolEffectSpec } from './effect-types'
import { zodToOpenAISchema } from './zod-to-openai-schema'

export const readMemoryToolInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .describe('The memory\'s id, as shown on the "Memory ID:" line of a search result.'),
})

export type ReadMemoryToolInput = z.infer<typeof readMemoryToolInputSchema>

/** The fields `edit_memory` takes, as `read_memory` hands them out. */
export interface EditableMemoryObject {
  id: string
  content: string
  summary: string
  keywords: string[]
  importance: number
  about_character_id: string | null
  related_memory_ids: string[]
}

/** What an edit cannot change, shown so the character knows what it is editing. */
export interface MemoryReadOnlyContext {
  kind: 'semantic' | 'episodic'
  source: string
  archived: boolean
  keystone: boolean
  created_at: string
  occurred_at: string | null
  narrative_time: string | null
  reinforcement_count: number
  about_character_name: string | null
  source_conversation_id: string | null
}

export interface ReadMemoryToolOutput {
  success: boolean
  memory?: EditableMemoryObject
  context?: MemoryReadOnlyContext
  error?: string
}

export const readMemoryToolDefinition = {
  type: 'function',
  function: {
    name: 'read_memory',
    description:
      'Read one of your own memories by its id, as the exact object edit_memory takes. ' +
      'Only needed when you are preparing to edit a memory — search already shows what a memory says. ' +
      'Returns `memory` (the editable fields: change what you need and pass the whole object to edit_memory) ' +
      'and `context` (facts about the memory that an edit cannot change).',
    parameters: zodToOpenAISchema(readMemoryToolInputSchema),
  },
}

export function validateReadMemoryInput(input: unknown): boolean {
  return readMemoryToolInputSchema.safeParse(input).success
}

/** What this tool does to the world: reads, changes nothing. */
export const readMemoryToolEffect: ToolEffectSpec = 'read'
