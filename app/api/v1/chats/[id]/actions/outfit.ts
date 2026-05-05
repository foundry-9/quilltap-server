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
 * GET ?action=outfit-summary — Return per-character equipped outfit with
 * resolved item titles. Used by the new-chat modal's continuation flow to
 * show users what each character was wearing at the end of the source chat
 * (so they can verify before clicking "Continue"). Shape:
 *
 *   { summary: { [characterId]: { [slot]: { itemId, title } | null } } }
 */
export async function handleGetOutfitSummary(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    logger.debug('[Chats v1] Fetching equipped outfit summary', { chatId, context: 'wardrobe' });

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    const equippedOutfit = (await repos.chats.getEquippedOutfit(chatId)) ?? {};

    // Collect every itemId across all characters/slots, then bulk-resolve titles.
    const allItemIds = new Set<string>();
    for (const slots of Object.values(equippedOutfit)) {
      if (!slots) continue;
      for (const id of Object.values(slots)) {
        if (typeof id === 'string' && id.length > 0) allItemIds.add(id);
      }
    }

    const itemsById = new Map<string, { id: string; title: string }>();
    if (allItemIds.size > 0) {
      const items = await repos.wardrobe.findByIds(Array.from(allItemIds));
      for (const item of items) {
        itemsById.set(item.id, { id: item.id, title: item.title });
      }
    }

    const summary: Record<string, Record<string, { itemId: string; title: string } | null>> = {};
    for (const [characterId, slots] of Object.entries(equippedOutfit)) {
      const slotMap: Record<string, { itemId: string; title: string } | null> = {
        top: null,
        bottom: null,
        footwear: null,
        accessories: null,
      };
      if (slots) {
        for (const [slot, itemId] of Object.entries(slots)) {
          if (typeof itemId !== 'string' || itemId.length === 0) continue;
          const item = itemsById.get(itemId);
          if (item) slotMap[slot] = { itemId: item.id, title: item.title };
        }
      }
      summary[characterId] = slotMap;
    }

    return NextResponse.json({ summary });
  } catch (error) {
    logger.error('[Chats v1] Error fetching equipped outfit summary', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch equipped outfit summary');
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
      // Equipping: verify the wardrobe item exists and belongs to this character.
      // Use the per-character lookup so vault-only items (no DB row) resolve via
      // the document-store overlay.
      const item = await repos.wardrobe.findByIdForCharacter(characterId, itemId);
      if (!item) {
        return notFound('Wardrobe item');
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

    // Phase D: outfit-change context is now delivered via a debounced Aurora
    // whisper (see `enqueueWardrobeOutfitAnnouncement` below). The previous
    // per-turn `pendingOutfitNotifications` flow has been retired — the
    // transcript-resident Aurora announcement is the single source of truth
    // for both the user and the LLM.

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
