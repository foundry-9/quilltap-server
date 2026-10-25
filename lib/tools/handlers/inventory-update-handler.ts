/**
 * Update Inventory Object Tool Handler
 *
 * Own objects only (`pool.owns`); a shared one gets the read-only refusal.
 * Shape, archetype, kit members, copy rule, glyph and picture are out of
 * reach. On an instance the patch is an override. Metadata merges key by key
 * into what the object's own file holds; a `null` value removes a key.
 */

import { getRepositories } from '@/lib/repositories/factory';
import type { InventoryUpdateBody } from '@/lib/schemas/inventory.types';
import { updateInventoryItem } from '@/lib/inventory/item-mutations';
import type { InventoryUpdateToolOutput } from '../inventory-update-tool';
import { validateInventoryUpdateInput } from '../inventory-update-tool';
import {
  errorMessageOf,
  formatSummary,
  inventoryNotFoundMessage,
  loadOwnRecord,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  sharedInventoryItemReadOnlyMessage,
  summarize,
  type InventoryToolContext,
} from './inventory-handler-shared';

export async function executeInventoryUpdateTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryUpdateToolOutput> {
  const parsed = validateInventoryUpdateInput(input);
  if (!parsed) {
    logInventoryTool('inventory_update', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: ref and at least one field to change are required.' };
  }
  const repos = getRepositories();
  try {
    const ctx = await loadToolInventory(repos, context);
    const matches = resolveToolRef(ctx, parsed.ref, { includeArchetypes: true, includeArchived: true });
    if (matches.length === 0) return { success: false, error: inventoryNotFoundMessage(parsed.ref) };
    const match = matches.find((m) => m.own);
    if (!match) {
      logInventoryTool('inventory_update', context, { refs: [parsed.ref], resolved: [matches[0].item.id], outcome: 'refused: shared' }, 'info');
      return { success: false, error: sharedInventoryItemReadOnlyMessage(matches[0].item, 'changed') };
    }
    const own = await loadOwnRecord(repos, context, match.item.id);
    if (!own) return { success: false, error: inventoryNotFoundMessage(parsed.ref) };
    const { vault, record } = own;

    const patch: InventoryUpdateBody = {};
    if (parsed.name !== undefined) patch.name = parsed.name.trim();
    if (parsed.title !== undefined) patch.title = parsed.title.trim() || null;
    if (parsed.description !== undefined) patch.description = parsed.description;
    if (parsed.image_description !== undefined) patch.imageDescription = parsed.image_description;
    if (parsed.emoji !== undefined) patch.emoji = parsed.emoji;
    if (parsed.max_equipped !== undefined) patch.maxEquipped = parsed.max_equipped;
    if (parsed.metadata !== undefined) {
      const merged: Record<string, unknown> = { ...((record.metadata as Record<string, unknown> | undefined) ?? {}) };
      for (const [key, value] of Object.entries(parsed.metadata)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      patch.metadata = merged;
    }

    const updated = await updateInventoryItem(repos, vault, record, patch, { chatId: context.chatId });
    if (!updated) return { success: false, error: `Failed to change "${parsed.ref}".` };
    // Resolved against the pool already in hand: the edit changed this object, not its archetype.
    const after = ctx.serverPool.resolve({ ...updated, origin: vault.origin, mountPointId: vault.mountPointId });
    const fields = Object.keys(patch);
    logInventoryTool('inventory_update', context, { refs: [parsed.ref], resolved: [record.id], outcome: 'updated', fields });
    return { success: true, item: summarize(after, true, match.equipped), fields };
  } catch (error) {
    logInventoryTool('inventory_update', context, { refs: [parsed.ref], outcome: 'refused', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, error: errorMessageOf(error, 'Failed to change the object') };
  }
}

export function formatInventoryUpdateResults(output: InventoryUpdateToolOutput): string {
  if (!output.success || !output.item) return `Inventory Error: ${output.error || 'Unknown error'}`;
  return `Changed ${(output.fields ?? []).join(', ')} on ${formatSummary(output.item)}.`;
}
