/**
 * Migration: Ensure User Usernames
 *
 * Ensures all users have a username field populated.
 * This is required because the username field became mandatory in the UserSchema,
 * but users created via OAuth before this change may not have a username set.
 *
 * What it does:
 * 1. Scans all users in the MongoDB users collection
 * 2. Identifies users without a username
 * 3. Generates a username from their email (before @) or creates a fallback
 * 4. Updates users with the generated username
 *
 * This migration is idempotent - it only updates users who don't have a username.
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '@/lib/logger';

/**
 * Check if MongoDB backend is enabled
 */
function isMongoDBBackendEnabled(): boolean {
  const backend = process.env.DATA_BACKEND || '';
  return backend === 'mongodb' || backend === 'dual';
}

/**
 * Get MongoDB database instance
 */
async function getMongoDatabase() {
  const { getMongoDatabase: getDb } = await import('@/lib/mongodb/client');
  return getDb();
}

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.admin().ping();
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for username migration', {
      context: 'migration.ensure-user-usernames',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate a username from an email address
 * Takes the part before @ and sanitizes it
 */
function generateUsernameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  // Remove any characters that aren't alphanumeric, underscore, or hyphen
  const sanitized = localPart.replace(/[^a-zA-Z0-9_-]/g, '');
  // Ensure minimum length
  if (sanitized.length < 3) {
    return sanitized + '_user';
  }
  return sanitized;
}

/**
 * Generate a fallback username from user ID
 */
function generateFallbackUsername(userId: string): string {
  // Take first 8 chars of UUID for a short readable username
  const shortId = userId.replace(/-/g, '').substring(0, 8);
  return `user_${shortId}`;
}

/**
 * Check if there are users without usernames
 */
async function getUsersWithoutUsernames(): Promise<Array<{ id: string; email?: string }>> {
  try {
    const db = await getMongoDatabase();
    const usersCollection = db.collection('users');

    // Find users where username is null, undefined, or empty string
    const users = await usersCollection.find({
      $or: [
        { username: { $exists: false } },
        { username: null },
        { username: '' },
      ],
    }).toArray();

    return users.map(u => ({
      id: u.id as string,
      email: u.email as string | undefined,
    }));
  } catch (error) {
    logger.error('Error checking for users without usernames', {
      context: 'migration.ensure-user-usernames',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Check if a username is already taken
 */
async function isUsernameTaken(username: string): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const usersCollection = db.collection('users');
    const existing = await usersCollection.findOne({ username });
    return existing !== null;
  } catch (error) {
    logger.error('Error checking if username is taken', {
      context: 'migration.ensure-user-usernames',
      username,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate a unique username, adding numbers if needed
 */
async function generateUniqueUsername(baseUsername: string): Promise<string> {
  let username = baseUsername;
  let suffix = 1;

  while (await isUsernameTaken(username)) {
    username = `${baseUsername}${suffix}`;
    suffix++;
    // Safety limit
    if (suffix > 1000) {
      throw new Error(`Could not generate unique username for base: ${baseUsername}`);
    }
  }

  return username;
}

/**
 * Ensure User Usernames Migration
 */
export const ensureUserUsernamesMigration: Migration = {
  id: 'ensure-user-usernames-v1',
  description: 'Ensure all users have a username field populated',
  introducedInVersion: '2.1.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB not enabled, skipping username migration', {
        context: 'migration.ensure-user-usernames',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring username migration', {
        context: 'migration.ensure-user-usernames',
      });
      return false;
    }

    // Check if there are users without usernames
    const usersWithoutUsernames = await getUsersWithoutUsernames();

    logger.debug('Checked for users without usernames', {
      context: 'migration.ensure-user-usernames',
      count: usersWithoutUsernames.length,
    });

    return usersWithoutUsernames.length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const updatedUsers: string[] = [];
    const errors: Array<{ userId: string; error: string }> = [];

    logger.info('Starting user username migration', {
      context: 'migration.ensure-user-usernames',
    });

    try {
      const db = await getMongoDatabase();
      const usersCollection = db.collection('users');
      const usersWithoutUsernames = await getUsersWithoutUsernames();

      logger.info('Found users without usernames', {
        context: 'migration.ensure-user-usernames',
        count: usersWithoutUsernames.length,
      });

      for (const user of usersWithoutUsernames) {
        try {
          // Generate username from email or fallback
          let baseUsername: string;
          if (user.email) {
            baseUsername = generateUsernameFromEmail(user.email);
          } else {
            baseUsername = generateFallbackUsername(user.id);
          }

          // Ensure it's unique
          const username = await generateUniqueUsername(baseUsername);

          // Update the user
          const result = await usersCollection.updateOne(
            { id: user.id },
            {
              $set: {
                username,
                updatedAt: new Date().toISOString(),
              },
            }
          );

          if (result.modifiedCount > 0) {
            updatedUsers.push(user.id);
            logger.info('Updated user with username', {
              context: 'migration.ensure-user-usernames',
              userId: user.id,
              username,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            userId: user.id,
            error: errorMessage,
          });
          logger.error('Failed to update user username', {
            context: 'migration.ensure-user-usernames',
            userId: user.id,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Username migration failed', {
        context: 'migration.ensure-user-usernames',
        error: errorMessage,
      });

      return {
        id: 'ensure-user-usernames-v1',
        success: false,
        itemsAffected: updatedUsers.length,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    return {
      id: 'ensure-user-usernames-v1',
      success,
      itemsAffected: updatedUsers.length,
      message: success
        ? `Updated ${updatedUsers.length} users with usernames`
        : `Updated ${updatedUsers.length} users with ${errors.length} errors`,
      error: errors.length > 0
        ? `Failed users: ${errors.map(e => `${e.userId}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
