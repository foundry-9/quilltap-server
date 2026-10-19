/**
 * Pick Up Inventory Object Tool Definition
 *
 * `inventory_pick_up` makes an instance of a reachable archetype in the
 * character's own vault (at its root), and by default equips it. The cap is
 * checked before anything is written: a breach creates nothing. Gated by
 * `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefInputSchema } from './inventory-read-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const inventoryPickUpToolInputSchema = z.object({
  ref: InventoryRefInputSchema.describe('The archetype to pick up an instance of: its id, title or name.'),
  title: z
    .string()
    .min(1)
    .max(200)
    .describe('A proper title for your instance ("Old Faithful"). Omit to keep the archetype\'s.')
    .optional(),
  equip: z
    .boolean()
    .describe('Equip the new instance at once. Defaults to true.')
    .optional(),
})

export type InventoryPickUpToolInput = z.infer<typeof inventoryPickUpToolInputSchema>

export interface InventoryPickUpToolOutput {
  success: boolean
  item?: InventoryObjectSummary
  archetype?: { id: string; name: string; title: string | null }
  equipped?: boolean
  error?: string
}

export const inventoryPickUpToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_pick_up',
    description:
      'Pick up an instance of an archetype (a class of object, as inventory_list marks them) into ' +
      'your own vault, and by default equip it. The instance is yours: you may update, archive or ' +
      'give it. If equipping would exceed the limit on how many may be carried, nothing is created.',
    parameters: zodToOpenAISchema(inventoryPickUpToolInputSchema),
  },
}

export function validateInventoryPickUpInput(input: unknown): InventoryPickUpToolInput | null {
  const parsed = inventoryPickUpToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
