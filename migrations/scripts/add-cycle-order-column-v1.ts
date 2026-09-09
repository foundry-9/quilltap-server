/**
 * Migration: Add Cycle Order Column
 *
 * Adds the `cycleOrderParticipantIds` column to the chats table. It holds the
 * rotation drawn for the current cycle — the participants who have yet to speak,
 * in the order they will — as a JSON array of participant IDs.
 *
 * Existing chats start at `'[]'`, which reads as "no rotation on file": the next
 * selection draws one and stores it. No backfill is possible or wanted, since a
 * rotation is only meaningful for a cycle that is currently under way.
 *
 * Migration ID: add-cycle-order-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addCycleOrderColumnMigration: Migration = {
  id: 'add-cycle-order-column-v1',
  description: 'Add cycleOrderParticipantIds column to chats table',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    return !sqliteColumnExists('chats', 'cycleOrderParticipantIds');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      // JSON array of participantIds still to speak this cycle, in order
      const added = addColumnIfMissing('chats', 'cycleOrderParticipantIds', "TEXT DEFAULT '[]'");

      const durationMs = Date.now() - startTime;

      logger.info('Added cycleOrderParticipantIds column to chats table', {
        context: 'migration.add-cycle-order-column',
        durationMs,
      });

      return {
        id: 'add-cycle-order-column-v1',
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added cycleOrderParticipantIds column to chats table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add cycleOrderParticipantIds field', {
        context: 'migration.add-cycle-order-column',
        error: errorMessage,
      });

      return {
        id: 'add-cycle-order-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add cycleOrderParticipantIds field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
