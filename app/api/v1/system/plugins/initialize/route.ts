/**
 * Plugin Initialization API v1
 *
 * POST /api/v1/system/plugins/initialize - Triggers plugin system initialization
 * GET /api/v1/system/plugins/initialize - Returns current plugin initialization status
 *
 * This endpoint is called on application startup from the client.
 * It is unauthenticated as it runs before user authentication is available.
 */

import { initializePlugins } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/system/plugins/initialize
 *
 * Initializes the plugin system by scanning and loading all plugins.
 * This endpoint is idempotent - multiple calls are safe.
 */
export async function POST() {
  try {
    const result = await initializePlugins();

    if (!result.success) {
      logger.error('[System Plugins v1] Plugin initialization failed', {
        errors: result.errors,
      });
      return serverError('Plugin initialization failed');
    }

    // Log warnings if any
    if (result.warnings.length > 0) {
      logger.warn('[System Plugins v1] Plugin initialization completed with warnings', {
        warnings: result.warnings,
      });
    }

    return successResponse({
      success: true,
      result,
    });
  } catch (error) {
    logger.error('[System Plugins v1] Error in plugin initialization endpoint', { error });
    return serverError('Internal server error');
  }
}

/**
 * GET /api/v1/system/plugins/initialize
 *
 * Returns the current plugin initialization status without triggering initialization.
 */
export async function GET() {
  try {
    const { getPluginSystemState } = await import('@/lib/startup/plugin-initialization');
    const state = getPluginSystemState();

    return successResponse({
      success: true,
      state,
    });
  } catch (error) {
    logger.error('[System Plugins v1] Error getting plugin system state', { error });
    return serverError('Failed to get plugin system state');
  }
}
