/**
 * Migration: Create LLM Logs Collection
 *
 * This migration creates the llm_logs collection with appropriate indexes
 * for LLM request/response logging functionality.
 *
 * SQLite only - this table is created as part of the schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: add-llm-logs-collection-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Create LLM Logs Collection Migration
 */
export const addLLMLogsCollectionMigration: Migration = {
  id: 'add-llm-logs-collection-v1',
  description: 'Create llm_logs table with indexes for LLM logging (SQLite only - no-op)',
  introducedInVersion: '2.8.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite (schema created during sqlite-initial-schema migration)
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('LLM logs collection migration skipped (SQLite only)', {
      context: 'migration.add-llm-logs-collection',
    });

    return {
      id: 'add-llm-logs-collection-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema includes llm_logs table',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
