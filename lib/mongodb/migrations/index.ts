/**
 * MongoDB Migrations Index
 *
 * Central export for all MongoDB migrations.
 * Migrations are run in order during startup.
 */

import { Db } from 'mongodb';
import { logger } from '@/lib/logger';

// Import all migrations
import {
  runMultiCharacterFieldsMigration,
  needsMultiCharacterFieldsMigration,
  getMultiCharacterMigrationId,
} from './add-multi-character-fields';

import {
  runInterCharacterMemoryFieldsMigration,
  needsInterCharacterMemoryFieldsMigration,
  getInterCharacterMemoryMigrationId,
} from './add-inter-character-memory-fields';

// Export individual migrations
export {
  runMultiCharacterFieldsMigration,
  needsMultiCharacterFieldsMigration,
  getMultiCharacterMigrationId,
  runInterCharacterMemoryFieldsMigration,
  needsInterCharacterMemoryFieldsMigration,
  getInterCharacterMemoryMigrationId,
};

/**
 * Migration definition
 */
interface Migration {
  id: string;
  name: string;
  needsRun: () => Promise<boolean>;
  run: (db: Db) => Promise<{ success: boolean; errors: string[] }>;
}

/**
 * All migrations in order
 */
const MIGRATIONS: Migration[] = [
  {
    id: getMultiCharacterMigrationId(),
    name: 'Add Multi-Character Fields',
    needsRun: needsMultiCharacterFieldsMigration,
    run: runMultiCharacterFieldsMigration,
  },
  {
    id: getInterCharacterMemoryMigrationId(),
    name: 'Add Inter-Character Memory Fields',
    needsRun: needsInterCharacterMemoryFieldsMigration,
    run: runInterCharacterMemoryFieldsMigration,
  },
];

/**
 * Run all pending migrations
 */
export async function runAllMigrations(db: Db): Promise<{
  migrationsRun: number;
  migrationsSkipped: number;
  errors: string[];
}> {
  logger.info('Checking for pending migrations', { totalMigrations: MIGRATIONS.length });

  const result = {
    migrationsRun: 0,
    migrationsSkipped: 0,
    errors: [] as string[],
  };

  for (const migration of MIGRATIONS) {
    try {
      const needsRun = await migration.needsRun();

      if (!needsRun) {
        logger.debug('Migration already completed, skipping', {
          migrationId: migration.id,
          migrationName: migration.name,
        });
        result.migrationsSkipped++;
        continue;
      }

      logger.info('Running migration', {
        migrationId: migration.id,
        migrationName: migration.name,
      });

      const migrationResult = await migration.run(db);

      if (migrationResult.success) {
        logger.info('Migration completed successfully', {
          migrationId: migration.id,
          migrationName: migration.name,
        });
        result.migrationsRun++;
      } else {
        logger.error('Migration failed', {
          migrationId: migration.id,
          migrationName: migration.name,
          errors: migrationResult.errors,
        });
        result.errors.push(...migrationResult.errors);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration threw an exception', {
        migrationId: migration.id,
        migrationName: migration.name,
        error: errorMessage,
      });
      result.errors.push(`${migration.name}: ${errorMessage}`);
    }
  }

  logger.info('Migration check complete', {
    migrationsRun: result.migrationsRun,
    migrationsSkipped: result.migrationsSkipped,
    errorsCount: result.errors.length,
  });

  return result;
}
