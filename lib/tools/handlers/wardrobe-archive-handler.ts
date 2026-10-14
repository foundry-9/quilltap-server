/**
 * Archive Wardrobe Item Tool Handler
 *
 * Soft-retires a wardrobe item through `setItemArchived` — the same
 * idempotent rule the item routes use, so archiving an already-archived item
 * keeps its original date (bug 188). Never hard-deletes — restoring is a
 * human-only UI action.
 * Resolves the target across every tier to LOCATE it, then enforces
 * own-items-only: shared archetypes (project / Quilltap General) are read-only
 * and the call is refused.
 *
 * If the archived item was currently equipped, the Aurora announcement + avatar
 * generation fire so the visible outfit refreshes (archive does not itself
 * remove the item from equipped slots — it stays worn until taken off).
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeArchiveToolInput, WardrobeArchiveToolOutput } from '../wardrobe-archive-tool';
import { validateWardrobeArchiveInput } from '../wardrobe-archive-tool';
import { setItemArchived } from '@/lib/wardrobe/item-mutations';
import { resolveWardrobeLocation } from '@/lib/wardrobe/location';
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects';
import { findInPool } from '@/lib/wardrobe/wear-ops';
import {
  findEquippedSlots,
  loadToolPool,
  normalizeNoItemSentinel,
  sharedWardrobeItemReadOnlyMessage,
  wardrobeItemNotFoundMessage,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeArchiveToolContext = WardrobeToolContext;

function buildFailureResponse(error: string): WardrobeArchiveToolOutput {
  return { success: false, item_id: '', title: '', action: 'archived', error };
}

export async function executeWardrobeArchiveTool(
  input: unknown,
  context: WardrobeArchiveToolContext,
): Promise<WardrobeArchiveToolOutput> {
  const repos = getRepositories();

  const parsed = validateWardrobeArchiveInput(input);

  if (!parsed) {
    logger.warn('Wardrobe archive tool validation failed', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return buildFailureResponse('Invalid input: item_id or item_title is required.');
  }

  try {
    const { item_id, item_title } = parsed;
    const pool = await loadToolPool(repos, context.chatId, context.characterId);

    const item = findInPool(pool, {
      itemId: normalizeNoItemSentinel(item_id),
      itemTitle: normalizeNoItemSentinel(item_title),
    });
    if (!item) {
      return buildFailureResponse(wardrobeItemNotFoundMessage(item_id, item_title));
    }

    if (!pool.owns(item)) {
      return buildFailureResponse(sharedWardrobeItemReadOnlyMessage(item.title, 'archived'));
    }

    const location = await resolveWardrobeLocation('character', context.characterId, repos, context.userId);
    if (!location) {
      return buildFailureResponse(`Failed to archive wardrobe item "${item.title}"`);
    }

    // Is the item currently equipped? (Archive doesn't clear equipped slots, but
    // an equipped-then-archived item warrants a visible refresh.)
    const equipped = await repos.chats.getEquippedOutfitForCharacter(context.chatId, context.characterId);
    const wasEquipped = findEquippedSlots(item.id, equipped).length > 0;

    const { item: archived, changed } = await setItemArchived(location, item, true);
    if (!changed) {
      if (archived) {
        logger.debug('Wardrobe item already archived; keeping its original date', {
          context: 'wardrobe-archive-handler',
          chatId: context.chatId,
          characterId: context.characterId,
          itemId: item.id,
          archivedAt: item.archivedAt,
        });
        return { success: true, item_id: item.id, title: item.title, action: 'archived', already_archived: true };
      }
      return buildFailureResponse(`Failed to archive wardrobe item "${item.title}"`);
    }

    if (wasEquipped) {
      await notifyWardrobeChanged(
        repos,
        {
          userId: context.userId,
          chatId: context.chatId,
          characterId: context.characterId,
          pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
        },
        'wardrobe-archive-handler',
      );
    }

    logger.info('Wardrobe item archived', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      itemId: item.id,
      itemTitle: item.title,
      wasEquipped,
    });

    return { success: true, item_id: item.id, title: item.title, action: 'archived' };
  } catch (error) {
    logger.error('Wardrobe archive tool execution failed', {
      context: 'wardrobe-archive-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);
    return buildFailureResponse(
      error instanceof Error ? error.message : 'Unknown error during wardrobe archive',
    );
  }
}

/**
 * Format wardrobe archive results for inclusion in conversation context
 */
export function formatWardrobeArchiveResults(output: WardrobeArchiveToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  if (output.already_archived) {
    return `"${output.title}" (${output.item_id}) was already archived; nothing changed.`;
  }
  return `Archived "${output.title}" (${output.item_id}). It's hidden from listings and can't be worn; a human can restore it.`;
}
