/**
 * Migration: Add Route Trail Message Column
 *
 * Adds the `routeTrail` column to the chat_messages table. It holds the ordered
 * JSON list of every connection profile tried for one assistant turn, with why
 * each one stepped aside:
 * `[{ profileId, profileName, provider, modelName, via, outcome, trigger?,
 * evidence?, detail? }]`.
 *
 * NULL on every message whose turn had no failure — which is nearly all of
 * them. A one-entry trail would say nothing the `provider`/`modelName` columns
 * already do, and assistant rows are the largest table in the instance.
 *
 * Migration ID: add-route-trail-message-column-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

export const addRouteTrailMessageColumnMigration: Migration = {
  id: 'add-route-trail-message-column-v1',
  description: 'Add routeTrail column to chat_messages table',
  introducedInVersion: '4.10.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chat_messages')) {
      return false;
    }

    return !sqliteColumnExists('chat_messages', 'routeTrail');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      // JSON: the ordered list of profiles tried; NULL when nothing failed
      const added = addColumnIfMissing('chat_messages', 'routeTrail', 'TEXT DEFAULT NULL');

      const durationMs = Date.now() - startTime;

      logger.info('Added routeTrail column to chat_messages table', {
        context: 'migration.add-route-trail-message-column',
        durationMs,
      });

      return {
        id: 'add-route-trail-message-column-v1',
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added routeTrail column to chat_messages table',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add routeTrail field', {
        context: 'migration.add-route-trail-message-column',
        error: errorMessage,
      });

      return {
        id: 'add-route-trail-message-column-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to add routeTrail field',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
