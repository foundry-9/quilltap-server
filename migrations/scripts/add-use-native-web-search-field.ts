/**
 * Migration: Add useNativeWebSearch Field
 *
 * This migration adds the useNativeWebSearch field to connection_profiles.
 * This decouples the web search tool (allowWebSearch) from native provider
 * web search integration (useNativeWebSearch).
 *
 * - allowWebSearch: Controls whether the search_web tool is provided to the LLM
 * - useNativeWebSearch: Controls whether to use the provider's native web search
 *
 * SQLite only - this field is created as part of the schema.
 * This migration is now a no-op for SQLite (MongoDB support removed).
 *
 * Migration ID: add-use-native-web-search-field-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';

/**
 * Add useNativeWebSearch Field Migration
 */
export const addUseNativeWebSearchFieldMigration: Migration = {
  id: 'add-use-native-web-search-field-v1',
  description: 'Add useNativeWebSearch field to connection profiles to decouple tool from native web search (SQLite only - no-op)',
  introducedInVersion: '2.7.0',
  dependsOn: [],

  async shouldRun(): Promise<boolean> {
    // No-op for SQLite (schema created during sqlite-initial-schema migration)
    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('useNativeWebSearch field migration skipped (SQLite only)', {
      context: 'migration.add-use-native-web-search-field',
    });

    return {
      id: 'add-use-native-web-search-field-v1',
      success: true,
      itemsAffected: 0,
      message: 'Skipped - SQLite schema includes useNativeWebSearch field',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
