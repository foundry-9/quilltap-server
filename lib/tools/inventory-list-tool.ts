/**
 * List Inventory Tool Definition
 *
 * `inventory_list` shows what a character carries in this chat and what they
 * can reach: their own vault, their groups' stores, the project's stores and
 * Quilltap General. Each object carries its state (`equipped`, `carried`,
 * `reachable`); archetypes are listed as pick-up-able with no state. Gated
 * by `canManageInventory`.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'
import type { InventoryState } from '@/lib/inventory/refs'

/** Where an object lives, from the caller's side. */
export const InventoryToolTierSchema = z.enum(['own', 'group', 'project', 'general'])
export type InventoryToolTier = z.infer<typeof InventoryToolTierSchema>

export const inventoryListToolInputSchema = z.object({
  equipped: z
    .boolean()
    .describe('true lists only what you have equipped in this chat; false only what you do not. Omit for both.')
    .optional(),
  kind: z
    .enum(['item', 'kit', 'archetype'])
    .describe('"item" for single objects, "kit" for bundles equipped as one, "archetype" for classes of object you can pick up an instance of.')
    .optional(),
  folder: z
    .string()
    .describe('Only objects filed in this folder (or beneath it), e.g. "Weapons".')
    .optional(),
  tier: InventoryToolTierSchema
    .describe('"own" for your own vault, or one of the shared stores: "group", "project", "general".')
    .optional(),
  include_archived: z
    .boolean()
    .describe('Also list your own archived objects. Defaults to false.')
    .optional(),
})

export type InventoryListToolInput = z.infer<typeof inventoryListToolInputSchema>

/** One object as `inventory_list` reports it. */
export interface InventoryListItemResult {
  id: string
  name: string
  title: string | null
  /** Null for an archetype (pick-up-able, never carried). */
  state: InventoryState | null
  kind: 'item' | 'kit' | 'archetype'
  tier: InventoryToolTier
  folder: string | null
  is_own: boolean
  description: string | null
  /** A kit's state: how many of its members are equipped. */
  kit_state?: 'all' | 'some' | 'none'
  archived?: boolean
}

export interface InventoryListToolOutput {
  success: boolean
  items: InventoryListItemResult[]
  total_count: number
  error?: string
}

export const inventoryListToolDefinition = {
  type: 'function',
  function: {
    name: 'inventory_list',
    description:
      'List the objects you carry and can reach (not clothing — that is the wardrobe). Each row shows ' +
      'its state in this chat: "equipped" (you have it on you), "carried" (in your own vault, not ' +
      'equipped) or "reachable" (in a shared store). Archetypes are classes of object you can pick up ' +
      'an instance of with inventory_pick_up. Shared objects are read-only.',
    parameters: zodToOpenAISchema(inventoryListToolInputSchema),
  },
}

export function validateInventoryListInput(input: unknown): InventoryListToolInput | null {
  const parsed = inventoryListToolInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
