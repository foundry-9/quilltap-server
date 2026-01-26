/**
 * Single User Mode Enforcement
 *
 * Quilltap now operates in single-user mode only.
 * This module checks for deprecated auth configuration and fails
 * startup if someone tries to enable authentication.
 */

import { logger } from '@/lib/logger';

/**
 * Enforce single-user mode at startup.
 *
 * If AUTH_DISABLED is explicitly set to 'false', throw a fatal error
 * directing the user to migrate their data and update their configuration.
 *
 * @throws Error if AUTH_DISABLED is set to 'false'
 */
export function enforceSingleUserMode(): void {
  const authDisabled = process.env.AUTH_DISABLED;

  // If AUTH_DISABLED is explicitly set to 'false', fail startup
  if (authDisabled === 'false') {
    const errorMessage = `
================================================================================
FATAL: Authentication is no longer supported.
================================================================================

Quilltap now operates in single-user mode only. Multi-user authentication
has been removed.

If migrating from multi-user mode, run:
  npx ts-node scripts/migrate-to-single-user.ts

Then remove AUTH_DISABLED from your environment or set it to 'true'.

================================================================================
`;

    logger.error('Authentication mode is no longer supported', {
      context: 'enforceSingleUserMode',
      authDisabled,
    });

    throw new Error(errorMessage);
  }

  // Log a warning if AUTH_DISABLED is set (it's now unnecessary)
  if (authDisabled !== undefined) {
    logger.info('AUTH_DISABLED environment variable is deprecated and can be removed', {
      context: 'enforceSingleUserMode',
      authDisabled,
    });
  }

  logger.debug('Single-user mode enforcement check passed', {
    context: 'enforceSingleUserMode',
  });
}
