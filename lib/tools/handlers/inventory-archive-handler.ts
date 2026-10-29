/**
 * Archive Inventory Object Tool Handler
 *
 * Own objects only; `setInventoryItemArchived`, idempotent. Archiving also
 * drops the id from the character's carried set in every chat
 * (`dropCarriedEverywhere`), so a later restore does not quietly re-equip it;
 * when it was carried here, that is a setting-down, announced as one.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { setInventoryItemArchived } from '@/lib/inventory/item-mutations';
import { notifyInventoryChanged } from '@/lib/inventory/equip-effects';
import { dropCarriedEverywhere } from '@/lib/inventory/equip';
import type { InventoryArchiveToolOutput } from '../inventory-archive-tool';
import { validateInventoryArchiveInput } from '../inventory-archive-tool';
import {
  characterChangeContext,
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

export async function executeInventoryArchiveTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryArchiveToolOutput> {
  const parsed = validateInventoryArchiveInput(input);
  if (!parsed) {
    logInventoryTool('inventory_archive', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: ref and archived (true or false) are required.' };
  }
  const repos = getRepositories();
  try {
    const ctx = await loadToolInventory(repos, context);
    const matches = resolveToolRef(ctx, parsed.ref, { includeArchetypes: true, includeArchived: true });
    if (matches.length === 0) return { success: false, error: inventoryNotFoundMessage(parsed.ref) };
    const match = matches.find((m) => m.own);
    if (!match) {
      logInventoryTool('inventory_archive', context, { refs: [parsed.ref], resolved: [matches[0].item.id], outcome: 'refused: shared' }, 'info');
      return { success: false, error: sharedInventoryItemReadOnlyMessage(matches[0].item, 'archived') };
    }
    const own = await loadOwnRecord(repos, context, match.item.id);
    if (!own) return { success: false, error: inventoryNotFoundMessage(parsed.ref) };
    const { vault, record } = own;

    const { changed } = await setInventoryItemArchived(vault, record, parsed.archived);
    if (changed && parsed.archived) {
      await dropCarriedEverywhere(repos, context.characterId, record.id, [context.chatId]);
      if (match.equipped) {
        await notifyInventoryChanged(repos, { id: context.chatId }, context.characterId, { equipped: [], unequipped: [match.item] }, characterChangeContext(context));
      }
    }
    logInventoryTool('inventory_archive', context, { refs: [parsed.ref], resolved: [record.id], outcome: changed ? 'changed' : 'unchanged', archived: parsed.archived });
    return {
      success: true,
      item: summarize(match.item, true, !parsed.archived && match.equipped),
      archived: parsed.archived,
      changed,
    };
  } catch (error) {
    logInventoryTool('inventory_archive', context, { refs: [parsed.ref], outcome: 'refused', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, error: errorMessageOf(error, 'Failed to archive the object') };
  }
}

export function formatInventoryArchiveResults(output: InventoryArchiveToolOutput): string {
  if (!output.success || !output.item) return `Inventory Error: ${output.error || 'Unknown error'}`;
  if (!output.changed) return `${formatSummary(output.item)} was already ${output.archived ? 'archived' : 'in use'}; nothing changed.`;
  return output.archived
    ? `Archived ${formatSummary(output.item)}. It is put away — no longer carried or listed — and can be restored.`
    : `Restored ${formatSummary(output.item)}.`;
}
