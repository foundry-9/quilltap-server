/**
 * Plugin Logger
 *
 * Self-contained logger for the upgrade plugin that doesn't depend on app imports.
 * Uses createPluginLogger from @quilltap/plugin-utils which works during container startup.
 */

import { createPluginLogger } from '@quilltap/plugin-utils';

/**
 * Main logger instance for the upgrade plugin
 */
export const logger = createPluginLogger('qtap-plugin-upgrade');

/**
 * Create a child logger with additional context
 */
export function createMigrationLogger(migrationId: string) {
  return logger.child({
    context: `migration.${migrationId}`,
  });
}
