/**
 * Migration: Add the Chat Opening State Columns
 *
 * A chat is cast in one quick request and opened afterwards — dressed, packed,
 * introduced and greeted — by `runOpening` (`lib/chat/opening/run.ts`). Two
 * columns say how far that has got:
 * - openingState (TEXT NOT NULL DEFAULT 'done') — 'pending' | 'running' | 'done'
 * - openingPhase (TEXT, default NULL) — the last opening phase completed
 * - openingPlan (TEXT, default NULL) — what casting asked of the opening (the
 *   operator's outfit choices, a continuation's source chat), as JSON; cleared
 *   when the opening finishes
 *
 * The default makes every existing chat already opened, so no rows are
 * touched; casting writes 'pending' for a new chat. Both columns are
 * patch-only and outside `ChatMetadataSchema` (written only by
 * `ChatsRepository.setOpeningState`), and neither is exported or backed up.
 *
 * Migration ID: add-chat-opening-state-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-chat-opening-state-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addChatOpeningStateMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add chats.openingState, openingPhase and openingPlan (how far a chat\'s opening has got)',
  introducedInVersion: '4.13.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats')) return false;
    return !sqliteColumnExists('chats', 'openingState')
      || !sqliteColumnExists('chats', 'openingPhase')
      || !sqliteColumnExists('chats', 'openingPlan');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let columnsAdded = 0;
    try {
      // Two ALTERs, no loop over rows: the default stands in for every
      // existing chat, so there is no progress to report.
      if (addColumnIfMissing('chats', 'openingState', "TEXT NOT NULL DEFAULT 'done'")) columnsAdded++;
      if (addColumnIfMissing('chats', 'openingPhase', 'TEXT DEFAULT NULL')) columnsAdded++;
      if (addColumnIfMissing('chats', 'openingPlan', 'TEXT DEFAULT NULL')) columnsAdded++;

      const durationMs = Date.now() - startTime;
      logger.info('Added the opening state columns to chats', { context: LOG_CONTEXT, columnsAdded, durationMs });
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: columnsAdded,
        message: `Added ${columnsAdded} opening state column(s) to chats table`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add the opening state columns', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: columnsAdded,
        message: 'Failed to add opening state columns',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
