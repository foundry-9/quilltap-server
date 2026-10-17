/**
 * Wardrobe History Tool Handler
 *
 * Read-only: lists the calling character's outfit timeline in this chat. Fires
 * no effects and touches no turn containers. Inside a model turn the rows come
 * from the job's snapshot, so a change made earlier in the same reply may not
 * be listed yet (the tool's description says so).
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  changedByLabel,
  resolveHistorySlots,
  summarizeHistorySlots,
} from '@/lib/wardrobe/history/describe-entry';
import {
  WARDROBE_HISTORY_DEFAULT_LIMIT,
  validateWardrobeHistoryInput,
  type WardrobeHistoryToolEntry,
  type WardrobeHistoryToolOutput,
} from '../wardrobe-history-tool';
import type { ChatWardrobeHistoryRow } from '@/lib/schemas/chat-wardrobe-history.types';
import { loadToolPool, type WardrobeToolContext } from './wardrobe-handler-shared';

/** Every wardrobe tool runs in the same context (see `WardrobeToolContext`). */
export type WardrobeHistoryToolContext = WardrobeToolContext;

const CONTEXT = 'wardrobe-history-handler';

/**
 * The last `limit` rows, plus the current row prepended when it falls before
 * the window. Pure; exported for tests.
 */
export function windowHistory(
  rows: ChatWardrobeHistoryRow[],
  limit: number,
): { rows: ChatWardrobeHistoryRow[]; gapBeforeWindow: boolean } {
  const window = rows.slice(Math.max(0, rows.length - limit));
  const current = rows.find((row) => row.isCurrent);
  if (current && !window.includes(current)) {
    return { rows: [current, ...window], gapBeforeWindow: true };
  }
  return { rows: window, gapBeforeWindow: false };
}

function failure(error: string): WardrobeHistoryToolOutput {
  return { success: false, current_index: null, total: 0, entries: [], error };
}

export async function executeWardrobeHistoryTool(
  input: unknown,
  context: WardrobeHistoryToolContext,
): Promise<WardrobeHistoryToolOutput> {
  const parsed = validateWardrobeHistoryInput(input);
  if (!parsed) {
    return failure('Invalid input: "limit" must be a whole number from 1 to 100, or omitted.');
  }
  if (!context.characterId) {
    return failure('wardrobe_history needs a character.');
  }

  const repos = getRepositories();
  try {
    const rows = await repos.wardrobeHistory.findEntries(context.chatId, context.characterId);
    if (rows.length === 0) {
      return { success: true, current_index: null, total: 0, entries: [] };
    }

    const pool = await loadToolPool(repos, context.chatId, context.characterId);
    const { rows: shown, gapBeforeWindow } = windowHistory(rows, parsed.limit ?? WARDROBE_HISTORY_DEFAULT_LIMIT);

    const actorNames = new Map<string, string | null>();
    for (const row of shown) {
      const actor = row.actorCharacterId;
      if (!actor || actor === context.characterId || actorNames.has(actor)) continue;
      try {
        actorNames.set(actor, (await repos.characters.findByIdRaw(actor))?.name ?? null);
      } catch {
        actorNames.set(actor, null);
      }
    }

    const entries: WardrobeHistoryToolEntry[] = shown.map((row) => ({
      index: row.entryIndex,
      at: row.createdAt,
      source: row.source,
      changed_by: changedByLabel(row, row.actorCharacterId ? actorNames.get(row.actorCharacterId) ?? null : null, 'you'),
      is_current: row.isCurrent,
      summary: summarizeHistorySlots(resolveHistorySlots(pool, row.slots)),
    }));

    logger.debug('Listed wardrobe history', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
      total: rows.length,
      shown: entries.length,
    });

    return {
      success: true,
      current_index: rows.find((row) => row.isCurrent)?.entryIndex ?? null,
      total: rows.length,
      entries,
      ...(gapBeforeWindow ? { gap_before_window: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Wardrobe history read failed', {
      context: CONTEXT,
      chatId: context.chatId,
      characterId: context.characterId,
      error: message,
    });
    return failure(`Could not read the outfit record: ${message}`);
  }
}

/** Format history results for the conversation. */
export function formatWardrobeHistoryResults(output: WardrobeHistoryToolOutput): string {
  if (!output.success) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }
  if (output.total === 0) {
    return 'No outfits recorded yet in this chat. The first change of clothes starts the record.';
  }
  const lines = [`Outfits in this chat: ${output.total} (numbered 0 to ${output.total - 1}). Wearing now: ${output.current_index}.`];
  output.entries.forEach((entry, i) => {
    if (i === 1 && output.gap_before_window) lines.push('  …');
    const marker = entry.is_current ? ' ← wearing now' : '';
    lines.push(`  ${entry.index}. ${entry.at} — ${entry.changed_by}: ${entry.summary}${marker}`);
  });
  return lines.join('\n');
}
