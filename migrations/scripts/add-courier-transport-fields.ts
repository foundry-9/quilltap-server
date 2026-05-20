/**
 * Migration: Add Courier transport fields
 *
 * Adds three columns:
 *  - connection_profiles.transport TEXT NOT NULL DEFAULT 'api'
 *    Existing API-backed profiles keep transport='api'. New 'courier' profiles
 *    route through the manual / clipboard transport rather than an LLM API.
 *  - chat_messages.pendingExternalPrompt TEXT DEFAULT NULL
 *    When non-null, the message is a placeholder for a Courier turn awaiting
 *    a pasted reply. Stores the Markdown blob the user must copy out.
 *  - chat_messages.pendingExternalAttachments TEXT DEFAULT NULL
 *    JSON array of attachment descriptors (fileId, filename, mimeType, sizeBytes,
 *    downloadUrl) for files referenced by the pending prompt — surfaced as
 *    download links in the Salon so the user can re-upload them in their
 *    destination client.
 *
 * Migration ID: add-courier-transport-fields-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

export const addCourierTransportFieldsMigration: Migration = {
  id: 'add-courier-transport-fields-v1',
  description: 'Add Courier transport column to connection_profiles and pending-turn columns to chat_messages',
  introducedInVersion: '4.5.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('connection_profiles') || !sqliteTableExists('chat_messages')) {
      return false;
    }

    const profileCols = getSQLiteTableColumns('connection_profiles').map((c) => c.name);
    const messageCols = getSQLiteTableColumns('chat_messages').map((c) => c.name);

    return (
      !profileCols.includes('transport') ||
      !messageCols.includes('pendingExternalPrompt') ||
      !messageCols.includes('pendingExternalAttachments')
    );
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      const profileCols = getSQLiteTableColumns('connection_profiles').map((c) => c.name);
      if (!profileCols.includes('transport')) {
        db.exec(`ALTER TABLE "connection_profiles" ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'api'`);
      }

      const messageCols = getSQLiteTableColumns('chat_messages').map((c) => c.name);
      if (!messageCols.includes('pendingExternalPrompt')) {
        db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "pendingExternalPrompt" TEXT DEFAULT NULL`);
      }
      if (!messageCols.includes('pendingExternalAttachments')) {
        db.exec(`ALTER TABLE "chat_messages" ADD COLUMN "pendingExternalAttachments" TEXT DEFAULT NULL`);
      }

      logger.info('Added Courier transport columns', {
        context: 'migration.add-courier-transport-fields',
      });

      return {
        id: 'add-courier-transport-fields-v1',
        success: true,
        itemsAffected: 3,
        message: 'Added transport + pending external turn columns',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add Courier transport columns', {
        context: 'migration.add-courier-transport-fields',
        error: errorMessage,
      });

      return {
        id: 'add-courier-transport-fields-v1',
        success: false,
        itemsAffected: 0,
        message: `Failed to add Courier transport columns: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
