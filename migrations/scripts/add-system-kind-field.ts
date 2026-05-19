/**
 * Migration: Add System Kind Field
 *
 * Adds the systemKind column to chat_messages. This column carries a
 * sub-classification of a Staff-authored message (e.g. 'timestamp',
 * 'project-context', 'memory-recap') so the Salon UI can label collapsed
 * system-message bars without having to inspect content.
 *
 * Migration ID: add-system-kind-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addSystemKindFieldMigration: Migration = {
  id: 'add-system-kind-field-v1',
  description: 'Add systemKind column to chat_messages for Staff-message sub-classification',
  introducedInVersion: '4.4.0',
  dependsOn: ['add-system-sender-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chat_messages');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('systemKind');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "systemKind" TEXT DEFAULT NULL`);

      logger.info('Added systemKind column to chat_messages table', {
        context: 'migration.add-system-kind-field',
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'add-system-kind-field-v1',
        success: true,
        itemsAffected: 1,
        message: 'Added systemKind column to chat_messages',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add systemKind column', {
        context: 'migration.add-system-kind-field',
        error: errorMessage,
      });

      return {
        id: 'add-system-kind-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add systemKind column',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
