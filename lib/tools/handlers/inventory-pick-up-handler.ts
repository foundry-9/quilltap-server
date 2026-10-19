/**
 * Pick Up Inventory Object Tool Handler
 *
 * Plans before it writes: the archetype is resolved, and when equipping the
 * cap is checked against its name first (`pickUpItems` does both inside the
 * chat's lock) — a breach fails the call with the cap's wording and creates
 * nothing. Then one instance in the character's vault root, equipped by
 * default.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { pickUpItems } from '@/lib/inventory/equip';
import { InventoryInvalidParentError } from '@/lib/inventory/errors';
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve';
import type { InventoryPickUpToolOutput } from '../inventory-pick-up-tool';
import { validateInventoryPickUpInput } from '../inventory-pick-up-tool';
import {
  characterChangeContext,
  errorMessageOf,
  formatSummary,
  inventoryNotFoundMessage,
  loadToolChat,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  summarize,
  type InventoryToolContext,
} from './inventory-handler-shared';

export async function executeInventoryPickUpTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryPickUpToolOutput> {
  const parsed = validateInventoryPickUpInput(input);
  if (!parsed) {
    logInventoryTool('inventory_pick_up', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: ref names the archetype to pick up.' };
  }
  const repos = getRepositories();
  try {
    const [ctx, chat] = await Promise.all([loadToolInventory(repos, context), loadToolChat(repos, context.chatId)]);
    if (!chat) return { success: false, error: 'This chat could not be found.' };
    const matches = resolveToolRef(ctx, parsed.ref, { includeArchetypes: true });
    const archetype = matches.find((m) => m.item.isArchetype)?.item;
    if (!archetype) {
      const error = matches.length > 0
        ? new InventoryInvalidParentError(`"${inventoryLabel(matches[0].item)}" is not an archetype; equip it with inventory_equip instead`).message
        : inventoryNotFoundMessage(parsed.ref);
      logInventoryTool('inventory_pick_up', context, { refs: [parsed.ref], resolved: matches.map((m) => m.item.id), outcome: 'refused', error }, 'info');
      return { success: false, error };
    }
    const result = await pickUpItems(repos, chat, context.characterId, [archetype.id], characterChangeContext(context), {
      title: parsed.title,
      equip: parsed.equip,
    });
    const created = result.created[0];
    logInventoryTool('inventory_pick_up', context, {
      refs: [parsed.ref],
      resolved: [archetype.id],
      outcome: 'picked up',
      created: created?.id,
      equipped: result.equipped,
    });
    return {
      success: true,
      item: created ? summarize(created, true, result.equipped) : undefined,
      archetype: { id: archetype.id, name: archetype.name, title: archetype.title?.trim() || null },
      equipped: result.equipped,
    };
  } catch (error) {
    logInventoryTool('inventory_pick_up', context, { refs: [parsed.ref], outcome: 'refused', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, error: errorMessageOf(error, 'Failed to pick it up') };
  }
}

export function formatInventoryPickUpResults(output: InventoryPickUpToolOutput): string {
  if (!output.success) return `Inventory Error: ${output.error || 'Unknown error'}`;
  const archetype = output.archetype ? inventoryDisplayName(output.archetype) : 'the archetype';
  if (!output.item) return `Nothing was picked up from ${archetype}.`;
  return `Picked up ${formatSummary(output.item)} — an instance of ${archetype}, in your own vault${output.equipped ? ', equipped' : ', not equipped'}.`;
}
