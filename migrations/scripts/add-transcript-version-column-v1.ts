/**
 * Migration: Add Transcript Version Column
 *
 * Adds the `transcriptVersion` column to the chats table — a monotonic counter
 * the message funnel bumps on every add, edit, delete and clear, beside the
 * `publishRealtime('chats', id)` hint an open Salon tab listens for.
 *
 * It is what makes the hint-driven transcript re-read *conditional*: the tab
 * hands back the version it last saw and the server answers "unchanged"
 * without serializing a line of the conversation. A busy turn firing wardrobe,
 * backdrop, whisper and memory hints therefore costs round trips rather than
 * payloads.
 *
 * Existing chats start at `0`, which is correct: the first read from any tab
 * carries no known version and gets the whole transcript, and the first write
 * after this migration moves the counter off zero. No backfill is possible —
 * the counter has no history to reconstruct — or wanted.
 *
 * Migration ID: add-transcript-version-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addTranscriptVersionColumnMigration: Migration = {
  id: 'add-transcript-version-column-v1',
  description: 'Add transcriptVersion column to chats table',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    return !sqliteColumnExists('chats', 'transcriptVersion');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const added = addColumnIfMissing('chats', 'transcriptVersion', 'INTEGER DEFAULT 0');

      const durationMs = Date.now() - startTime;

      logger.info('Added transcriptVersion column to chats table', {
        context: 'migration.add-transcript-version-column',
        durationMs,
      });

      return {
        id: 'add-transcript-version-column-v1',
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added transcriptVersion column to chats table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add transcriptVersion column', {
        context: 'migration.add-transcript-version-column',
        error: errorMessage,
      });

      return {
        id: 'add-transcript-version-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add transcriptVersion column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
