/**
 * Create Wardrobe Item Tool Handler
 *
 * Creates new wardrobe items — leaf or composite — and optionally equips
 * them immediately. Supports gifting items to other characters in the chat
 * via the optional `recipient` parameter, and an optional Portrait Cue
 * (`image_prompt`) that steers image generation.
 *
 * Composite items are built by supplying `component_item_ids` and/or
 * `component_titles`. The handler resolves both against the target
 * character's wearable pool (their own wardrobe, their groups, the project,
 * Quilltap General), dedupes, and creates through `createItem`, whose `types`
 * are the components' slots widened by any `types` the caller lists. Cycles
 * are refused by the folder writer before anything lands.
 *
 * `equip_now` wears it through the same gesture as `wardrobe_wear` and fires
 * the same outfit-change effects — avatar refresh and the Aurora announcement
 * (bug 193).
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeCreateToolInput,
  WardrobeCreateToolOutput,
} from '../wardrobe-create-tool';
import { validateWardrobeCreateInput } from '../wardrobe-create-tool';
import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { isComposite as itemIsComposite, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';
import { createItem } from '@/lib/wardrobe/item-mutations';
import { resolveWardrobeLocation } from '@/lib/wardrobe/location';
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects';
import { loadWearablePool, type WearablePool } from '@/lib/wardrobe/pool';
import { wearItem } from '@/lib/wardrobe/wear-ops';
import { formatWardrobeToolImageLine, maybeQueueWardrobeToolImage } from '@/lib/wardrobe/tool-image-generation';
import {
  describeWardrobeEffect,
  formatEquippedSlotLines,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeCreateToolContext = WardrobeToolContext;

export class WardrobeCreateError extends Error {
  constructor(message: string, public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND') {
    super(message);
    this.name = 'WardrobeCreateError';
  }
}

/**
 * Resolve a recipient character ID from a name string by searching chat participants.
 * Returns { characterId, characterName } or null if not found.
 */
async function resolveRecipientFromChat(
  chatId: string,
  recipientName: string,
): Promise<{ characterId: string; characterName: string } | null> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) return null;

  const participants = (chat as Record<string, unknown>).participants as Array<{
    characterId?: string;
    status?: string;
  }> | undefined;

  if (!participants || !Array.isArray(participants)) return null;

  const normalizedSearch = recipientName.trim().toLowerCase();

  for (const participant of participants) {
    if (participant.status === 'removed') continue;
    const charId = participant.characterId;
    if (!charId) continue;

    const character = await repos.characters.findById(charId);
    if (!character) continue;

    if (character.name.trim().toLowerCase() === normalizedSearch) {
      return { characterId: charId, characterName: character.name };
    }
  }

  return null;
}

/**
 * Resolve component references (ids and/or titles) against the target's pool
 * into a deduplicated, ordered list. Ids first, then titles (the character's
 * own items win a title collision); an unknown reference throws.
 */
function resolveComponentItems(
  pool: WearablePool,
  componentIds: string[] | undefined,
  componentTitles: string[] | undefined,
): WardrobeItem[] {
  const seen = new Set<string>();
  const resolved: WardrobeItem[] = [];
  const add = (item: WardrobeItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    resolved.push(item);
  };

  for (const id of componentIds ?? []) {
    const item = pool.get(id);
    if (!item) {
      throw new WardrobeCreateError(
        `Component item with ID "${id}" was not found in this character's wardrobe, their groups, the project, or Quilltap General`,
        'NOT_FOUND',
      );
    }
    add(item);
  }

  for (const title of componentTitles ?? []) {
    const item = pool.findByTitle(title);
    if (!item) {
      throw new WardrobeCreateError(
        `Component item titled "${title}" was not found in this character's wardrobe, their groups, the project, or Quilltap General`,
        'NOT_FOUND',
      );
    }
    add(item);
  }

  return resolved;
}

/**
 * Execute the create wardrobe item tool
 */
export async function executeWardrobeCreateTool(
  input: unknown,
  context: WardrobeCreateToolContext,
): Promise<WardrobeCreateToolOutput> {
  const repos = getRepositories();

  try {
    const parsed = validateWardrobeCreateInput(input);
    if (!parsed) {
      logger.warn('Wardrobe create tool validation failed', {
        context: 'wardrobe-create-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return {
        success: false,
        item_id: '',
        title: '',
        equipped: false,
        error:
          'Invalid input: title (string) is required. Either supply types ' +
          '(non-empty array of valid slot types) for a leaf item, or ' +
          'component_item_ids / component_titles for a composite item.',
      };
    }

    const {
      title,
      description,
      image_prompt,
      types,
      appropriateness,
      equip_now,
      recipient,
      component_item_ids,
      component_titles,
      replace,
      generate_image,
    } = parsed;

    // Resolve the target character — defaults to the calling character
    let targetCharacterId = context.characterId;
    let recipientName: string | undefined;

    if (recipient) {
      const resolved = await resolveRecipientFromChat(context.chatId, recipient);

      if (!resolved) {
        logger.warn('Wardrobe create recipient not found in chat', {
          context: 'wardrobe-create-handler',
          userId: context.userId,
          chatId: context.chatId,
          recipientName: recipient,
        });
        return {
          success: false,
          item_id: '',
          title: '',
          equipped: false,
          error: `Could not find a character named "${recipient}" in this chat`,
        };
      }

      targetCharacterId = resolved.characterId;
      recipientName = resolved.characterName;
    }

    // Keyed on the *target* character, not the caller: a gift is assembled from
    // what the recipient can reach, and the group tier is per-character.
    const pool = await loadWearablePool(repos, targetCharacterId, undefined, { chatId: context.chatId });
    const components = resolveComponentItems(pool, component_item_ids, component_titles);
    const componentItemIds = components.map((c) => c.id);

    if (componentItemIds.length === 0 && (types?.length ?? 0) === 0) {
      throw new WardrobeCreateError('A wardrobe item must cover at least one slot', 'VALIDATION_ERROR');
    }

    const location = await resolveWardrobeLocation('character', targetCharacterId, repos, context.userId);
    if (!location) {
      throw new WardrobeCreateError('That character has no wardrobe to hang this in', 'NOT_FOUND');
    }

    const newItem = await createItem(
      location,
      {
        title,
        description,
        imagePrompt: image_prompt,
        types: (types as WardrobeItemType[] | undefined) ?? [],
        componentItemIds,
        appropriateness,
        isDefault: false,
        replace: replace ?? false,
      },
      { lookup: pool.byId },
    );
    const isComposite = itemIsComposite(newItem);
    const resolvedTypes = newItem.types;

    let equipped = false;
    let effect: 'layered' | 'replaced' | undefined;
    let currentState: EquippedSlots | undefined;

    if (equip_now) {
      // The pool predates the item; wear it against a lookup that knows it.
      const withNew = { ...pool, byId: new Map([...pool.byId, [newItem.id, { ...newItem, origin: location.origin }]]) };
      const outcome = await wearItem(
        repos,
        context.chatId,
        withNew,
        { ...newItem, origin: location.origin },
        'wear',
        undefined,
        'tool',
      );
      equipped = true;
      effect = outcome.effect;

      // Read through the repository so the stored bag is normalized to all
      // five slots — a chat row written before a slot existed omits its key.
      currentState =
        (await repos.chats.getEquippedOutfitForCharacter(context.chatId, targetCharacterId)) ??
        makeEmptyEquippedSlots();

      await notifyWardrobeChanged(
        repos,
        {
          userId: context.userId,
          chatId: context.chatId,
          characterId: targetCharacterId,
          pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
        },
        'wardrobe-create-handler',
      );
    }

    // A new garment is drawn by default when the operator allows tool pictures.
    const imageGeneration = await maybeQueueWardrobeToolImage(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: targetCharacterId,
      itemId: newItem.id,
      requested: generate_image,
      defaultWhenEnabled: true,
      callerContext: 'wardrobe-create-handler',
    });

    logger.info('Wardrobe create completed', {
      context: 'wardrobe-create-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      targetCharacterId,
      recipientName,
      itemId: newItem.id,
      title: newItem.title,
      isComposite,
      componentCount: componentItemIds.length,
      equipped,
      effect,
      imageGeneration: imageGeneration?.status,
    });

    return {
      success: true,
      item_id: newItem.id,
      title: newItem.title,
      equipped,
      ...(effect
        ? {
            effect,
            effect_summary: describeWardrobeEffect(effect, resolvedTypes, newItem.title),
          }
        : {}),
      is_composite: isComposite,
      resolved_types: resolvedTypes,
      ...(componentItemIds.length > 0 ? { resolved_component_item_ids: componentItemIds } : {}),
      ...(recipientName ? { recipient_name: recipientName } : {}),
      ...(currentState ? { current_state: currentState } : {}),
      ...(imageGeneration ? { image_generation: imageGeneration } : {}),
    };
  } catch (error) {
    if (error instanceof WardrobeCreateError) {
      logger.warn('Wardrobe create error', {
        context: 'wardrobe-create-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        code: error.code,
        message: error.message,
      });
      return {
        success: false,
        item_id: '',
        title: '',
        equipped: false,
        error: error.message,
      };
    }

    logger.error('Wardrobe create tool execution failed', {
      context: 'wardrobe-create-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      item_id: '',
      title: '',
      equipped: false,
      error: error instanceof Error ? error.message : 'Unknown error during wardrobe item creation',
    };
  }
}

/**
 * Format wardrobe create results for inclusion in conversation context
 */
export function formatWardrobeCreateResults(output: WardrobeCreateToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const recipientNote = output.recipient_name ? ` for ${output.recipient_name}` : '';

  const kindLabel = output.is_composite ? 'composite outfit' : 'wardrobe item';
  const parts: string[] = [`Created ${kindLabel} "${output.title}" (${output.item_id})${recipientNote}`];

  if (output.is_composite && output.resolved_component_item_ids?.length) {
    parts.push(
      `- Bundles ${output.resolved_component_item_ids.length} item${output.resolved_component_item_ids.length === 1 ? '' : 's'}; covers ${(output.resolved_types ?? []).join(', ')}`,
    );
  }

  if (output.equipped) {
    parts.push(`- Equipped immediately${recipientNote ? ` on ${output.recipient_name}` : ''}`);

    if (output.current_state) {
      const slotSummary = formatEquippedSlotLines(output.current_state).join('\n');
      parts.push(`- Current outfit:\n${slotSummary}`);
    }
  } else {
    parts.push(`- Not equipped (added to wardrobe${recipientNote ? ` of ${output.recipient_name}` : ''} only)`);
  }

  const imageLine = formatWardrobeToolImageLine(output.image_generation);
  if (imageLine) parts.push(imageLine);

  return parts.join('\n');
}
