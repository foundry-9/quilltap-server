/**
 * Plugin Initialization API v1
 *
 * POST /api/v1/system/plugins/initialize - Triggers plugin system initialization
 * GET /api/v1/system/plugins/initialize - Returns current plugin initialization status
 *
 * This endpoint is called on application startup from the client.
 * It is unauthenticated as it runs before user authentication is available.
 */

import { NextResponse } from 'next/server';
import { initializePlugins } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/system/plugins/initialize
 *
 * Initializes the plugin system by scanning and loading all plugins.
 * This endpoint is idempotent - multiple calls are safe.
 */
export async function POST() {
  try {
    logger.info('[System Plugins v1] Plugin initialization requested via API');

    const result = await initializePlugins();

    if (!result.success) {
      logger.error('[System Plugins v1] Plugin initialization failed', {
        errors: result.errors,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Plugin initialization failed',
          result,
        },
        { status: 500 }
      );
    }

    // Log warnings if any
    if (result.warnings.length > 0) {
      logger.warn('[System Plugins v1] Plugin initialization completed with warnings', {
        warnings: result.warnings,
      });
    }

    logger.info('[System Plugins v1] Plugin initialization completed successfully', {
      stats: result.stats,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error('[System Plugins v1] Error in plugin initialization endpoint', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
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

    logger.debug('[System Plugins v1] Plugin system state requested', { state });

    return NextResponse.json({
      success: true,
      state,
    });
  } catch (error) {
    logger.error('[System Plugins v1] Error getting plugin system state', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get plugin system state',
      },
      { status: 500 }
    );
  }
}
