/**
 * List Inventory Tool Handler
 *
 * The rolling character's resolved pool, filtered: each row with its state
 * in this chat, its tier and folder, kits with their `all/some/none`, and
 * archetypes as pick-up-able (no state). Shared rows are tagged read-only.
 */

import { getRepositories } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { kitState } from '@/lib/inventory/resolve';
import { inventoryDisplayName } from '@/lib/inventory/resolve';
import type { InventoryListItemResult, InventoryListToolOutput } from '../inventory-list-tool';
import { validateInventoryListInput } from '../inventory-list-tool';
import {
  errorMessageOf,
  kindOf,
  loadToolInventory,
  logInventoryTool,
  stateFor,
  tierOf,
  type InventoryToolContext,
} from './inventory-handler-shared';

const EXCERPT = 140;

function excerpt(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat;
}

function inFolder(item: ResolvedInventoryItem, folder: string): boolean {
  const want = folder.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!want) return true;
  const have = (item.folder ?? '').toLowerCase();
  return have === want || have.startsWith(`${want}/`);
}

export async function executeInventoryListTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryListToolOutput> {
  const parsed = validateInventoryListInput(input);
  if (!parsed) {
    logInventoryTool('inventory_list', context, { outcome: 'invalid input' }, 'info');
    return { success: false, items: [], total_count: 0, error: 'Invalid input for inventory_list.' };
  }
  try {
    const ctx = await loadToolInventory(getRepositories(), context);
    const byId = new Map(ctx.pool.items.map((item) => [item.id, item]));
    const equippedItems = ctx.pool.items.filter((item) => ctx.equippedIds.has(item.id));

    const rows: InventoryListItemResult[] = [];
    for (const item of ctx.pool.items) {
      const own = ctx.pool.owns(item.id);
      if (item.archivedAt && !(parsed.include_archived && own)) continue;
      const kind = kindOf(item);
      if (parsed.kind && parsed.kind !== kind) continue;
      const tier = tierOf(item, own);
      if (parsed.tier && parsed.tier !== tier) continue;
      if (parsed.folder && !inFolder(item, parsed.folder)) continue;
      const kit = item.kind === 'kit' ? kitState(item, equippedItems, (id) => byId.get(id)) : undefined;
      const equipped = item.kind === 'kit' ? kit === 'all' : ctx.equippedIds.has(item.id);
      if (parsed.equipped !== undefined && (item.isArchetype || parsed.equipped !== equipped)) continue;
      rows.push({
        id: item.id,
        name: item.name,
        title: item.title?.trim() || null,
        state: stateFor(item, own, equipped),
        kind,
        tier,
        folder: item.folder || null,
        is_own: own,
        description: excerpt(item.description),
        ...(kit ? { kit_state: kit } : {}),
        ...(item.archivedAt ? { archived: true } : {}),
      });
    }
    logInventoryTool('inventory_list', context, { outcome: 'listed', count: rows.length, filters: parsed });
    return { success: true, items: rows, total_count: rows.length };
  } catch (error) {
    logInventoryTool('inventory_list', context, { outcome: 'failed', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, items: [], total_count: 0, error: errorMessageOf(error, 'Failed to list the inventory') };
  }
}

export function formatInventoryListResults(output: InventoryListToolOutput): string {
  if (!output.success) return `Inventory Error: ${output.error || 'Unknown error'}`;
  if (output.items.length === 0) return 'Inventory: nothing matches.';
  const lines = [`Inventory (${output.total_count} object${output.total_count === 1 ? '' : 's'}):`];
  for (const row of output.items) {
    const label = inventoryDisplayName({ name: row.name, title: row.title });
    const state = row.kind === 'archetype' ? 'archetype — pick up an instance' : row.state;
    const kit = row.kit_state ? ` [kit: ${row.kit_state}]` : '';
    const folder = row.folder ? ` [folder: ${row.folder}]` : '';
    const shared = row.is_own ? '' : ' [shared — read-only]';
    const archived = row.archived ? ' [archived]' : '';
    const description = row.description ? ` - ${row.description}` : '';
    lines.push(`  ${label} [${row.id}] (${state}, ${row.tier})${kit}${folder}${shared}${archived}${description}`);
  }
  return lines.join('\n');
}
