/**
 * Migration: Add Chat Avatar Timeline Table
 *
 * Creates `chat_avatar_timeline`: per (chat × character) the dated avatars the
 * chat has bound, so each Salon bubble shows the character as they looked when
 * they spoke. No rows are seeded — chats that predate the table keep showing
 * what they show now, and start a timeline the next time an avatar is bound.
 * See docs/developer/features/complete/salon-avatar-timeline.md.
 *
 * The DDL is shared with the repository tests through
 * `lib/database/backends/sqlite/chat-avatar-timeline-ddl.ts`.
 *
 * Migration ID: add-chat-avatar-timeline-table-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import {
  CHAT_AVATAR_TIMELINE_DDL,
  CHAT_AVATAR_TIMELINE_TABLE,
} from '@/lib/database/backends/sqlite/chat-avatar-timeline-ddl';

const MIGRATION_ID = 'add-chat-avatar-timeline-table-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addChatAvatarTimelineTableMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Create chat_avatar_timeline table: the avatars each chat bound per character, dated',
  introducedInVersion: '4.13.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    return !sqliteTableExists(CHAT_AVATAR_TIMELINE_TABLE);
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();
      for (const statement of CHAT_AVATAR_TIMELINE_DDL) {
        db.exec(statement);
      }

      logger.info('Created chat_avatar_timeline table', { context: LOG_CONTEXT });

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: 1,
        message: 'Created chat_avatar_timeline table',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create chat_avatar_timeline table', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to create chat_avatar_timeline table',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
