/**
 * Chats API v1 - Outfit Actions
 *
 * GET /api/v1/chats/[id]?action=outfit - Get equipped outfit state for the chat
 * POST /api/v1/chats/[id]?action=equip - Equip/unequip a wardrobe item in a slot
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { serverError, notFound, badRequest } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';

const equipSlotSchema = z.object({
  characterId: z.string().min(1, 'characterId is required'),
  slot: z.enum(['top', 'bottom', 'footwear', 'accessories']),
  itemId: z.string().nullable(),
});

/**
 * GET ?action=outfit — Return the full equipped outfit state for this chat
 */
export async function handleGetOutfit(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    logger.debug('[Chats v1] Fetching equipped outfit state', { chatId, context: 'wardrobe' });

    const equippedOutfit = await repos.chats.getEquippedOutfit(chatId);

    return NextResponse.json({ equippedOutfit: equippedOutfit ?? {} });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit');
  }
}

/**
 * POST ?action=equip — Update a single equipped slot for a character in this chat
 */
export async function handleEquipSlot(
  req: NextRequest,
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { characterId, slot, itemId } = equipSlotSchema.parse(body);

    logger.debug('[Chats v1] Equipping wardrobe slot', {
      chatId,
      characterId,
      slot,
      itemId,
      context: 'wardrobe',
    });

    // If setting an item, verify the wardrobe item exists and belongs to this character
    if (itemId) {
      const item = await repos.wardrobe.findById(itemId);
      if (!item) {
        return notFound('Wardrobe item');
      }
      if (item.characterId !== characterId) {
        return badRequest('Wardrobe item does not belong to this character');
      }
      if (!item.types.includes(slot as typeof item.types[number])) {
        return badRequest(`Wardrobe item "${item.title}" does not cover the ${slot} slot`);
      }
    }

    const updatedSlots = await repos.chats.updateEquippedSlot(chatId, characterId, slot, itemId);

    if (!updatedSlots) {
      return serverError('Failed to update equipped slot');
    }

    logger.info('[Chats v1] Wardrobe slot updated', {
      chatId,
      characterId,
      slot,
      itemId,
      context: 'wardrobe',
    });

    // Build outfit summary and store as pending notification for the character's next turn
    try {
      const equippedItemIds = Object.values(updatedSlots).filter(Boolean) as string[];
      const equippedItems = equippedItemIds.length > 0
        ? await repos.wardrobe.findByIds(equippedItemIds)
        : [];
      const itemsMap = new Map(equippedItems.map(i => [i.id, i]));

      const slotLabels: Record<string, string> = {
        top: updatedSlots.top ? (itemsMap.get(updatedSlots.top)?.title ?? 'unknown') : '(nothing)',
        bottom: updatedSlots.bottom ? (itemsMap.get(updatedSlots.bottom)?.title ?? 'unknown') : '(nothing)',
        footwear: updatedSlots.footwear ? (itemsMap.get(updatedSlots.footwear)?.title ?? 'unknown') : '(barefoot)',
        accessories: updatedSlots.accessories ? (itemsMap.get(updatedSlots.accessories)?.title ?? 'unknown') : '(none)',
      };

      const outfitText = `Top: ${slotLabels.top}, Bottom: ${slotLabels.bottom}, Footwear: ${slotLabels.footwear}, Accessories: ${slotLabels.accessories}`;

      // Look up character name for the notification
      const character = await repos.characters.findById(characterId);
      const charName = character?.name ?? 'A character';

      // Store pending notification on the chat, keyed by characterId
      // All characters in the chat will see this notification on their next turn
      const chat = await repos.chats.findById(chatId);
      const pending = (chat?.pendingOutfitNotifications as Record<string, string> | null) ?? {};
      pending[characterId] = `${charName}'s outfit has been changed. ${charName} is now wearing: ${outfitText}`;
      await repos.chats.update(chatId, { pendingOutfitNotifications: pending });
    } catch (notifError) {
      // Non-fatal — outfit change succeeded, notification is best-effort
      logger.warn('[Chats v1] Failed to store outfit change notification', {
        chatId, characterId, error: notifError instanceof Error ? notifError.message : String(notifError),
      });
    }

    return NextResponse.json({ equippedSlots: updatedSlots });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues.map((e: { message: string }) => e.message).join(', '));
    }
    logger.error('[Chats v1] Error equipping wardrobe slot', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to equip wardrobe slot');
  }
}
