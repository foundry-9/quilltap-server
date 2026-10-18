/**
 * Update Inventory Object Tool Definition
 *
 * `inventory_update` amends one of the character's OWN objects; shared
 * objects are read-only. On an instance the patch is an override of the
 * archetype. Shape, archetype, kit members, copy rule, glyph and picture are
 * out of reach. Gated by `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefInputSchema } from './inventory-read-tool'
import { inventoryObjectFieldsShape } from './inventory-create-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const inventoryUpdateToolInputSchema = z
  .object({
    ref: InventoryRefInputSchema,
    name: z.string().min(1).max(200).describe('A new plain name.').optional(),
    ...inventoryObjectFieldsShape,
  })
  .refine(
    (o) => Object.entries(o).some(([key, value]) => key !== 'ref' && value !== undefined),
    { message: 'Name at least one field to change' },
  )

export type InventoryUpdateToolInput = z.infer<typeof inventoryUpdateToolInputSchema>

export interface InventoryUpdateToolOutput {
  success: boolean
  item?: InventoryObjectSummary
  fields?: string[]
  error?: string
}

export const inventoryUpdateToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_update',
    description:
      'Change one of your OWN objects: its name, title, description, how it looks, emoji, limit or ' +
      'metadata. Objects in shared stores are read-only. Name only the fields you want to change.',
    parameters: zodToOpenAISchema(inventoryUpdateToolInputSchema),
  },
}

export function validateInventoryUpdateInput(input: unknown): InventoryUpdateToolInput | null {
  const parsed = inventoryUpdateToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
