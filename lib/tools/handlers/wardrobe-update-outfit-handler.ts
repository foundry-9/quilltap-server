/**
 * Set Outfit Tool Handler (composite items only)
 *
 * Two modes:
 *   - `wear`   → `equipItem(composite)` — replaces each slot in the
 *                composite's `types` with `[composite.id]`.
 *   - `remove` → for each slot in the composite's `types`,
 *                `removeFromSlot(slot, composite.id)`.
 *
 * Leaf wardrobe items (`componentItemIds` empty) are rejected with a
 * pointer to `wardrobe_change_item`.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeUpdateOutfitToolInput, WardrobeUpdateOutfitToolOutput } from '../wardrobe-update-outfit-tool';
import { validateWardrobeUpdateOutfitInput } from '../wardrobe-update-outfit-tool';
import { EMPTY_EQUIPPED_SLOTS, buildCoverageSummary, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { equipItem, removeFromSlot } from '@/lib/wardrobe/outfit-displacement';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';

export interface WardrobeUpdateOutfitToolContext {
  userId: string;
  chatId: string;
  characterId: string;
}

export class WardrobeUpdateOutfitError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'NOT_COMPOSITE',
  ) {
    super(message);
    this.name = 'WardrobeUpdateOutfitError';
  }
}

function emptyState(): EquippedSlots {
  return { top: [], bottom: [], footwear: [], accessories: [] };
}

function buildFailureResponse(error: string): WardrobeUpdateOutfitToolOutput {
  return {
    success: false,
    action: 'removed',
    item: null,
    slots_affected: [],
    current_state: emptyState(),
    coverage_summary: '',
    error,
  };
}

/**
 * Look up a wardrobe item by id (preferred) or title (fallback). Uses the
 * overlay-aware lookup so vault-only items resolve.
 */
async function resolveCompositeItem(
  repos: ReturnType<typeof getRepositories>,
  characterId: string,
  itemId: string | undefined,
  itemTitle: string | undefined,
): Promise<WardrobeItem | null> {
  if (itemId) {
    const found = await repos.wardrobe.findByIdForCharacter(characterId, itemId);
    logger.debug('Composite lookup by ID', {
      context: 'wardrobe-update-outfit-handler',
      itemId,
      found: !!found,
    });
    if (found) return found;
  }

  if (itemTitle) {
    const characterItems = await repos.wardrobe.findByCharacterId(characterId);
    const lower = itemTitle.toLowerCase();
    const found = characterItems.find((i) => i.title.toLowerCase() === lower) ?? null;
    logger.debug('Composite lookup by title', {
      context: 'wardrobe-update-outfit-handler',
      characterId,
      itemTitle,
      found: !!found,
      candidateCount: characterItems.length,
    });
    return found;
  }

  return null;
}

export async function executeWardrobeUpdateOutfitTool(
  input: unknown,
  context: WardrobeUpdateOutfitToolContext,
): Promise<WardrobeUpdateOutfitToolOutput> {
  const repos = getRepositories();

  try {
    if (!validateWardrobeUpdateOutfitInput(input)) {
      logger.warn('Wardrobe set outfit tool validation failed', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        input,
      });
      return buildFailureResponse(
        'Invalid input: mode must be "wear" or "remove", and either item_id or item_title is required.',
      );
    }

    const { mode, item_id, item_title } = input;

    logger.debug('Dispatching wardrobe_set_outfit', {
      context: 'wardrobe-update-outfit-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      mode,
      itemId: item_id,
      itemTitle: item_title,
    });

    const item = await resolveCompositeItem(repos, context.characterId, item_id, item_title);
    if (!item) {
      throw new WardrobeUpdateOutfitError(
        `Outfit not found${item_id ? ` with ID "${item_id}"` : ''}${item_title ? ` with title "${item_title}"` : ''}`,
        'NOT_FOUND',
      );
    }

    if (item.archivedAt) {
      throw new WardrobeUpdateOutfitError(
        `Outfit "${item.title}" is archived and cannot be worn`,
        'VALIDATION_ERROR',
      );
    }

    if (!item.componentItemIds || item.componentItemIds.length === 0) {
      throw new WardrobeUpdateOutfitError(
        `"${item.title}" is a single garment, not a composite outfit. ` +
          'Use the wardrobe_change_item tool with mode="equip" to put on a single item.',
        'NOT_COMPOSITE',
      );
    }

    const slotsAffected = item.types.slice();

    if (mode === 'wear') {
      await equipItem(repos, context.chatId, context.characterId, item);
      logger.info('Composite outfit worn', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        slotsAffected,
      });
    } else {
      // mode === 'remove'
      // Filter the composite's id out of every slot it covered. Layered items
      // (other ids in those slots) stay.
      for (const slot of slotsAffected) {
        await removeFromSlot(repos, context.chatId, context.characterId, slot, item.id);
      }
      logger.info('Composite outfit removed', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        itemId: item.id,
        itemTitle: item.title,
        slotsAffected,
      });
    }

    const currentState = await loadCurrentState(repos, context);
    const coverageSummary = await buildCoverageSummaryFromState(repos, currentState);

    await triggerAvatarGenerationIfEnabled(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      callerContext: 'wardrobe-update-outfit-handler',
    });

    await scheduleAnnouncement(context);

    return {
      success: true,
      action: mode === 'wear' ? 'worn' : 'removed',
      item: { item_id: item.id, title: item.title },
      slots_affected: slotsAffected,
      current_state: currentState,
      coverage_summary: coverageSummary,
    };
  } catch (error) {
    if (error instanceof WardrobeUpdateOutfitError) {
      logger.warn('Wardrobe set outfit error', {
        context: 'wardrobe-update-outfit-handler',
        userId: context.userId,
        chatId: context.chatId,
        characterId: context.characterId,
        code: error.code,
        message: error.message,
      });
      return buildFailureResponse(error.message);
    }

    logger.error('Wardrobe set outfit tool execution failed', {
      context: 'wardrobe-update-outfit-handler',
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined);

    return buildFailureResponse(
      error instanceof Error ? error.message : 'Unknown error during outfit update',
    );
  }
}

async function scheduleAnnouncement(context: WardrobeUpdateOutfitToolContext): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(context.userId, {
      chatId: context.chatId,
      characterId: context.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: 'wardrobe-update-outfit-handler',
      chatId: context.chatId,
      characterId: context.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadCurrentState(
  repos: ReturnType<typeof getRepositories>,
  context: WardrobeUpdateOutfitToolContext,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(
    context.chatId,
    context.characterId,
  );
  return equippedOutfit ?? { ...EMPTY_EQUIPPED_SLOTS };
}

async function buildCoverageSummaryFromState(
  repos: ReturnType<typeof getRepositories>,
  slots: EquippedSlots,
): Promise<string> {
  const allIds = new Set<string>();
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    for (const id of slots[slotKey]) allIds.add(id);
  }

  const itemsById = new Map<string, WardrobeItem>();
  if (allIds.size > 0) {
    const fetched = await repos.wardrobe.findByIds(Array.from(allIds));
    for (const item of fetched) itemsById.set(item.id, item);
  }

  const perSlotItems: Record<keyof EquippedSlots, WardrobeItem[]> = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };

  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const equippedIds = slots[slotKey];
    if (equippedIds.length === 0) continue;

    const { leafIds } = expandComposites(equippedIds, itemsById);
    const seen = new Set<string>();
    for (const leafId of leafIds) {
      if (seen.has(leafId)) continue;
      const leaf = itemsById.get(leafId);
      if (!leaf) continue;
      if (!leaf.types.includes(slotKey)) continue;
      perSlotItems[slotKey].push(leaf);
      seen.add(leafId);
    }
  }

  return buildCoverageSummary(slots, perSlotItems);
}

/**
 * Format outfit set/remove results for inclusion in conversation context
 */
export function formatWardrobeUpdateOutfitResults(output: WardrobeUpdateOutfitToolOutput): string {
  if (!output.success) {
    return `Outfit Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];
  if (output.action === 'worn' && output.item) {
    lines.push(`Wore the "${output.item.title}" outfit (${output.slots_affected.join(', ')}).`);
  } else if (output.action === 'removed' && output.item) {
    lines.push(`Removed the "${output.item.title}" outfit (${output.slots_affected.join(', ')}).`);
  }

  lines.push('');
  lines.push('Current outfit:');
  const state = output.current_state;
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const ids = state[slotKey];
    lines.push(`  ${slotKey}: ${ids.length === 0 ? '(empty)' : ids.join(', ')}`);
  }
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}
