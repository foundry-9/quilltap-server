/**
 * Create Wardrobe Item Tool Handler
 *
 * Creates new wardrobe items — leaf or composite — and optionally equips
 * them immediately. Supports gifting items to other characters in the chat
 * via the optional `recipient` parameter.
 *
 * Composite items are built by supplying `component_item_ids` and/or
 * `component_titles`. The handler resolves both, dedupes, computes the
 * `types` union from the components' types (overriding any LLM-supplied
 * `types`), and persists the new item with the resolved `componentItemIds`.
 * Cycles are rejected by `WardrobeRepository.create` before the row lands.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  WardrobeCreateItemToolInput,
  WardrobeCreateItemToolOutput,
} from '../wardrobe-create-item-tool';
import { validateWardrobeCreateItemInput } from '../wardrobe-create-item-tool';
import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types';
import { equipItem } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';

export interface WardrobeCreateItemToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export class WardrobeCreateItemError extends Error {
  constructor(message: string, public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND') {
    super(message);
    this.name = 'WardrobeCreateItemError';
  }
}

/**
 * Resolve a recipient character ID from a name string by searching chat participants.
 * Returns { characterId, characterName } or null if not found.
 */
async function resolveRecipientFromChat(
  chatId: string,
  recipientName: string,
  _callingCharacterId: string,
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
 * Resolve component item references (IDs and/or titles) for a given character
 * into a deduplicated, ordered list of wardrobe items. ID matches are
 * preferred over title matches; unknown references throw.
 */
async function resolveComponentItems(
  characterId: string,
  componentIds: string[] | undefined,
  componentTitles: string[] | undefined,
): Promise<WardrobeItem[]> {
  const ids = componentIds ?? [];
  const titles = componentTitles ?? [];
  if (ids.length === 0 && titles.length === 0) return [];

  const repos = getRepositories();
  const charItems = await repos.wardrobe.findByCharacterId(characterId, true);
  const itemsById = new Map(charItems.map((i) => [i.id, i]));
  const itemsByTitle = new Map<string, WardrobeItem>();
  for (const i of charItems) {
    const key = i.title.trim().toLowerCase();
    if (!itemsByTitle.has(key)) itemsByTitle.set(key, i);
  }

  const seen = new Set<string>();
  const resolved: WardrobeItem[] = [];

  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) {
      // Try archetype lookup (characterId === null) for the id, since shared
      // items aren't in findByCharacterId.
      const archetype = await repos.wardrobe.findById(id);
      if (archetype && archetype.characterId == null) {
        if (!seen.has(archetype.id)) {
          seen.add(archetype.id);
          resolved.push(archetype);
        }
        continue;
      }
      throw new WardrobeCreateItemError(
        `Component item with ID "${id}" was not found in this character's wardrobe`,
        'NOT_FOUND',
      );
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      resolved.push(item);
    }
  }

  for (const title of titles) {
    const item = itemsByTitle.get(title.trim().toLowerCase());
    if (!item) {
      throw new WardrobeCreateItemError(
        `Component item titled "${title}" was not found in this character's wardrobe`,
        'NOT_FOUND',
      );
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      resolved.push(item);
    }
  }

  return resolved;
}

/**
 * Compute the union of slot types across a list of components, in canonical
 * slot order. Used to derive a composite item's `types` from its components.
 */
function unionTypes(components: readonly WardrobeItem[]): WardrobeItemType[] {
  const set = new Set<WardrobeItemType>();
  for (const c of components) {
    for (const t of c.types) set.add(t);
  }
  return WARDROBE_SLOT_TYPES.filter((s) => set.has(s));
}

/**
 * Execute the create wardrobe item tool
 */
export async function executeWardrobeCreateItemTool(
  input: unknown,
  context: WardrobeCreateItemToolContext
): Promise<WardrobeCreateItemToolOutput> {
  const repos = getRepositories();

  try {
    if (!validateWardrobeCreateItemInput(input)) {
      logger.warn('Wardrobe create item tool validation failed', {
        context: 'wardrobe-create-item-handler',
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
      types,
      appropriateness,
      equip_now,
      recipient,
      component_item_ids,
      component_titles,
    } = input;

    // Resolve the target character — defaults to the calling character
    let targetCharacterId = context.characterId;
    let recipientName: string | undefined;

    if (recipient) {
      const resolved = await resolveRecipientFromChat(
        context.chatId,
        recipient,
        context.characterId,
      );

      if (!resolved) {
        logger.warn('Wardrobe create item recipient not found in chat', {
          context: 'wardrobe-create-item-handler',
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

      logger.debug('Resolved gift recipient', {
        context: 'wardrobe-create-item-handler',
        recipientName: resolved.characterName,
        recipientCharacterId: resolved.characterId,
        callingCharacterId: context.characterId,
      });
    }

    // Resolve components against the target character's wardrobe so a gifted
    // composite references items in the recipient's collection. If components
    // are supplied, the new item is a composite; types is computed from the
    // union and overrides any LLM-supplied `types`.
    const components = await resolveComponentItems(
      targetCharacterId,
      component_item_ids,
      component_titles,
    );

    const isComposite = components.length > 0;
    let resolvedTypes: WardrobeItemType[];
    if (isComposite) {
      resolvedTypes = unionTypes(components);
      if (resolvedTypes.length === 0) {
        // Defensive: components should always cover at least one slot.
        throw new WardrobeCreateItemError(
          'Composite components do not cover any slots — this should not happen',
          'VALIDATION_ERROR',
        );
      }
      if (types && types.length > 0) {
        const provided = (types as WardrobeItemType[]).slice().sort().join(',');
        const computed = resolvedTypes.slice().sort().join(',');
        if (provided !== computed) {
          logger.debug('Composite types overridden by component union', {
            context: 'wardrobe-create-item-handler',
            providedTypes: types,
            computedTypes: resolvedTypes,
            componentCount: components.length,
          });
        }
      }
    } else {
      resolvedTypes = (types as WardrobeItemType[]) ?? [];
    }

    const componentItemIds = components.map((c) => c.id);

    logger.debug('Creating wardrobe item', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      targetCharacterId,
      recipientName,
      title,
      types: resolvedTypes,
      isComposite,
      componentItemIds,
      equipNow: equip_now,
    });

    // Cycle detection lives in the repository — if an LLM somehow contrived a
    // cycle by composing items that already point back to the new item's
    // (pre-existing) parents, the create will throw with a descriptive message.
    const newItem = await repos.wardrobe.create({
      characterId: targetCharacterId,
      title,
      description: description || null,
      types: resolvedTypes,
      componentItemIds,
      appropriateness: appropriateness || null,
      isDefault: false,
    });

    logger.debug('Wardrobe item created', {
      context: 'wardrobe-create-item-handler',
      userId: context.userId,
      targetCharacterId,
      recipientName,
      itemId: newItem.id,
      title: newItem.title,
      isComposite,
    });

    let equipped = false;
    let currentState: EquippedSlots | undefined;

    if (equip_now) {
      logger.debug('Equipping new wardrobe item', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        targetCharacterId,
        itemId: newItem.id,
        slots: newItem.types,
        isComposite,
      });

      // For both leaf and composite items, `equipItem` replaces every slot in
      // `newItem.types` with `[newItem.id]`. Composites are stored as their
      // own id; expansion to leaf garments happens at read time.
      await equipItem(repos, context.chatId, targetCharacterId, newItem);

      equipped = true;

      const chat = await repos.chats.findById(context.chatId);
      if (chat) {
        const equippedOutfit = (chat as Record<string, unknown>).equippedOutfit as Record<string, EquippedSlots> | undefined;
        currentState = equippedOutfit?.[targetCharacterId] || { ...EMPTY_EQUIPPED_SLOTS };
      }

      logger.debug('Wardrobe item equipped', {
        context: 'wardrobe-create-item-handler',
        userId: context.userId,
        chatId: context.chatId,
        targetCharacterId,
        itemId: newItem.id,
        currentState,
      });

      await triggerAvatarGenerationIfEnabled(repos, {
        userId: context.userId,
        chatId: context.chatId,
        characterId: targetCharacterId,
        callerContext: 'wardrobe-create-item-handler',
      });
    }

    logger.info('Wardrobe create item completed', {
      context: 'wardrobe-create-item-handler',
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
    });

    return {
      success: true,
      item_id: newItem.id,
      title: newItem.title,
      equipped,
      is_composite: isComposite,
      resolved_types: resolvedTypes,
      ...(componentItemIds.length > 0 ? { resolved_component_item_ids: componentItemIds } : {}),
      ...(recipientName ? { recipient_name: recipientName } : {}),
      ...(currentState ? { current_state: currentState } : {}),
    };
  } catch (error) {
    if (error instanceof WardrobeCreateItemError) {
      logger.warn('Wardrobe create item error', {
        context: 'wardrobe-create-item-handler',
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

    logger.error('Wardrobe create item tool execution failed', {
      context: 'wardrobe-create-item-handler',
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
 * Format wardrobe create item results for inclusion in conversation context
 */
export function formatWardrobeCreateItemResults(output: WardrobeCreateItemToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const recipientNote = output.recipient_name
    ? ` for ${output.recipient_name}`
    : '';

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
      const slotSummary = WARDROBE_SLOT_TYPES
        .map((slot) => {
          const ids = output.current_state![slot];
          const label = !ids || ids.length === 0 ? '(empty)' : ids.join(', ');
          return `  ${slot}: ${label}`;
        })
        .join('\n');
      parts.push(`- Current outfit:\n${slotSummary}`);
    }
  } else {
    parts.push(`- Not equipped (added to wardrobe${recipientNote ? ` of ${output.recipient_name}` : ''} only)`);
  }

  return parts.join('\n');
}
