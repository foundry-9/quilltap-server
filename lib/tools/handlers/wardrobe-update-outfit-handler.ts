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
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { equipItem, removeFromSlot } from '@/lib/wardrobe/outfit-displacement';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import {
  buildWardrobeCoverageSummaryFromState,
  emptyEquippedState,
  loadCurrentWardrobeState,
  scheduleWardrobeAnnouncement,
} from './wardrobe-handler-shared';

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
  return emptyEquippedState();
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
    if (found) return found;
  }

  if (itemTitle) {
    const characterItems = await repos.wardrobe.findByCharacterId(characterId);
    const lower = itemTitle.toLowerCase();
    const found = characterItems.find((i) => i.title.toLowerCase() === lower) ?? null;
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

    const currentState = await loadCurrentWardrobeState(repos, context.chatId, context.characterId);
    const coverageSummary = await buildWardrobeCoverageSummaryFromState(repos, currentState);

    await triggerAvatarGenerationIfEnabled(repos, {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
      callerContext: 'wardrobe-update-outfit-handler',
    });

    await scheduleWardrobeAnnouncement('wardrobe-update-outfit-handler', {
      userId: context.userId,
      chatId: context.chatId,
      characterId: context.characterId,
    });

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
