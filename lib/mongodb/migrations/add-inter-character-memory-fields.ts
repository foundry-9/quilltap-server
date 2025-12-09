/**
 * Migration: Add Inter-Character Memory Fields
 *
 * This migration adds the aboutCharacterId field to memories to support
 * character-to-character memories in multi-character chats.
 *
 * Migration ID: add-inter-character-memory-fields-v1
 */

import { Db } from 'mongodb';
import { logger } from '@/lib/logger';
import { getMongoMigrationsRepository } from '@/lib/mongodb/repositories/migrations.repository';

const MIGRATION_ID = 'add-inter-character-memory-fields-v1';

interface MigrationResult {
  success: boolean;
  memoriesUpdated: number;
  errors: string[];
}

/**
 * Run the inter-character memory fields migration
 */
export async function runInterCharacterMemoryFieldsMigration(db: Db): Promise<MigrationResult> {
  const migrationsRepo = getMongoMigrationsRepository();

  logger.info('Starting inter-character memory fields migration', { migrationId: MIGRATION_ID });

  // Check if already completed
  const isCompleted = await migrationsRepo.isMigrationCompleted(MIGRATION_ID);
  if (isCompleted) {
    logger.info('Migration already completed, skipping', { migrationId: MIGRATION_ID });
    return {
      success: true,
      memoriesUpdated: 0,
      errors: [],
    };
  }

  const result: MigrationResult = {
    success: true,
    memoriesUpdated: 0,
    errors: [],
  };

  try {
    // Add aboutCharacterId: null to all existing memories that don't have it
    logger.debug('Adding aboutCharacterId field to existing memories');
    const memoriesCollection = db.collection('memories');
    const updateResult = await memoriesCollection.updateMany(
      { aboutCharacterId: { $exists: false } },
      { $set: { aboutCharacterId: null } }
    );
    result.memoriesUpdated = updateResult.modifiedCount;
    logger.debug('Memories updated with aboutCharacterId', { count: result.memoriesUpdated });

    // Record migration as completed
    const packageJson = await import('@/package.json');
    await migrationsRepo.recordCompletedMigration({
      id: MIGRATION_ID,
      completedAt: new Date().toISOString(),
      quilltapVersion: packageJson.version,
      itemsAffected: result.memoriesUpdated,
      message: `Added aboutCharacterId field to ${result.memoriesUpdated} memories`,
    });

    logger.info('Inter-character memory fields migration completed successfully', {
      migrationId: MIGRATION_ID,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Inter-character memory fields migration failed', {
      migrationId: MIGRATION_ID,
      error: errorMessage,
    });
    result.success = false;
    result.errors.push(errorMessage);
  }

  return result;
}

/**
 * Check if the migration needs to be run
 */
export async function needsInterCharacterMemoryFieldsMigration(): Promise<boolean> {
  const migrationsRepo = getMongoMigrationsRepository();
  const isCompleted = await migrationsRepo.isMigrationCompleted(MIGRATION_ID);
  return !isCompleted;
}

/**
 * Get the migration ID
 */
export function getInterCharacterMemoryMigrationId(): string {
  return MIGRATION_ID;
}
