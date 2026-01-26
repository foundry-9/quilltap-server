/**
 * Migration: Clear Auth Data When AUTH_DISABLED
 *
 * This migration runs when AUTH_DISABLED=true and clears all authentication-related
 * data to ensure a clean single-user state. This is useful after running the
 * migrate-to-single-user.ts script to ensure no stale auth data remains.
 *
 * Actions:
 * - Delete all rows from sessions table
 * - Delete all rows from accounts table (OAuth connections)
 * - Delete all users EXCEPT the unauthenticated user (ffffffff-ffff-ffff-ffff-ffffffffffff)
 *
 * Trigger: Only runs when AUTH_DISABLED=true AND there's data to clean up.
 *
 * Migration ID: clear-auth-on-disabled-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getSQLiteDatabase, querySQLite, executeSQLite, isSQLiteBackend } from '../lib/database-utils';

const UNAUTHENTICATED_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Check if AUTH_DISABLED is set to true
 */
function isAuthDisabled(): boolean {
  const authDisabled = process.env.AUTH_DISABLED;
  return authDisabled === 'true' || authDisabled === '1';
}

/**
 * Count existing auth data that would be cleared
 */
function countAuthData(): { sessions: number; accounts: number; otherUsers: number } {
  try {
    const sessions = querySQLite<{ count: number }>('SELECT COUNT(*) as count FROM sessions')[0]?.count || 0;
    const accounts = querySQLite<{ count: number }>('SELECT COUNT(*) as count FROM accounts')[0]?.count || 0;
    const otherUsers = querySQLite<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE id != ?',
      [UNAUTHENTICATED_USER_ID]
    )[0]?.count || 0;

    return { sessions, accounts, otherUsers };
  } catch {
    // Tables might not exist yet
    return { sessions: 0, accounts: 0, otherUsers: 0 };
  }
}

/**
 * Clear Auth Data When AUTH_DISABLED Migration
 */
export const clearAuthOnDisabledMigration: Migration = {
  id: 'clear-auth-on-disabled-v1',
  description: 'Clear authentication data when AUTH_DISABLED=true (single-user mode)',
  introducedInVersion: '2.9.0',
  dependsOn: ['sqlite-initial-schema-v1'], // Need tables to exist first

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      logger.debug('clear-auth-on-disabled: Skipping - not SQLite backend', {
        context: 'migration.clear-auth-on-disabled',
      });
      return false;
    }

    // Only run when AUTH_DISABLED is true
    if (!isAuthDisabled()) {
      logger.debug('clear-auth-on-disabled: Skipping - AUTH_DISABLED is not true', {
        context: 'migration.clear-auth-on-disabled',
      });
      return false;
    }

    // Check if there's data to clear
    const { sessions, accounts, otherUsers } = countAuthData();
    const hasDataToClear = sessions > 0 || accounts > 0 || otherUsers > 0;

    if (!hasDataToClear) {
      logger.debug('clear-auth-on-disabled: Skipping - no auth data to clear', {
        context: 'migration.clear-auth-on-disabled',
      });
      return false;
    }

    logger.info('clear-auth-on-disabled: Will run - found auth data to clear', {
      context: 'migration.clear-auth-on-disabled',
      sessions,
      accounts,
      otherUsers,
    });

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let sessionsDeleted = 0;
    let accountsDeleted = 0;
    let usersDeleted = 0;

    try {
      const db = getSQLiteDatabase();

      logger.info('Starting clear-auth-on-disabled migration', {
        context: 'migration.clear-auth-on-disabled',
      });

      // Run in a transaction for atomicity
      const clearAuthData = db.transaction(() => {
        // 1. Delete all sessions
        try {
          const sessionsResult = db.prepare('DELETE FROM sessions').run();
          sessionsDeleted = sessionsResult.changes;
          logger.debug('Deleted sessions', {
            context: 'migration.clear-auth-on-disabled',
            count: sessionsDeleted,
          });
        } catch (error) {
          // Table might not exist - log and continue
          logger.warn('Could not clear sessions table', {
            context: 'migration.clear-auth-on-disabled',
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // 2. Delete all OAuth accounts
        try {
          const accountsResult = db.prepare('DELETE FROM accounts').run();
          accountsDeleted = accountsResult.changes;
          logger.debug('Deleted OAuth accounts', {
            context: 'migration.clear-auth-on-disabled',
            count: accountsDeleted,
          });
        } catch (error) {
          // Table might not exist - log and continue
          logger.warn('Could not clear accounts table', {
            context: 'migration.clear-auth-on-disabled',
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // 3. Delete all users except the unauthenticated user
        try {
          const usersResult = db.prepare('DELETE FROM users WHERE id != ?').run(UNAUTHENTICATED_USER_ID);
          usersDeleted = usersResult.changes;
          logger.debug('Deleted users (except unauthenticated)', {
            context: 'migration.clear-auth-on-disabled',
            count: usersDeleted,
            preservedUserId: UNAUTHENTICATED_USER_ID,
          });
        } catch (error) {
          // Table might not exist - log and continue
          logger.warn('Could not clear users table', {
            context: 'migration.clear-auth-on-disabled',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      clearAuthData();

      const durationMs = Date.now() - startTime;
      const itemsAffected = sessionsDeleted + accountsDeleted + usersDeleted;

      logger.info('clear-auth-on-disabled migration completed', {
        context: 'migration.clear-auth-on-disabled',
        sessionsDeleted,
        accountsDeleted,
        usersDeleted,
        durationMs,
      });

      return {
        id: 'clear-auth-on-disabled-v1',
        success: true,
        itemsAffected,
        message: `Cleared auth data: ${sessionsDeleted} sessions, ${accountsDeleted} accounts, ${usersDeleted} users`,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('clear-auth-on-disabled migration failed', {
        context: 'migration.clear-auth-on-disabled',
        error: errorMessage,
      });

      return {
        id: 'clear-auth-on-disabled-v1',
        success: false,
        itemsAffected: 0,
        message: 'Failed to clear auth data',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
