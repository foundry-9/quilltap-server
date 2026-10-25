/**
 * Equip Inventory Objects Tool Handler
 *
 * Resolves each ref (`pickForGesture(…, 'equip')`), then one `equipItems`
 * call with the character's provenance, joined to the turn's pending
 * announcement. The chokepoint's refusals (`CAP_EXCEEDED`, `NOT_EQUIPPABLE`)
 * come back as tool failures in their own words, with nothing changed.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { equipItems, loadEquipChat } from '@/lib/inventory/equip';
import { inventoryLabel } from '@/lib/inventory/resolve';
import { pickForGesture } from '@/lib/inventory/refs';
import type { InventoryEquipToolOutput } from '../inventory-equip-tool';
import { validateInventoryEquipInput } from '../inventory-equip-tool';
import {
  characterChangeContext,
  errorMessageOf,
  formatSummary,
  closedShelfMessage,
  inventoryNotFoundMessage,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  summarize,
  summarizeMatch,
  type InventoryToolContext,
} from './inventory-handler-shared';

function failure(error: string): InventoryEquipToolOutput {
  return { success: false, equipped: [], created: [], already_equipped: [], skipped: [], error };
}

export async function executeInventoryEquipTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryEquipToolOutput> {
  const parsed = validateInventoryEquipInput(input);
  if (!parsed) {
    logInventoryTool('inventory_equip', context, { outcome: 'invalid input' }, 'info');
    return failure('Invalid input: refs must be a list of one to eight object references.');
  }
  const repos = getRepositories();
  try {
    const [ctx, chat] = await Promise.all([loadToolInventory(repos, context), loadEquipChat(repos, context.chatId)]);
    if (!chat) return failure('This chat could not be found.');

    const output: InventoryEquipToolOutput = { success: true, equipped: [], created: [], already_equipped: [], skipped: [] };
    const ids: string[] = [];
    for (const ref of parsed.refs) {
      const matches = resolveToolRef(ctx, ref, { includeArchetypes: true });
      if (matches.length === 0) {
        output.skipped.push({ ref, reason: closedShelfMessage(ctx, ref) ?? inventoryNotFoundMessage(ref) });
        continue;
      }
      const pick = pickForGesture(matches, 'equip');
      if (pick) {
        if (!ids.includes(pick.item.id)) ids.push(pick.item.id);
        continue;
      }
      const carried = matches.find((m) => m.equipped);
      if (carried) {
        output.already_equipped.push(summarizeMatch(carried));
        continue;
      }
      const archetype = matches.find((m) => m.item.isArchetype);
      output.skipped.push({
        ref,
        reason: archetype
          ? `"${inventoryLabel(archetype.item)}" is an archetype — pick up an instance of it with inventory_pick_up.`
          : `"${ref}" cannot be carried.`,
      });
    }

    if (ids.length === 0) {
      logInventoryTool('inventory_equip', context, { refs: parsed.refs, resolved: [], outcome: 'nothing to equip', skipped: output.skipped }, 'info');
      if (output.already_equipped.length > 0) return output;
      return { ...failure(output.skipped.map((s) => s.reason).join(' ') || 'Nothing to equip.'), skipped: output.skipped };
    }

    const result = await equipItems(repos, chat, context.characterId, ids, characterChangeContext(context));
    const createdIds = new Set(result.created.map((item) => item.id));
    output.equipped = result.equipped.map((item) => summarize(item, createdIds.has(item.id) || ctx.pool.owns(item.id), true));
    output.created = result.created.map((item) => summarize(item, true, true));
    for (const id of result.alreadyEquipped) {
      const item = ctx.pool.items.find((candidate) => candidate.id === id);
      if (item) output.already_equipped.push(summarize(item, ctx.pool.owns(id), true));
    }
    for (const skip of result.skipped) output.skipped.push({ ref: skip.id, reason: `a kit member could not be carried (${skip.reason})` });
    logInventoryTool('inventory_equip', context, {
      refs: parsed.refs,
      resolved: ids,
      outcome: 'equipped',
      equipped: output.equipped.map((s) => s.id),
      created: output.created.map((s) => s.id),
    });
    return output;
  } catch (error) {
    logInventoryTool('inventory_equip', context, { refs: parsed.refs, outcome: 'refused', error: errorMessageOf(error, 'unknown') }, 'info');
    return failure(errorMessageOf(error, 'Failed to equip'));
  }
}

export function formatInventoryEquipResults(output: InventoryEquipToolOutput): string {
  if (!output.success) return `Inventory Error: ${output.error || 'Unknown error'}`;
  const lines: string[] = [];
  for (const s of output.equipped) lines.push(`Equipped ${formatSummary(s)}`);
  for (const s of output.created) lines.push(`  (a new instance was made for a kit: ${s.id})`);
  for (const s of output.already_equipped) lines.push(`Already equipped: ${formatSummary(s)}`);
  for (const s of output.skipped) lines.push(`Skipped "${s.ref}": ${s.reason}`);
  return lines.join('\n') || 'Nothing changed.';
}
