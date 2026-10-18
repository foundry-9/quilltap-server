/**
 * Give Inventory Object Tool Handler
 *
 * Own, non-archived, non-kit objects only; the receiver a live, non-archived
 * participant of this chat other than the giver. Order matters because a
 * move keeps the id and a pool-resolved unequip would no longer see the
 * object:
 *
 *   1. `removeEquippedInventoryId` drops the id from the giver's entry in
 *      every chat (a later give-back must not reappear as carried);
 *   2. the file moves through `transferInventoryItem` (id and folder kept);
 *   3. Pascal posts one line of its own through `notifyInventoryChanged`.
 *
 * The receiver's carried sets are untouched; they equip it themselves.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { publishRealtime } from '@/lib/realtime/bus';
import { notifyInventoryChanged } from '@/lib/inventory/equip-effects';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve';
import { transferInventoryItem } from '@/lib/inventory/transfers';
import type { InventoryGiveToolOutput } from '../inventory-give-tool';
import { validateInventoryGiveInput } from '../inventory-give-tool';
import {
  characterChangeContext,
  errorMessageOf,
  inventoryNotFoundMessage,
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
  for (const participant of participants) {
    const characterId = participant.characterId;
    if (!characterId || participant.status === 'removed') continue;
    const character = await repos.characters.findByIdRaw(characterId);
    if (!character) continue;
    if (characterId.toLowerCase() !== wanted && character.name.trim().toLowerCase() !== wanted) continue;
    if (characterId === giverId) return { error: 'You cannot give an object to yourself.' };
    if (character.archivedAt) return { error: `${character.name} is archived and cannot receive anything.` };
    return { id: characterId, name: character.name };
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

    const source = await resolveInventoryLocation('character', context.characterId, repos, context.userId);
    const destination = await resolveInventoryLocation('character', receiver.id, repos, context.userId, { ensure: true });
    const record = source ? await source.findItem(item.id) : null;
    if (!source || !record) return refuse(inventoryNotFoundMessage(parsed.ref), [item.id]);
    if (!destination) return refuse(`${receiver.name} has no vault to receive it.`, [item.id]);

    await repos.chats.removeEquippedInventoryId(context.characterId, item.id);
    publishRealtime('chats', context.chatId);
    const { item: moved } = await transferInventoryItem(repos, {
      action: 'move',
      source,
      destination,
      record,
      userId: context.userId,
    });
    publishRealtime('inventory');
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
