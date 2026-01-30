/**
 * Database Migration Service
 *
 * NOTE: MongoDB support has been removed. This service is now a stub
 * that maintains the public API for backward compatibility.
 * All new installations use SQLite exclusively.
 */

import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration progress tracking
 */
export interface MigrationProgress {
  phase: 'preparing' | 'migrating' | 'verifying' | 'complete' | 'failed';
  currentCollection: string | null;
  collectionsCompleted: number;
  collectionsTotal: number;
  recordsCompleted: number;
  recordsTotal: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Result of readiness check
 */
export interface ReadinessResult {
  ready: boolean;
  sourceConnected: boolean;
  targetWritable: boolean;
  collectionCounts: Record<string, number>;
  totalRecords: number;
  errors: string[];
  warnings: string[];
}

/**
 * Result of migration
 */
export interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  collectionsMigrated: number;
  duration: number;
  errors: string[];
}

// ============================================================================
// Migration Service
// ============================================================================

/**
 * Singleton progress tracking
 */
let currentProgress: MigrationProgress | null = null;
let migrationInProgress = false;

/**
 * Database Migration Service
 *
 * NOTE: MongoDB has been removed from this application.
 * This service is maintained for backward compatibility only.
 */
export class DatabaseMigrationService {
  /**
   * Get the current migration progress
   */
  getProgress(): MigrationProgress | null {
    return currentProgress;
  }

  /**
   * Check if a migration is currently in progress
   */
  isMigrationInProgress(): boolean {
    return migrationInProgress;
  }

  /**
   * Check readiness for migration
   * MongoDB migrations are no longer supported
   */
  async checkReadiness(direction: 'mongo-to-sqlite'): Promise<ReadinessResult> {
    logger.warn('Migration readiness check called but MongoDB support has been removed', {
      context: 'database.migration',
      direction,
    });

    const result: ReadinessResult = {
      ready: false,
      sourceConnected: false,
      targetWritable: true,
      collectionCounts: {},
      totalRecords: 0,
      errors: ['MongoDB support has been removed. Migration is no longer available.'],
      warnings: [],
    };

    return result;
  }

  /**
   * Migrate data from MongoDB to SQLite
   * This is no longer supported - MongoDB has been removed
   */
  async migrateToSQLite(): Promise<MigrationResult> {
    const errorMessage = 'MongoDB support has been removed. Migration is no longer available.';

    logger.error('Migration attempted but MongoDB support has been removed', {
      context: 'database.migration',
    });

    return {
      success: false,
      recordsMigrated: 0,
      collectionsMigrated: 0,
      duration: 0,
      errors: [errorMessage],
    };
  }
}

/**
 * Create a singleton instance of the migration service
 */
let migrationServiceInstance: DatabaseMigrationService | null = null;

/**
 * Get the migration service singleton
 */
export function getMigrationService(): DatabaseMigrationService {
  if (!migrationServiceInstance) {
    migrationServiceInstance = new DatabaseMigrationService();
  }
  return migrationServiceInstance;
}
