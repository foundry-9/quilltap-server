/**
 * Migration Logger
 *
 * Provides logging for migrations. Uses the core app logger since
 * migrations now run as part of the startup sequence rather than
 * as an external plugin.
 */

import { logger as appLogger } from '@/lib/logger';

/**
 * Logger instance for migrations
 */
export const logger = appLogger;

/**
 * Create a child logger with migration-specific context
 */
export function createMigrationLogger(migrationId: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      appLogger.info(message, { ...meta, context: `migration.${migrationId}` }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      appLogger.warn(message, { ...meta, context: `migration.${migrationId}` }),
    error: (message: string, meta?: Record<string, unknown>, error?: Error) =>
      appLogger.error(message, { ...meta, context: `migration.${migrationId}` }, error),
  };
}
