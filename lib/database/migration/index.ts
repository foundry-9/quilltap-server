/**
 * Database Migration Module
 *
 * Exports migration service and types for MongoDB to SQLite migration.
 */

export {
  DatabaseMigrationService,
  getMigrationService,
  type MigrationProgress,
  type ReadinessResult,
  type MigrationResult,
} from './migration-service';
