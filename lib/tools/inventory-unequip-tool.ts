/**
 * Unequip Inventory Objects Tool Definition
 *
 * `inventory_unequip` sets down one to eight objects (a kit sets down every
 * member it holds). Never fails on state: what was not carried is reported.
 * Gated by `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefsInputSchema } from './inventory-equip-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const inventoryUnequipToolInputSchema = z.object({
  refs: InventoryRefsInputSchema,
})

export type InventoryUnequipToolInput = z.infer<typeof inventoryUnequipToolInputSchema>

export interface InventoryUnequipToolOutput {
  success: boolean
  unequipped: InventoryObjectSummary[]
  not_equipped: string[]
  error?: string
}

export const inventoryUnequipToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_unequip',
    description:
      'Set down objects you carry in this chat (a kit sets down all its members). The object stays ' +
      'where it lives; you simply stop carrying it. Each ref is an id, title or name.',
    parameters: zodToOpenAISchema(inventoryUnequipToolInputSchema),
  },
}

export function validateInventoryUnequipInput(input: unknown): InventoryUnequipToolInput | null {
  const parsed = inventoryUnequipToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
