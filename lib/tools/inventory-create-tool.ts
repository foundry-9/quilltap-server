/**
 * Create Inventory Object Tool Definition
 *
 * `inventory_create` makes a new standalone object in the character's own
 * vault (at its root): never an archetype, never a kit, never copyable, no
 * glyph. Optionally equips it. Gated by `canManageInventory`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

/** The fields a character may set on an object of their own. */
export const inventoryObjectFieldsShape = {
  title: z.string().max(200).describe('A proper title ("Excalibur"), shown first when set.').optional(),
  description: z
    .string()
    .max(4000)
    .describe('What the object is, as you and others know it while it is carried.')
    .optional(),
  image_description: z
    .string()
    .max(2000)
    .describe('How the object looks, for pictures (rendering hints only).')
    .optional(),
  emoji: z.string().max(16).describe('A single emoji glyph for it.').optional(),
  max_equipped: z
    .number()
    .int()
    .min(1)
    .max(999)
    .describe('At most this many of its kind (same name) may be carried at once. Defaults to 1.')
    .optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe('Free-form facts about it, e.g. {"damage": "2d6", "charges": 3}.')
    .optional(),
}

export const inventoryCreateToolInputSchema = z.object({
  name: z.string().min(1).max(200).describe('The plain name of the object ("sword"). Objects of a kind share it.'),
  ...inventoryObjectFieldsShape,
  equip: z.boolean().describe('Equip the new object at once. Defaults to false.').optional(),
})

export type InventoryCreateToolInput = z.infer<typeof inventoryCreateToolInputSchema>

export interface InventoryCreateToolOutput {
  success: boolean
  item?: InventoryObjectSummary
  equipped?: boolean
  error?: string
}

export const inventoryCreateToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_create',
    description:
      'Make a new object of your own (not clothing) in your own vault, and optionally equip it. ' +
      'Give it a plain name, and optionally a title, a description, how it looks, an emoji and ' +
      'free-form metadata.',
    parameters: zodToOpenAISchema(inventoryCreateToolInputSchema),
  },
}

export function validateInventoryCreateInput(input: unknown): InventoryCreateToolInput | null {
  const parsed = inventoryCreateToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: changes stored state. */
export const inventoryCreateToolEffect: ToolEffectSpec = 'write';
