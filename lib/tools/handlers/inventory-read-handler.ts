/**
 * Read Inventory Object Tool Handler
 *
 * One object in full, best match first (equipped, then own, then shared).
 * Pictures are reported by presence, never bytes.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { inventoryDisplayName } from '@/lib/inventory/resolve';
import type { InventoryReadToolOutput } from '../inventory-read-tool';
import { validateInventoryReadInput } from '../inventory-read-tool';
import {
  errorMessageOf,
  closedShelfMessage,
  inventoryNotFoundMessage,
  kindOf,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  stateFor,
  tierOf,
  type InventoryToolContext,
} from './inventory-handler-shared';

export async function executeInventoryReadTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryReadToolOutput> {
  const parsed = validateInventoryReadInput(input);
  if (!parsed) {
    logInventoryTool('inventory_read', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: ref is required.' };
  }
  try {
    const ctx = await loadToolInventory(getRepositories(), context);
    const matches = resolveToolRef(ctx, parsed.ref, { includeArchetypes: true, includeArchived: true });
    const match = matches.find((m) => m.equipped) ?? matches.find((m) => m.own) ?? matches[0];
    if (!match) {
      logInventoryTool('inventory_read', context, { refs: [parsed.ref], resolved: [], outcome: 'not found' }, 'info');
      return { success: false, error: closedShelfMessage(ctx, parsed.ref) ?? inventoryNotFoundMessage(parsed.ref) };
    }
    const { item } = match;
    const byId = new Map(ctx.pool.items.map((candidate) => [candidate.id, candidate]));
    const archetype = item.parentId ? byId.get(item.parentId) : undefined;
    const members = item.kind === 'kit'
      ? item.itemIds.map((id) => {
          const member = byId.get(id);
          return member
            ? { id, name: member.name, title: member.title?.trim() || null, state: stateFor(member, ctx.pool.owns(id), ctx.equippedIds.has(id)) }
            : { id, name: '(unreachable)', title: null, state: null };
        })
      : undefined;
    logInventoryTool('inventory_read', context, { refs: [parsed.ref], resolved: [item.id], outcome: 'read' });
    return {
      success: true,
      id: item.id,
      name: item.name,
      title: item.title?.trim() || null,
      state: stateFor(item, match.own, match.equipped),
      kind: kindOf(item),
      tier: tierOf(item, match.own),
      is_own: match.own,
      description: item.description ?? null,
      image_description: item.imageDescription ?? null,
      emoji: item.emoji ?? null,
      metadata: item.metadata ?? {},
      parent_id: item.parentId ?? null,
      archetype_title: item.parentId ? (item.parentName ?? (archetype ? archetype.title || archetype.name : null)) : null,
      max_equipped: item.maxEquipped,
      can_copy: item.canCopy,
      has_picture: !!item.imageFileId,
      folder: item.folder || null,
      ...(members ? { members } : {}),
    };
  } catch (error) {
    logInventoryTool('inventory_read', context, { refs: [parsed.ref], outcome: 'failed', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, error: errorMessageOf(error, 'Failed to read the object') };
  }
}

export function formatInventoryReadResults(output: InventoryReadToolOutput): string {
  if (!output.success) return `Inventory Error: ${output.error || 'Unknown error'}`;
  const lines = [
    `${output.emoji ? `${output.emoji} ` : ''}${inventoryDisplayName({ name: output.name ?? '', title: output.title })} [${output.id}]`,
    `State: ${output.kind === 'archetype' ? 'archetype (pick up an instance with inventory_pick_up)' : output.state} · ${output.tier}${output.is_own ? '' : ' [shared — read-only]'}`,
  ];
  if (output.archetype_title) lines.push(`Instance of: ${output.archetype_title}`);
  if (output.description) lines.push(`Description: ${output.description}`);
  if (output.image_description) lines.push(`Looks: ${output.image_description}`);
  lines.push(`At most ${output.max_equipped} carried at a time${output.can_copy ? '' : ' · cannot be copied'}${output.has_picture ? ' · has a picture' : ''}`);
  if (output.folder) lines.push(`Folder: ${output.folder}`);
  if (output.metadata && Object.keys(output.metadata).length > 0) lines.push(`Metadata: ${JSON.stringify(output.metadata)}`);
  if (output.members) {
    lines.push('Members:');
    for (const m of output.members) lines.push(`  ${inventoryDisplayName({ name: m.name, title: m.title })} [${m.id}] (${m.state ?? 'archetype'})`);
  }
  return lines.join('\n');
}
