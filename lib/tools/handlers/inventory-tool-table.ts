/**
 * The nine `inventory_*` tools as one table — name → run. Each entry runs its
 * handler, formats the result for the conversation, and projects the payload
 * the executor returns. The executor builds one `InventoryToolContext` for all
 * of them, so the turn's pending Inventory announcements reach every tool
 * that changes what a character carries.
 *
 * @module tools/handlers/inventory-tool-table
 */

import type { InventoryToolContext } from './inventory-handler-shared';
import { executeInventoryListTool, formatInventoryListResults } from './inventory-list-handler';
import { executeInventoryReadTool, formatInventoryReadResults } from './inventory-read-handler';
import { executeInventoryEquipTool, formatInventoryEquipResults } from './inventory-equip-handler';
import { executeInventoryUnequipTool, formatInventoryUnequipResults } from './inventory-unequip-handler';
import { executeInventoryPickUpTool, formatInventoryPickUpResults } from './inventory-pick-up-handler';
import { executeInventoryCreateTool, formatInventoryCreateResults } from './inventory-create-handler';
import { executeInventoryUpdateTool, formatInventoryUpdateResults } from './inventory-update-handler';
import { executeInventoryArchiveTool, formatInventoryArchiveResults } from './inventory-archive-handler';
import { executeInventoryGiveTool, formatInventoryGiveResults } from './inventory-give-handler';

export interface InventoryToolRun {
  success: boolean;
  result: Record<string, unknown> | null;
  error?: string;
}

export type InventoryToolRunner = (input: unknown, context: InventoryToolContext) => Promise<InventoryToolRun>;

/** Wrap one handler: a success carries the formatted text beside its payload. */
function run<T extends { success: boolean; error?: string }>(
  execute: (input: unknown, context: InventoryToolContext) => Promise<T>,
  format: (output: T) => string,
): InventoryToolRunner {
  return async (input, context) => {
    const r = await execute(input, context);
    const { success, error, ...payload } = r;
    return {
      success,
      result: success ? { formattedText: format(r), ...payload } : null,
      error: success ? undefined : error,
    };
  };
}

export const INVENTORY_TOOL_TABLE: Record<string, InventoryToolRunner> = {
  inventory_list: run(executeInventoryListTool, formatInventoryListResults),
  inventory_read: run(executeInventoryReadTool, formatInventoryReadResults),
  inventory_equip: run(executeInventoryEquipTool, formatInventoryEquipResults),
  inventory_unequip: run(executeInventoryUnequipTool, formatInventoryUnequipResults),
  inventory_pick_up: run(executeInventoryPickUpTool, formatInventoryPickUpResults),
  inventory_create: run(executeInventoryCreateTool, formatInventoryCreateResults),
  inventory_update: run(executeInventoryUpdateTool, formatInventoryUpdateResults),
  inventory_archive: run(executeInventoryArchiveTool, formatInventoryArchiveResults),
  inventory_give: run(executeInventoryGiveTool, formatInventoryGiveResults),
};

/** The family's names, in table order. */
export const INVENTORY_TOOL_NAMES: readonly string[] = Object.keys(INVENTORY_TOOL_TABLE);
