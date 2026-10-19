/**
 * Create Inventory Object Tool Handler
 *
 * A new standalone object at the root of the character's own vault, through
 * `createInventoryItem`: never an archetype, never a kit, never copyable, no
 * glyph. Then `equipItems` when asked, told about the new object so it is
 * found even where the pool cannot yet read the file (the job child).
 */

import { getRepositories } from '@/lib/repositories/factory';
import { publishRealtime } from '@/lib/realtime/bus';
import { createInventorySchema } from '@/lib/schemas/inventory.types';
import { createInventoryItem } from '@/lib/inventory/item-mutations';
import { equipItems } from '@/lib/inventory/equip';
import { resolveInventoryLocation } from '@/lib/inventory/location';
import { resolveItem } from '@/lib/inventory/resolve';
import type { InventoryCreateToolOutput } from '../inventory-create-tool';
import { validateInventoryCreateInput } from '../inventory-create-tool';
import {
  characterChangeContext,
  errorMessageOf,
  formatSummary,
  loadToolChat,
  logInventoryTool,
  summarize,
  type InventoryToolContext,
} from './inventory-handler-shared';

export async function executeInventoryCreateTool(
  input: unknown,
  context: InventoryToolContext,
): Promise<InventoryCreateToolOutput> {
  const parsed = validateInventoryCreateInput(input);
  if (!parsed) {
    logInventoryTool('inventory_create', context, { outcome: 'invalid input' }, 'info');
    return { success: false, error: 'Invalid input: name is required; see the tool description for the other fields.' };
  }
  const repos = getRepositories();
  try {
    const vault = await resolveInventoryLocation('character', context.characterId, repos, context.userId);
    if (!vault) return { success: false, error: 'You have no vault to keep a new object in.' };
    const body = createInventorySchema.parse({
      kind: 'item',
      name: parsed.name.trim(),
      ...(parsed.title !== undefined ? { title: parsed.title.trim() || null } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.image_description !== undefined ? { imageDescription: parsed.image_description } : {}),
      ...(parsed.emoji !== undefined ? { emoji: parsed.emoji } : {}),
      ...(parsed.max_equipped !== undefined ? { maxEquipped: parsed.max_equipped } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      isArchetype: false,
      canCopy: false,
      equippedByDefault: false,
    });
    const record = await createInventoryItem(repos, vault, body);
    publishRealtime('inventory');
    const item = resolveItem({ ...record, origin: vault.origin, mountPointId: vault.mountPointId }, () => undefined);

    let equipped = false;
    if (parsed.equip) {
      const chat = await loadToolChat(repos, context.chatId);
      if (chat) {
        const result = await equipItems(repos, chat, context.characterId, [item.id], characterChangeContext(context), { known: [item] });
        equipped = result.equipped.some((e) => e.id === item.id) || result.alreadyEquipped.includes(item.id);
      }
    }
    logInventoryTool('inventory_create', context, { refs: [parsed.name], resolved: [item.id], outcome: 'created', equipped });
    return { success: true, item: summarize(item, true, equipped), equipped };
  } catch (error) {
    logInventoryTool('inventory_create', context, { refs: [parsed.name], outcome: 'refused', error: errorMessageOf(error, 'unknown') }, 'info');
    return { success: false, error: errorMessageOf(error, 'Failed to create the object') };
  }
}

export function formatInventoryCreateResults(output: InventoryCreateToolOutput): string {
  if (!output.success || !output.item) return `Inventory Error: ${output.error || 'Unknown error'}`;
  return `Created ${formatSummary(output.item)} in your own vault${output.equipped ? ', equipped' : ''}.`;
}
