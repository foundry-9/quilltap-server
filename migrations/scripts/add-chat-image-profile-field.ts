/**
 * Migration: Add Image Profile Field to Chats
 *
 * This migration adds imageProfileId to the chats table, moving it from
 * per-participant level to chat level. Each chat now has a single image
 * profile (or none) shared by all participants.
 *
 * The migration:
 * 1. Adds imageProfileId column to chats table
 * 2. Populates it from the first participant's imageProfileId (if any)
 *
 * Migration ID: add-chat-image-profile-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';

/**
 * Add Chat Image Profile Field Migration
 */
export const addChatImageProfileFieldMigration: Migration = {
  id: 'add-chat-image-profile-field-v1',
  description: 'Add imageProfileId field to chats table (move from per-participant to per-chat)',
  introducedInVersion: '2.12.0',
  dependsOn: ['sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if chats table exists and is missing the imageProfileId column
    if (!sqliteTableExists('chats')) {
      return false;
    }

    const columns = getSQLiteTableColumns('chats');
    const columnNames = columns.map((col) => col.name);

    return !columnNames.includes('imageProfileId');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let chatsUpdated = 0;

    try {
      const db = getSQLiteDatabase();

      // Add imageProfileId column to chats table
      db.exec(`ALTER TABLE "chats" ADD COLUMN "imageProfileId" TEXT DEFAULT NULL`);
      logger.info('Added imageProfileId column to chats table', {
        context: 'migration.add-chat-image-profile-field',
      });

      // Populate imageProfileId from first participant's imageProfileId
      // We need to parse the participants JSON and find the first one with an imageProfileId
      const chats = db
        .prepare('SELECT id, participants FROM chats WHERE participants IS NOT NULL')
        .all() as Array<{ id: string; participants: string }>;

      for (const chat of chats) {
        try {
          const participants = JSON.parse(chat.participants);
          if (!Array.isArray(participants)) continue;

          // Find the first participant with an imageProfileId
          const participantWithImage = participants.find(
            (p: { imageProfileId?: string | null }) => p.imageProfileId
          );

          if (participantWithImage?.imageProfileId) {
            db.prepare('UPDATE chats SET imageProfileId = ? WHERE id = ?').run(
              participantWithImage.imageProfileId,
              chat.id
            );
            chatsUpdated++;
          }
        } catch (parseError) {
          logger.warn('Failed to parse participants for chat, skipping', {
            context: 'migration.add-chat-image-profile-field',
            chatId: chat.id,
            error: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('Added imageProfileId field to chats table and populated from participants', {
        context: 'migration.add-chat-image-profile-field',
        chatsUpdated,
        durationMs,
      });

      return {
        id: 'add-chat-image-profile-field-v1',
        success: true,
        itemsAffected: chatsUpdated,
        message: `Added imageProfileId column and populated ${chatsUpdated} chat(s) from participant data`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to add imageProfileId field to chats', {
        context: 'migration.add-chat-image-profile-field',
        error: errorMessage,
      });

      return {
        id: 'add-chat-image-profile-field-v1',
        success: false,
        itemsAffected: chatsUpdated,
        message: 'Failed to add imageProfileId field to chats',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
