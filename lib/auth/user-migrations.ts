/**
 * User Migrations Wrapper
 *
 * Previously, this module ran per-user migrations after login via the upgrade plugin.
 *
 * With the new migration system, ALL migrations (including per-user data fixes)
 * run at server startup in instrumentation.ts BEFORE any requests are served.
 * This ensures data compatibility from the moment the server starts.
 *
 * This function is kept for backwards compatibility with existing code that
 * calls it after authentication, but it now does nothing.
 *
 * @deprecated All migrations now run at startup. This function is a no-op.
 */

import { logger } from '@/lib/logger';

/**
 * Run all post-login migrations for a user
 *
 * @deprecated This function is now a no-op. Migrations run at startup.
 * @param userId - The ID of the user who just logged in
 */
export async function runPostLoginMigrations(userId: string): Promise<void> {
  // All migrations now run at startup in instrumentation.ts
  // This function is kept for backwards compatibility but does nothing.
}
