/**
 * Wardrobe Rollback Tool Handler
 *
 * `loadToolPool` → `rollbackWardrobe` (`lib/wardrobe/history/rollback.ts`, the
 * one rollback implementation) → the shared `current_state` /
 * `coverage_summary` assembly. The rollback fires the outfit-change effects
 * itself, with a cursor intent, so the turn's containers ride the context.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { rollbackWardrobe } from '@/lib/wardrobe/history/rollback';
import {
  validateWardrobeRollbackInput,
  type WardrobeRollbackToolOutput,
} from '../wardrobe-rollback-tool';
import {
  buildWardrobeCoverageSummaryFromState,
  formatEquippedSlotLines,
  loadCurrentWardrobeState,
  loadToolPool,
  type WardrobeToolContext,
} from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeRollbackToolContext = WardrobeToolContext;

const CONTEXT = 'wardrobe-rollback-handler';

export async function executeWardrobeRollbackTool(
  input: unknown,
  context: WardrobeRollbackToolContext,
): Promise<WardrobeRollbackToolOutput> {
  const parsed = validateWardrobeRollbackInput(input);
  if (!parsed) {
    logger.warn('Wardrobe rollback tool validation failed', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
      input,
    });
    return { success: false, error: 'Invalid input: "index" must be a whole number of 0 or more, or omitted.' };
  }
  if (!context.characterId) {
    return { success: false, error: 'wardrobe_rollback needs a character to dress.' };
  }

  const repos = getRepositories();
  try {
    const pool = await loadToolPool(repos, context.chatId, context.characterId);
    const outcome = await rollbackWardrobe(
      repos,
      { chatId: context.chatId, pool, index: parsed.index, context, source: 'tool' },
      CONTEXT,
    );
    if (!outcome.ok) {
      logger.info('Wardrobe rollback refused', {
        context: CONTEXT,
        chatId: context.chatId,
        characterId: context.characterId,
        reason: outcome.reason,
      });
      return { success: false, error: outcome.message };
    }

    const currentState = await loadCurrentWardrobeState(repos, context.chatId, context.characterId);
    return {
      success: true,
      previous_index: outcome.previousIndex,
      restored_index: outcome.restoredIndex,
      current_state: currentState,
      coverage_summary: buildWardrobeCoverageSummaryFromState(pool, currentState),
      skipped: outcome.skipped.map((item) => ({ item_id: item.itemId, title: item.title, reason: item.reason })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Wardrobe rollback failed', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
      error: message,
    });
    return { success: false, error: `Could not return to that outfit: ${message}` };
  }
}

/** Format rollback results for the conversation. */
export function formatWardrobeRollbackResults(output: WardrobeRollbackToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  const lines = [`Returned to outfit ${output.restored_index} (from ${output.previous_index}).`];
  for (const item of output.skipped ?? []) {
    const name = item.title ? `the ${item.title}` : `item ${item.item_id}`;
    lines.push(
      item.reason === 'archived'
        ? `${name} could not be put back on: it has been archived.`
        : `${name} could not be put back on: it no longer exists.`,
    );
  }
  if (output.current_state) {
    lines.push('');
    lines.push('Current outfit:');
    lines.push(...formatEquippedSlotLines(output.current_state));
  }
  lines.push('');
  lines.push(`Now wearing: ${output.coverage_summary ?? ''}`);
  return lines.join('\n');
}
