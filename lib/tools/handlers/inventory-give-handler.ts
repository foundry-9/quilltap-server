/**
 * Give Inventory Object Tool Handler
 *
 * Own, non-archived, non-kit objects only; the receiver a live, non-archived
 * participant of this chat other than the giver. In order:
 *
 *   1. the file moves through `transferInventoryItem` (id and folder kept) —
 *      a refusal here (a kit stranded, a collision) leaves everything as it
 *      was, the giver still carrying it;
 *   2. `dropCarriedEverywhere` drops the id from the giver's entry in every
 *      chat, each under its chat's carried-set lock (a later give-back must
 *      not reappear as carried). By id, so the move cannot hide it;
 *   3. Pascal posts one line of its own through `notifyInventoryChanged`.
 *
 * The receiver's carried sets are untouched; they equip it themselves.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { notifyInventoryChanged } from '@/lib/inventory/equip-effects';
import { dropCarriedEverywhere } from '@/lib/inventory/equip';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve';
import { transferInventoryItem } from '@/lib/inventory/transfers';
import type { InventoryGiveToolOutput } from '../inventory-give-tool';
import { validateInventoryGiveInput } from '../inventory-give-tool';
import {
  characterChangeContext,
  errorMessageOf,
  inventoryNotFoundMessage,
  loadOwnRecord,
  loadToolChat,
  loadToolInventory,
  logInventoryTool,
  resolveToolRef,
  sharedInventoryItemReadOnlyMessage,
  summarize,
  type InventoryRepos,
  type InventoryToolContext,
} from './inventory-handler-shared';

/** The receiver among the chat's live participants, by id or name; or why not. */
async function resolveReceiver(
  repos: InventoryRepos,
  participants: ReadonlyArray<{ characterId?: string | null; status?: string | null }>,
  giverId: string,
  to: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const wanted = to.trim().toLowerCase();
  const seated = participants
    .filter((p) => !!p.characterId && p.status !== 'removed')
    .map((p) => p.characterId as string);
  // An id names the receiver without loading anyone else; a name loads the
  // cast at once rather than one after another.
  const byId = seated.find((id) => id.toLowerCase() === wanted);
  const candidates = byId
    ? [{ id: byId, character: await repos.characters.findByIdRaw(byId) }]
    : await Promise.all(seated.map(async (id) => ({ id, character: await repos.characters.findByIdRaw(id) })));
  for (const { id, character } of candidates) {
    if (!character) continue;
    if (!byId && character.name.trim().toLowerCase() !== wanted) continue;
    if (id === giverId) return { error: 'You cannot give an object to yourself.' };
    if (character.archivedAt) return { error: `${character.name} is archived and cannot receive anything.` };
    return { id, name: character.name };
  }
  return { error: `No one named "${to}" is in this chat to receive it.` };
}

export async function executeInventoryGiveTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryGiveToolOutput> {
  const parsed = validateInventoryGiveInput(input);
  if (!parsed) {
    logInventoryTool('inventory_give', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: ref (the object) and to (the receiver) are required.' };
  }
  const repos = getRepositories();
  const refuse = (error: string, resolved: string[] = []): InventoryGiveToolOutput => {
    logInventoryTool('inventory_give', context, { refs: [parsed.ref], resolved, to: parsed.to, outcome: 'refused', error }, 'info');
    return { success: false, error };
  };
  try {
    const [ctx, chat] = await Promise.all([loadToolInventory(repos, context), loadToolChat(repos, context.chatId)]);
    if (!chat) return refuse('This chat could not be found.');
    const matches = resolveToolRef(ctx, parsed.ref);
    if (matches.length === 0) return refuse(inventoryNotFoundMessage(parsed.ref));
    const match = matches.find((m) => m.own);
    if (!match) return refuse(sharedInventoryItemReadOnlyMessage(matches[0].item, 'given'), [matches[0].item.id]);
    const { item } = match;
    if (item.kind === 'kit') return refuse(`"${inventoryLabel(item)}" is a kit; give its objects one by one.`, [item.id]);

    const receiver = await resolveReceiver(repos, chat.participants ?? [], context.characterId, parsed.to);
    if ('error' in receiver) return refuse(receiver.error, [item.id]);

    const own = await loadOwnRecord(repos, context, item.id);
    if (!own) return refuse(inventoryNotFoundMessage(parsed.ref), [item.id]);
    const destination = await resolveInventoryLocation('character', receiver.id, repos, context.userId, { ensure: true });
    if (!destination) return refuse(`${receiver.name} has no vault to receive it.`, [item.id]);

    const { item: moved } = await transferInventoryItem(repos, {
      action: 'move',
      source: own.vault,
      destination,
      record: own.record,
      userId: context.userId,
    });
    await dropCarriedEverywhere(repos, context.characterId, item.id, [context.chatId]);
    await notifyInventoryChanged(
      repos,
      { id: context.chatId },
      context.characterId,
      { equipped: [], unequipped: [], given: { item: moved, toName: receiver.name } },
      characterChangeContext(context),
    );
    logInventoryTool('inventory_give', context, { refs: [parsed.ref], resolved: [item.id], to: receiver.id, outcome: 'given' });
    return {
      success: true,
      // The receiver's now: carried by no one until they equip it.
      item: summarize(moved, true, false),
      recipient: receiver,
    };
  } catch (error) {
    return refuse(errorMessageOf(error, 'Failed to give the object'));
  }
}

export function formatInventoryGiveResults(output: InventoryGiveToolOutput): string {
  if (!output.success || !output.item || !output.recipient) return `Inventory Error: ${output.error || 'Unknown error'}`;
  const label = inventoryDisplayName({ name: output.item.name, title: output.item.title });
  return `Handed ${label} [${output.item.id}] to ${output.recipient.name}. It is in their vault now; they may equip it.`;
}
