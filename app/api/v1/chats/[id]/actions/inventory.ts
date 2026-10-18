/**
 * Chats API v1 - Inventory Actions
 *
 * GET  /api/v1/chats/[id]?action=inventory                — what every cast member carries, resolved, with each reachable kit's state (and the chat's projectId)
 * POST /api/v1/chats/[id]?action=inventory-equip          — `{ characterId, ids }`: take up objects or kits
 * POST /api/v1/chats/[id]?action=inventory-unequip        — `{ characterId, ids }`: set them down
 * POST /api/v1/chats/[id]?action=inventory-reset-defaults — `{ characterId }`: back to the equipped-by-default set
 *
 * The operator is changing what a character carries: every gesture goes
 * through `equipItems` / `unequipItems` (`lib/inventory/equip.ts`), which
 * plan before they write, refuse a cap breach whole and post Pascal's one
 * line. Refusals answer through `inventoryErrorResponse`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { chatInventoryEquipSchema, chatInventoryResetSchema, type KitState, type ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { equipItems, InventoryNotAParticipantError, unequipItems, type EquipChat } from '@/lib/inventory/equip';
import { resetInventoryToDefaults } from '@/lib/inventory/apply-defaults';
import { readEquippedSet } from '@/lib/inventory/equipped-set';
import { loadCastInventoryPools } from '@/lib/inventory/pool';
import { kitState } from '@/lib/inventory/resolve';
import { inventoryErrorResponse } from '@/lib/inventory/routes/responses';

const OPERATOR = (userId: string) => ({ userId, provenance: 'operator' as const, announce: true });

/** The cast whose Inventory the chat shows: every seated character. */
function castOf(chat: EquipChat): string[] {
  return Array.from(new Set(
    (chat.participants ?? [])
      .filter((p) => p.type === 'CHARACTER' && p.characterId && p.status !== 'removed')
      .map((p) => p.characterId as string),
  ));
}

/** GET ?action=inventory */
export async function handleGetInventory(chatId: string, { repos }: RequestContext): Promise<NextResponse> {
  const chat = (await repos.chats.findById(chatId)) as EquipChat | null;
  if (!chat) return notFound('Chat');
  const cast = castOf(chat);
  const pools = await loadCastInventoryPools(repos, chat, cast);
  const inventory: Record<string, { equipped: ResolvedInventoryItem[]; kits: Record<string, KitState> }> = {};
  for (const characterId of cast) {
    const pool = pools.get(characterId);
    if (!pool) continue;
    const equipped = readEquippedSet(chat, characterId, pool);
    const kits: Record<string, KitState> = {};
    for (const item of pool.resolved()) {
      if (item.kind === 'kit') kits[item.id] = kitState(item, equipped, (id) => pool.resolveId(id));
    }
    inventory[characterId] = { equipped, kits };
  }
  logger.debug('[Chats v1] Read the cast inventory', {
    chatId,
    characters: cast.length,
    carried: Object.values(inventory).reduce((n, entry) => n + entry.equipped.length, 0),
    context: 'inventory',
  });
  return successResponse({ inventory, projectId: chat.projectId ?? null });
}

/** POST ?action=inventory-equip / inventory-unequip */
export async function handleInventoryEquip(
  req: NextRequest,
  chatId: string,
  { repos, user }: RequestContext,
  mode: 'equip' | 'unequip',
): Promise<NextResponse> {
  const body = chatInventoryEquipSchema.parse(await req.json());
  const chat = (await repos.chats.findById(chatId)) as EquipChat | null;
  if (!chat) return notFound('Chat');
  try {
    const result = mode === 'equip'
      ? await equipItems(repos, chat, body.characterId, body.ids, OPERATOR(user.id))
      : await unequipItems(repos, chat, body.characterId, body.ids, OPERATOR(user.id));
    logger.info(`[Chats v1] Inventory ${mode}`, { chatId, characterId: body.characterId, ids: body.ids, context: 'inventory' });
    return successResponse(result);
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

/** POST ?action=inventory-reset-defaults */
export async function handleInventoryResetDefaults(
  req: NextRequest,
  chatId: string,
  { repos, user }: RequestContext,
): Promise<NextResponse> {
  const body = chatInventoryResetSchema.parse(await req.json());
  const chat = (await repos.chats.findById(chatId)) as EquipChat | null;
  if (!chat) return notFound('Chat');
  if (!castOf(chat).includes(body.characterId)) {
    return inventoryErrorResponse(new InventoryNotAParticipantError(body.characterId));
  }
  const equipped = await resetInventoryToDefaults(repos, chat, body.characterId, user.id);
  logger.info('[Chats v1] Inventory reset to defaults', { chatId, characterId: body.characterId, count: equipped.length, context: 'inventory' });
  return successResponse({ equipped });
}
