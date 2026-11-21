/**
 * Edit Memory Tool Definition
 *
 * `edit_memory` replaces the editable fields of one of the calling
 * character's own memories with the object it is given — the `memory` object
 * `read_memory` returned, changed. Every field is required, so an edit is
 * always a whole object and never a guess at which fields were meant. The
 * write goes through `updateMemory` (`lib/memory/admission/`), the same door
 * the memory editor uses. Gated by the character's `canEditMemories`.
 *
 * @module tools/edit-memory-tool
 */

import { z } from 'zod'
import type { ToolEffectSpec } from './effect-types'
import { zodToOpenAISchema } from './zod-to-openai-schema'

export const EDIT_MEMORY_CONTENT_MAX = 20000
export const EDIT_MEMORY_SUMMARY_MAX = 2000

export const editMemoryToolInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .describe('The memory\'s id. Identifies which memory to edit; it cannot be changed.'),
  content: z
    .string()
    .min(1)
    .max(EDIT_MEMORY_CONTENT_MAX)
    .describe('The memory in full: what happened or what is true, in as much detail as it deserves.'),
  summary: z
    .string()
    .min(1)
    .max(EDIT_MEMORY_SUMMARY_MAX)
    .describe('One or two sentences distilling the memory. This is what is shown when the memory is recalled into a conversation.'),
  keywords: z
    .array(z.string().min(1).max(100))
    .max(50)
    .describe('Words and short phrases the memory should be found by in a keyword search. May be empty.'),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe('How much the memory matters, from 0 (trivial) to 1 (defining). 0.7 and above counts as high, below 0.3 as low; it decides which memories surface first and which are kept longest.'),
  about_character_id: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .describe('The id of the character this memory is about, or null when it is not about anyone in particular.'),
  related_memory_ids: z
    .array(z.string().min(1).max(100))
    .max(50)
    .describe('Ids of your other memories this one is linked to. The link is kept on both memories; leave a memory off the list to unlink it.'),
})

export type EditMemoryToolInput = z.infer<typeof editMemoryToolInputSchema>

export interface EditMemoryToolOutput {
  success: boolean
  id?: string
  /** The editable fields whose values changed. */
  changed?: string[]
  error?: string
}

export const editMemoryToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_memory',
    description:
      'Rewrite one of your own memories: correct a detail, sharpen its summary, change how much it matters, or link it to related memories. ' +
      'Call read_memory first and pass back its whole `memory` object with your changes — every field is required, ' +
      'and each value you send replaces the one stored. A changed summary or content is re-indexed for search. ' +
      'Keystone memories (standing facts your author has set in stone) cannot be edited.',
    parameters: zodToOpenAISchema(editMemoryToolInputSchema),
  },
}

export function validateEditMemoryInput(input: unknown): boolean {
  return editMemoryToolInputSchema.safeParse(input).success
}

/** What this tool does to the world: changes a stored memory. */
export const editMemoryToolEffect: ToolEffectSpec = 'write'
