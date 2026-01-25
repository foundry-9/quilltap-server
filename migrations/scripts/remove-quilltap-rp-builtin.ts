/**
 * Migration: Remove Quilltap RP Built-in Template
 *
 * Removes the old hardcoded "Quilltap RP" built-in template from the database.
 * This template has been migrated to a plugin (qtap-plugin-template-quilltap-rp).
 *
 * What it does:
 * 1. Checks for the existence of the old "Quilltap RP" built-in template in MongoDB
 * 2. Deletes it if found
 *
 * This migration is idempotent - it only runs if the old template exists.
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

/**
 * Check if MongoDB is accessible
 * Uses database-level ping instead of admin ping to work with
 * hosted MongoDB services where the user may not have admin access.
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    // Use database-level ping instead of admin ping - works without admin privileges
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for Quilltap RP removal migration', {
      context: 'migration.remove-quilltap-rp-builtin',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if the old Quilltap RP built-in template exists
 */
async function getOldQuilltapRPTemplate(): Promise<{ id: string } | null> {
  try {
    const db = await getMongoDatabase();
    const templatesCollection = db.collection('roleplay_templates');

    // Find the old built-in template by name and isBuiltIn flag
    const template = await templatesCollection.findOne({
      name: 'Quilltap RP',
      isBuiltIn: true,
    });

    if (template) {
      return { id: template.id as string };
    }
    return null;
  } catch (error) {
    logger.error('Error checking for old Quilltap RP template', {
      context: 'migration.remove-quilltap-rp-builtin',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Remove Quilltap RP Built-in Template Migration
 */
export const removeQuilltapRPBuiltinMigration: Migration = {
  id: 'remove-quilltap-rp-builtin-v1',
  description: 'Remove the old hardcoded Quilltap RP built-in template (now provided by plugin)',
  introducedInVersion: '2.5.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if the old template exists
    const oldTemplate = await getOldQuilltapRPTemplate();
    return oldTemplate !== null;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();

    logger.info('Starting Quilltap RP built-in template removal migration', {
      context: 'migration.remove-quilltap-rp-builtin',
    });

    try {
      const db = await getMongoDatabase();
      const templatesCollection = db.collection('roleplay_templates');

      // Delete the old built-in template
      const result = await templatesCollection.deleteOne({
        name: 'Quilltap RP',
        isBuiltIn: true,
      });

      const deletedCount = result.deletedCount || 0;
      const durationMs = Date.now() - startTime;

      if (deletedCount > 0) {
        logger.info('Removed old Quilltap RP built-in template', {
          context: 'migration.remove-quilltap-rp-builtin',
          deletedCount,
        });

        return {
          id: 'remove-quilltap-rp-builtin-v1',
          success: true,
          itemsAffected: deletedCount,
          message: `Removed ${deletedCount} old Quilltap RP built-in template(s)`,
          durationMs,
          timestamp: new Date().toISOString(),
        };
      } else {
        logger.info('No old Quilltap RP built-in template found to remove', {
          context: 'migration.remove-quilltap-rp-builtin',
        });

        return {
          id: 'remove-quilltap-rp-builtin-v1',
          success: true,
          itemsAffected: 0,
          message: 'No old Quilltap RP built-in template found',
          durationMs,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Quilltap RP removal migration failed', {
        context: 'migration.remove-quilltap-rp-builtin',
        error: errorMessage,
      });

      return {
        id: 'remove-quilltap-rp-builtin-v1',
        success: false,
        itemsAffected: 0,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
