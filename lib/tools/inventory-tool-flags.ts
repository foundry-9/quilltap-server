/**
 * The `inventory_*` family's per-tool enable flags, in one place. Every
 * surface that offers tools (the plugin tool builder, the simple-JSON and
 * text-block prompts) carries the nine flags; they are all on or all off,
 * gated by the character's `canManageInventory` (null reads as on). Brahma
 * and the Scenario Builder pass off.
 *
 * @module tools/inventory-tool-flags
 */

import { inventoryListToolDefinition } from './inventory-list-tool'
import { inventoryReadToolDefinition } from './inventory-read-tool'
import { inventoryEquipToolDefinition } from './inventory-equip-tool'
import { inventoryUnequipToolDefinition } from './inventory-unequip-tool'
import { inventoryPickUpToolDefinition } from './inventory-pick-up-tool'
import { inventoryCreateToolDefinition } from './inventory-create-tool'
import { inventoryUpdateToolDefinition } from './inventory-update-tool'
import { inventoryArchiveToolDefinition } from './inventory-archive-tool'
import { inventoryGiveToolDefinition } from './inventory-give-tool'

/** Flag name → the tool definition it enables, in offer order. */
export const INVENTORY_TOOL_DEFINITIONS = {
  inventoryList: inventoryListToolDefinition,
  inventoryRead: inventoryReadToolDefinition,
  inventoryEquip: inventoryEquipToolDefinition,
  inventoryUnequip: inventoryUnequipToolDefinition,
  inventoryPickUp: inventoryPickUpToolDefinition,
  inventoryCreate: inventoryCreateToolDefinition,
  inventoryUpdate: inventoryUpdateToolDefinition,
  inventoryArchive: inventoryArchiveToolDefinition,
  inventoryGive: inventoryGiveToolDefinition,
} as const

export type InventoryToolFlag = keyof typeof INVENTORY_TOOL_DEFINITIONS

/** The nine flags as optional booleans, for an options interface to extend. */
export type InventoryToolFlags = Partial<Record<InventoryToolFlag, boolean>>

export const INVENTORY_TOOL_FLAGS = Object.keys(INVENTORY_TOOL_DEFINITIONS) as InventoryToolFlag[]

/** All nine flags set from the character's `canManageInventory` (null/undefined = on). */
export function inventoryToolFlags(canManageInventory: boolean | null | undefined): Record<InventoryToolFlag, boolean> {
  const enabled = canManageInventory !== false
  return Object.fromEntries(INVENTORY_TOOL_FLAGS.map((flag) => [flag, enabled])) as Record<InventoryToolFlag, boolean>
}

/** The flags copied from an options object (absent ones stay absent). */
export function pickInventoryToolFlags(source: InventoryToolFlags): InventoryToolFlags {
  const out: InventoryToolFlags = {}
  for (const flag of INVENTORY_TOOL_FLAGS) {
    if (source[flag] !== undefined) out[flag] = source[flag]
  }
  return out
}

/** The enabled definitions, in offer order. */
export function enabledInventoryToolDefinitions(options: InventoryToolFlags) {
  return INVENTORY_TOOL_FLAGS.filter((flag) => options[flag]).map((flag) => INVENTORY_TOOL_DEFINITIONS[flag])
}
