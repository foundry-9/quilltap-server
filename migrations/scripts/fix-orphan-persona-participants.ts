/**
 * Migration: Fix Orphan PERSONA Participants
 *
 * This migration fixes chats that have orphaned PERSONA participants.
 *
 * SQLite only - this is handled by data validation.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: fix-orphan-persona-participants-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Fix Orphan PERSONA Participants Migration
 */
export const fixOrphanPersonaParticipantsMigration: Migration = {
  id: 'fix-orphan-persona-participants-v1',
  description: 'Fix orphaned PERSONA participants in chats (SQLite only - no-op)',
  introducedInVersion: '2.7.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Fix orphan PERSONA participants migration skipped (SQLite only)', {
      context: 'migration.fix-orphan-persona-participants',
    });

    return {
      id: 'fix-orphan-persona-participants-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema handles participant validation',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
