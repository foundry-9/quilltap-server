/**
 * Equip Inventory Objects Tool Definition
 *
 * `inventory_equip` takes up one to eight objects (or kits) in this chat,
 * through the same chokepoint the operator's dialog uses. A breach of an
 * object's cap fails the whole call with nothing changed. Gated by
 * `canManageInventory`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefInputSchema } from './inventory-read-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const InventoryRefsInputSchema = z
  .array(InventoryRefInputSchema)
  .min(1)
  .max(8)
  .describe('One to eight objects (or kits), each by id, title or name.')

export const inventoryEquipToolInputSchema = z.object({
  refs: InventoryRefsInputSchema,
})

export type InventoryEquipToolInput = z.infer<typeof inventoryEquipToolInputSchema>

export interface InventoryEquipToolOutput {
  success: boolean
  equipped: InventoryObjectSummary[]
  created: InventoryObjectSummary[]
  already_equipped: InventoryObjectSummary[]
  skipped: Array<{ ref: string; reason: string }>
  error?: string
}

export const inventoryEquipToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_equip',
    description:
      'Take up objects (or kits) so you carry them in this chat. Each ref is an id, title or name. ' +
      'An object you own or can reach in a shared store may be equipped; an archetype must be picked ' +
      'up first with inventory_pick_up. If carrying one more would exceed its limit, nothing changes.',
    parameters: zodToOpenAISchema(inventoryEquipToolInputSchema),
  },
}

export function validateInventoryEquipInput(input: unknown): InventoryEquipToolInput | null {
  const parsed = inventoryEquipToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: changes stored state. */
export const inventoryEquipToolEffect: ToolEffectSpec = 'write';
