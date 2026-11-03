/**
 * Migration: Add Established Fact Field
 *
 * Adds `chat_messages.isEstablishedFact` (INTEGER 0/1, NULL). Set only on an
 * operator's USER row posted as established fact (the Salon's "Deus Ex
 * Machina"); NULL everywhere else. The frame a model reads is applied at read
 * time by `lib/chat/established-fact.ts` and is never stored.
 *
 * No backfill: no existing message was posted as fact.
 * Design of record: docs/developer/features/deus-ex-machina.md.
 *
 * Migration ID: add-established-fact-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-established-fact-field-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addEstablishedFactFieldMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add isEstablishedFact column to chat_messages (operator lines posted as established fact)',
  introducedInVersion: '4.12.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chat_messages')) return false;
    return !sqliteColumnExists('chat_messages', 'isEstablishedFact');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('chat_messages', 'isEstablishedFact', 'INTEGER DEFAULT NULL');
      if (added) {
        logger.info('Added chat_messages.isEstablishedFact column', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: added ? 'Added isEstablishedFact column to chat_messages' : 'isEstablishedFact column already present',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add isEstablishedFact column', { context: LOG_CONTEXT, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add isEstablishedFact column',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
