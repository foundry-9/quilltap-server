/**
 * Migration: Add Chat Equipped Inventory Column
 *
 * Adds `chats.equippedInventory` (TEXT, default NULL): JSON
 * `{ [characterId]: string[] }` of the Inventory objects each character
 * carries in the chat. Written only by `ChatsRepository.setEquippedInventory`
 * (a patch-only column). No backfill: a chat that predates the Inventory
 * carries nothing until the operator picks something up or uses *Reset to
 * defaults* — arrival defaults apply only when a character arrives.
 *
 * Migration ID: add-chat-equipped-inventory-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  sqliteTableExists,
  sqliteColumnExists,
  addColumnIfMissing,
} from '../lib/database-utils';

const MIGRATION_ID = 'add-chat-equipped-inventory-v1';
const LOG_CONTEXT = `migration.${MIGRATION_ID}`;

export const addChatEquippedInventoryMigration: Migration = {
  id: MIGRATION_ID,
  description: 'Add equippedInventory to chats (the Inventory objects each character carries)',
  introducedInVersion: '4.11.0',
  dependsOn: ['add-equipped-outfit-field-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('chats')) return false;
    return !sqliteColumnExists('chats', 'equippedInventory');
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      const added = addColumnIfMissing('chats', 'equippedInventory', 'TEXT DEFAULT NULL');
      if (added) {
        logger.info('Added equippedInventory column to chats', { context: LOG_CONTEXT });
      }
      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: added ? 1 : 0,
        message: 'Added equippedInventory column to chats',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to add equippedInventory column to chats', {
        context: LOG_CONTEXT,
        error: errorMessage,
      });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: 0,
        message: 'Failed to add equippedInventory column to chats',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
