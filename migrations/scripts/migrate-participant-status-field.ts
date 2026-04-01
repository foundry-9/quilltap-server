/**
 * Migration: Migrate Participant Status Field
 *
 * Converts the isActive boolean field to a status string field in the participants
 * JSON array stored in the chats table.
 *
 * Status mapping:
 * - isActive=true or undefined → status='active'
 * - isActive=false and removedAt is set → status='removed'
 * - isActive=false and removedAt is null/undefined → status='absent'
 *
 * The isActive field is preserved for backward compatibility with the formula:
 * isActive = (status === 'active' || status === 'silent')
 *
 * Migration ID: migrate-participant-status-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';

export const migrateParticipantStatusFieldMigration: Migration = {
  id: 'migrate-participant-status-field-v1',
  description:
    'Migrate participant isActive boolean to four-state status enum in chat participants',
  introducedInVersion: '2.18.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('chats')) {
      return false;
    }

    try {
      const db = getSQLiteDatabase();

      // Check if any chat has participants without a status field
      const result = db
        .prepare('SELECT participants FROM chats LIMIT 1')
        .get() as { participants: string } | undefined;

      if (!result || !result.participants) {
        return false;
      }

      try {
        const participants = JSON.parse(result.participants);
        if (
          Array.isArray(participants) &&
          participants.length > 0 &&
          participants[0]
        ) {
          // If first participant has status field, migration already ran
          return !('status' in participants[0]);
        }
        return false;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      const db = getSQLiteDatabase();

      // Query all chats with participants
      const chats = db
        .prepare('SELECT id, participants FROM chats')
        .all() as Array<{ id: string; participants: string }>;

      let affectedChats = 0;

      for (const chat of chats) {
        try {
          const participants = JSON.parse(chat.participants);

          if (!Array.isArray(participants)) {
            continue;
          }

          let modified = false;

          const updatedParticipants = participants.map((participant) => {
            if (!participant || typeof participant !== 'object') {
              return participant;
            }

            // If status field already exists, skip
            if ('status' in participant) {
              return participant;
            }

            modified = true;

            const isActive = participant.isActive;
            const removedAt = participant.removedAt;

            // Determine status based on isActive and removedAt
            let status: string;
            if (isActive === true || isActive === undefined) {
              status = 'active';
            } else if (isActive === false && removedAt) {
              status = 'removed';
            } else {
              status = 'absent';
            }

            // Update the participant with status field
            // Preserve isActive for backward compatibility
            return {
              ...participant,
              status,
              isActive: status === 'active' || status === 'silent',
            };
          });

          if (modified) {
            db.prepare('UPDATE chats SET participants = ? WHERE id = ?').run(
              JSON.stringify(updatedParticipants),
              chat.id
            );
            affectedChats++;
          }
        } catch (error) {
          logger.warn('Failed to migrate participants for chat', {
            context: 'migration.migrate-participant-status-field',
            chatId: chat.id,
            error:
              error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Migrated participant status fields in chats', {
        context: 'migration.migrate-participant-status-field',
        affectedChats,
      });

      const durationMs = Date.now() - startTime;

      return {
        id: 'migrate-participant-status-field-v1',
        success: true,
        itemsAffected: affectedChats,
        message: `Migrated participant status fields in ${affectedChats} chats`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error('Failed to migrate participant status fields', {
        context: 'migration.migrate-participant-status-field',
        error: errorMessage,
      });

      return {
        id: 'migrate-participant-status-field-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to migrate participant status fields',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
