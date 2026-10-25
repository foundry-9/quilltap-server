/**
 * Unequip Inventory Objects Tool Handler
 *
 * Resolves each ref (`pickForGesture(…, 'unequip')`: the carried match, or a
 * kit so it sets down whatever members it holds), then one `unequipItems`
 * call. Never fails on state.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { unequipItems } from '@/lib/inventory/equip';
import { pickForGesture } from '@/lib/inventory/refs';
import type { InventoryUnequipToolOutput } from '../inventory-unequip-tool';
import { validateInventoryUnequipInput } from '../inventory-unequip-tool';
import {
  characterChangeContext,
  errorMessageOf,
  formatSummary,
  loadToolChat,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  summarize,
  type InventoryToolContext,
} from './inventory-handler-shared';

export async function executeInventoryUnequipTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryUnequipToolOutput> {
  const parsed = validateInventoryUnequipInput(input);
  if (!parsed) {
    logInventoryTool('inventory_unequip', context, { outcome: 'invalid input' }, 'info');
    return { success: false, unequipped: [], not_equipped: [], error: 'Invalid input: refs must be a list of one to eight object references.' };
  }
  const repos = getRepositories();
  try {
    const [ctx, chat] = await Promise.all([loadToolInventory(repos, context), loadToolChat(repos, context.chatId)]);
    if (!chat) return { success: false, unequipped: [], not_equipped: [], error: 'This chat could not be found.' };
    const ids: string[] = [];
    const notEquipped: string[] = [];
    for (const ref of parsed.refs) {
      const matches = resolveToolRef(ctx, ref);
      const pick = pickForGesture(matches, 'unequip');
      if (!pick) {
        notEquipped.push(ref);
        continue;
      }
      if (!ids.includes(pick.item.id)) ids.push(pick.item.id);
    }
    const result = ids.length > 0
      ? await unequipItems(repos, chat, context.characterId, ids, characterChangeContext(context))
      : { unequipped: [], notEquipped: [] };
    const output: InventoryUnequipToolOutput = {
      success: true,
      unequipped: result.unequipped.map((item) => summarize(item, ctx.pool.owns(item.id), false)),
      not_equipped: [...notEquipped, ...result.notEquipped],
    };
    logInventoryTool('inventory_unequip', context, { refs: parsed.refs, resolved: ids, outcome: 'unequipped', unequipped: output.unequipped.map((s) => s.id) });
    return output;
  } catch (error) {
    logInventoryTool('inventory_unequip', context, { refs: parsed.refs, outcome: 'failed', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, unequipped: [], not_equipped: [], error: errorMessageOf(error, 'Failed to unequip') };
  }
}

export function formatInventoryUnequipResults(output: InventoryUnequipToolOutput): string {
  if (!output.success) return `Inventory Error: ${output.error || 'Unknown error'}`;
  const lines = output.unequipped.map((s) => `Set down ${formatSummary(s)}`);
  for (const ref of output.not_equipped) lines.push(`Not carried: "${ref}"`);
  return lines.join('\n') || 'Nothing changed.';
}
