/**
 * Migration Warnings API v1
 *
 * GET /api/v1/system/migration-warnings - Returns pending migration warning notifications
 * POST /api/v1/system/migration-warnings - Marks warnings as notified
 *
 * This endpoint is called by the client to get and acknowledge migration warnings
 * that were generated during server startup (e.g., unrecoverable API keys).
 *
 * Unauthenticated as it runs during startup before user auth is available.
 */

import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';
import { successResponse, serverError, messageResponse } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/system/migration-warnings
 *
 * Returns migration warnings if there are un-notified ones.
 * Returns empty warnings array if already notified or none occurred.
 */
export async function GET() {
  try {
    // Check if server is ready
    if (!startupState.isReady()) {
      return successResponse({
        ready: false,
        warnings: [],
        message: 'Server startup not complete',
      });
    }

    // Check for un-notified warnings
    if (!startupState.hasUnnotifiedMigrationWarnings()) {
      return successResponse({
        ready: true,
        warnings: [],
        message: 'No un-notified migration warnings',
      });
    }

    const warnings = startupState.getMigrationWarnings();

    logger.info('Returning migration warning notifications', {
      context: 'api.v1.system.migration-warnings.GET',
      warningCount: warnings.length,
    });

    return successResponse({
      ready: true,
      warnings,
    });
  } catch (error) {
    logger.error(
      'Error getting migration warning notifications',
      { context: 'api.v1.system.migration-warnings.GET' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to get migration warning notifications');
  }
}

/**
 * POST /api/v1/system/migration-warnings
 *
 * Marks migration warning notifications as acknowledged by the client.
 * Call this after showing toast notifications to prevent re-notification.
 */
export async function POST() {
  try {
    startupState.markMigrationWarningsNotified();

    logger.info('Migration warnings marked as notified', {
      context: 'api.v1.system.migration-warnings.POST',
    });

    return messageResponse('Migration warnings marked as notified');
  } catch (error) {
    logger.error(
      'Error marking migration warnings as notified',
      { context: 'api.v1.system.migration-warnings.POST' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to mark migration warnings as notified');
  }
}
