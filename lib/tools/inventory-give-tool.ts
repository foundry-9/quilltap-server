/**
 * Give Inventory Object Tool Definition
 *
 * `inventory_give` moves one of the character's OWN objects to another
 * participant of this chat: the file moves to their vault with its id, the
 * giver stops carrying it everywhere, and the receiver's carried sets are
 * untouched (they equip it themselves). The one `inventory_*` tool that
 * writes another character's vault. Gated by `canManageInventory`.
 */

import type { ToolEffectSpec } from './effect-types';
import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefInputSchema } from './inventory-read-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const inventoryGiveToolInputSchema = z.object({
  ref: InventoryRefInputSchema.describe('The object to give: one of your own, by id, title or name.'),
  to: z.string().min(1).max(200).describe('Who receives it: another character in this chat, by name or id.'),
})

export type InventoryGiveToolInput = z.infer<typeof inventoryGiveToolInputSchema>

export interface InventoryGiveToolOutput {
  success: boolean
  item?: InventoryObjectSummary
  recipient?: { id: string; name: string }
  error?: string
}

export const inventoryGiveToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_give',
    description:
      'Hand one of your OWN objects to another character in this chat. It leaves your vault for theirs ' +
      'and you stop carrying it; they decide whether to equip it. Shared objects and kits cannot be given.',
    parameters: zodToOpenAISchema(inventoryGiveToolInputSchema),
  },
}

export function validateInventoryGiveInput(input: unknown): InventoryGiveToolInput | null {
  const parsed = inventoryGiveToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** What this tool does to the world: changes stored state. */
export const inventoryGiveToolEffect: ToolEffectSpec = 'write';
