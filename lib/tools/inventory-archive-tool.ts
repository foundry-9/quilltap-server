/**
 * Archive Inventory Object Tool Definition
 *
 * `inventory_archive` retires (or restores) one of the character's OWN
 * objects. An archived object leaves every chat's carried set on read and is
 * never destroyed. Gated by `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import { InventoryRefInputSchema } from './inventory-read-tool'
import type { InventoryObjectSummary } from './handlers/inventory-handler-shared'

export const inventoryArchiveToolInputSchema = z.object({
  ref: InventoryRefInputSchema,
  archived: z.boolean().describe('true to archive it, false to restore it.'),
})

export type InventoryArchiveToolInput = z.infer<typeof inventoryArchiveToolInputSchema>

export interface InventoryArchiveToolOutput {
  success: boolean
  item?: InventoryObjectSummary
  archived?: boolean
  changed?: boolean
  error?: string
}

export const inventoryArchiveToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_archive',
    description:
      'Archive one of your OWN objects (it is put away: no longer carried or listed, never destroyed), ' +
      'or restore one you archived with archived=false. Objects in shared stores are read-only.',
    parameters: zodToOpenAISchema(inventoryArchiveToolInputSchema),
  },
}

export function validateInventoryArchiveInput(input: unknown): InventoryArchiveToolInput | null {
  const parsed = inventoryArchiveToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
