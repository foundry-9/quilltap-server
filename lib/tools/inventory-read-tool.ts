/**
 * Read Inventory Object Tool Definition
 *
 * `inventory_read` returns one object in full: both descriptions, its
 * metadata, its archetype, cap, copy rule, kit members with their states and
 * whether it has a picture. Gated by `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { InventoryState } from '@/lib/inventory/refs'
import type { InventoryToolTier } from './inventory-list-tool'

/** An object reference: its id, else its title, else its name (case-insensitive). */
export const InventoryRefInputSchema = z
  .string()
  .min(1)
  .max(200)
  .describe('The object: its id, its title ("Excalibur") or its name ("sword"), case-insensitive.')

export const inventoryReadToolInputSchema = z.object({
  ref: InventoryRefInputSchema,
})

export type InventoryReadToolInput = z.infer<typeof inventoryReadToolInputSchema>

export interface InventoryReadToolOutput {
  success: boolean
  id?: string
  name?: string
  title?: string | null
  state?: InventoryState | null
  kind?: 'item' | 'kit' | 'archetype'
  tier?: InventoryToolTier
  is_own?: boolean
  description?: string | null
  image_description?: string | null
  emoji?: string | null
  metadata?: Record<string, unknown>
  parent_id?: string | null
  archetype_title?: string | null
  max_equipped?: number
  can_copy?: boolean
  has_picture?: boolean
  folder?: string | null
  members?: Array<{ id: string; name: string; title: string | null; state: InventoryState | null }>
  error?: string
}

export const inventoryReadToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_read',
    description:
      'Read one object you carry or can reach in full: its description, rendering hints, metadata, ' +
      'the archetype it derives from, how many may be carried at once, and (for a kit) its members.',
    parameters: zodToOpenAISchema(inventoryReadToolInputSchema),
  },
}

export function validateInventoryReadInput(input: unknown): InventoryReadToolInput | null {
  const parsed = inventoryReadToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
