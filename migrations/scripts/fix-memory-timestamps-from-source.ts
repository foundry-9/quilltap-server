/**
 * Migration: Fix Memory Timestamps from Source Messages
 *
 * Memories extracted from chat messages had their createdAt/updatedAt set to
 * the extraction time rather than the source message time. This migration
 * corrects those timestamps by looking up each memory's sourceMessageId and
 * using the message's createdAt instead.
 *
 * Rules:
 * - If memory createdAt === updatedAt: set both to source message createdAt
 * - If memory createdAt !== updatedAt: set only createdAt to source message createdAt
 *
 * Migration ID: fix-memory-timestamps-from-source-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const fixMemoryTimestampsFromSourceMigration: Migration = {
  id: 'fix-memory-timestamps-from-source-v1',
  description: 'Fix memory createdAt/updatedAt to match source message timestamps',
  introducedInVersion: '4.1.1',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('memories') || !sqliteTableExists('chat_messages')) {
      return false;
    }

    // Always run — idempotent (sets timestamps based on source message)
    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Step 1: Fix memories where createdAt === updatedAt (set both)
      const bothResult = db.prepare(`
        UPDATE "memories"
        SET
          "createdAt" = (
            SELECT m."createdAt"
            FROM "chat_messages" m
            WHERE m."id" = "memories"."sourceMessageId"
          ),
          "updatedAt" = (
            SELECT m."createdAt"
            FROM "chat_messages" m
            WHERE m."id" = "memories"."sourceMessageId"
          )
        WHERE "sourceMessageId" IS NOT NULL
          AND "sourceMessageId" != ''
          AND "createdAt" = "updatedAt"
          AND EXISTS (
            SELECT 1 FROM "chat_messages" m
            WHERE m."id" = "memories"."sourceMessageId"
          )
      `).run();

      const bothFixed = bothResult.changes;

      // Step 2: Fix memories where createdAt !== updatedAt (only set createdAt)
      const createdOnlyResult = db.prepare(`
        UPDATE "memories"
        SET
          "createdAt" = (
            SELECT m."createdAt"
            FROM "chat_messages" m
            WHERE m."id" = "memories"."sourceMessageId"
          )
        WHERE "sourceMessageId" IS NOT NULL
          AND "sourceMessageId" != ''
          AND "createdAt" != "updatedAt"
          AND EXISTS (
            SELECT 1 FROM "chat_messages" m
            WHERE m."id" = "memories"."sourceMessageId"
          )
      `).run();

      const createdOnlyFixed = createdOnlyResult.changes;
      const totalFixed = bothFixed + createdOnlyFixed;

      const durationMs = Date.now() - startTime;

      logger.info('Fixed memory timestamps from source messages', {
        context: 'migration.fix-memory-timestamps-from-source',
        bothFixed,
        createdOnlyFixed,
        totalFixed,
        durationMs,
      });

      return {
        id: 'fix-memory-timestamps-from-source-v1',
        success: true,
        itemsAffected: totalFixed,
        message: `Fixed timestamps on ${totalFixed} memories (${bothFixed} both, ${createdOnlyFixed} createdAt only)`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to fix memory timestamps from source messages', {
        context: 'migration.fix-memory-timestamps-from-source',
        error: errorMessage,
      });

      return {
        id: 'fix-memory-timestamps-from-source-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to fix memory timestamps',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
