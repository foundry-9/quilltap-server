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
import { equipWithDisplacement, unequipWithDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';

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
  ctx: AuthenticatedContext
): Promise<NextResponse> {
  const { repos } = ctx;
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

    // Equip or unequip with full displacement of multi-type items
    let updatedSlots;

    if (itemId) {
      // Equipping: verify the wardrobe item exists and belongs to this character
      const item = await repos.wardrobe.findById(itemId);
      if (!item) {
        return notFound('Wardrobe item');
      }
      if (item.characterId != null && item.characterId !== characterId) {
        return badRequest('Wardrobe item does not belong to this character');
      }
      if (!item.types.includes(slot as typeof item.types[number])) {
        return badRequest(`Wardrobe item "${item.title}" does not cover the ${slot} slot`);
      }

      // Equip in all item's type slots, displacing any conflicting items
      updatedSlots = await equipWithDisplacement(repos, chatId, characterId, item);
    } else {
      // Unequipping: clear all slots covered by the item currently in this slot
      updatedSlots = await unequipWithDisplacement(repos, chatId, characterId, slot as WardrobeItemType);
    }

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
    logger.debug('[Chats v1] Building outfit change notification', { chatId, characterId, context: 'wardrobe' });
    try {
      const equippedItemIds = Object.values(updatedSlots).filter(Boolean) as string[];
      const equippedItems = equippedItemIds.length > 0
        ? await repos.wardrobe.findByIds(equippedItemIds)
        : [];
      const itemsMap = new Map(equippedItems.map(i => [i.id, i]));

      const findTitle = (slotName: string): string | null => {
        const slotItemId = updatedSlots[slotName as keyof typeof updatedSlots];
        if (!slotItemId) return null;
        return itemsMap.get(slotItemId)?.title ?? null;
      };
      const outfitText = describeOutfit({
        top: findTitle('top'),
        bottom: findTitle('bottom'),
        footwear: findTitle('footwear'),
        accessories: findTitle('accessories'),
      });

      // Look up character name for the notification
      const character = await repos.characters.findById(characterId);
      const charName = character?.name ?? 'A character';

      // Store pending notification on the chat, keyed by characterId
      // All characters in the chat will see this notification on their next turn
      const chat = await repos.chats.findById(chatId);
      const pending = (chat?.pendingOutfitNotifications as Record<string, string> | null) ?? {};
      pending[characterId] = `${charName}'s outfit has been changed. ${charName} is now wearing: ${outfitText}`;
      await repos.chats.update(chatId, { pendingOutfitNotifications: pending });
      logger.info('[Chats v1] Stored outfit change notification', {
        chatId, characterId, charName, notification: pending[characterId], context: 'wardrobe',
      });
    } catch (notifError) {
      // Non-fatal — outfit change succeeded, notification is best-effort
      logger.warn('[Chats v1] Failed to store outfit change notification', {
        chatId, characterId, error: notifError instanceof Error ? notifError.message : String(notifError),
      });
    }

    // Trigger avatar generation if enabled for this chat
    await triggerAvatarGenerationIfEnabled(repos, {
      userId: ctx.user.id,
      chatId,
      characterId,
      callerContext: '[Chats v1] outfit-equip',
    });

    // Schedule a debounced Aurora announcement (or push back the existing one)
    try {
      await enqueueWardrobeOutfitAnnouncement(ctx.user.id, { chatId, characterId });
    } catch (announceError) {
      logger.warn('[Chats v1] Failed to schedule outfit announcement', {
        chatId, characterId,
        error: announceError instanceof Error ? announceError.message : String(announceError),
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
