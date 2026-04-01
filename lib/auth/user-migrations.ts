/**
 * User Migrations Wrapper
 *
 * This module provides a thin wrapper around the upgrade plugin's user migrations
 * functionality. It uses dynamic imports to avoid Next.js Turbopack bundling issues
 * with the upgrade plugin's compiled bundle.
 */

import { logger } from '@/lib/logger';

/**
 * Run all post-login migrations for a user
 *
 * This function is called after successful authentication.
 * It dynamically imports the upgrade plugin to run per-user migrations.
 *
 * @param userId - The ID of the user who just logged in
 */
export async function runPostLoginMigrations(userId: string): Promise<void> {
  try {
    // Dynamic import to avoid Turbopack bundling issues with the plugin
    const { runPostLoginMigrations: runMigrations } = await import(
      '@/plugins/dist/qtap-plugin-upgrade/user-migrations'
    );
    await runMigrations(userId);
  } catch (error) {
    logger.error('Failed to run post-login migrations', {
      context: 'user-migrations.runPostLoginMigrations',
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - migrations should not block login
  }
}
