/**
 * Plugin Upgrades API v1
 *
 * GET /api/v1/system/plugins/upgrades - Returns pending upgrade notifications
 * POST /api/v1/system/plugins/upgrades - Marks upgrades as notified
 *
 * This endpoint is called by the client to get and acknowledge plugin upgrade
 * notifications that occurred during server startup.
 *
 * Unauthenticated as it runs during startup before user auth is available.
 */

import { NextResponse } from 'next/server';
import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/system/plugins/upgrades
 *
 * Returns upgrade information if there are un-notified upgrades.
 * Returns null results if already notified or no upgrades occurred.
 */
export async function GET() {
  try {
    // Check if server is ready
    if (!startupState.isReady()) {
      return NextResponse.json({
        success: true,
        ready: false,
        results: null,
        message: 'Server startup not complete',
      });
    }

    // Check for un-notified upgrades
    if (!startupState.hasUnnotifiedUpgrades()) {
      return NextResponse.json({
        success: true,
        ready: true,
        results: null,
        message: 'No un-notified upgrades',
      });
    }

    const results = startupState.getPluginUpgrades();

    logger.info('[Plugin Upgrades v1] Returning upgrade notifications', {
      context: 'api.v1.system.plugins.upgrades.GET',
      upgraded: results?.upgraded.length ?? 0,
      failed: results?.failed.length ?? 0,
    });

    return NextResponse.json({
      success: true,
      ready: true,
      results,
    });
  } catch (error) {
    logger.error(
      '[Plugin Upgrades v1] Error getting upgrade notifications',
      { context: 'api.v1.system.plugins.upgrades.GET' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get upgrade notifications',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/system/plugins/upgrades
 *
 * Marks upgrade notifications as acknowledged by the client.
 * Call this after showing toast notifications to prevent re-notification.
 */
export async function POST() {
  try {
    startupState.markUpgradesNotified();

    logger.info('[Plugin Upgrades v1] Upgrades marked as notified', {
      context: 'api.v1.system.plugins.upgrades.POST',
    });

    return NextResponse.json({
      success: true,
      message: 'Upgrades marked as notified',
    });
  } catch (error) {
    logger.error(
      '[Plugin Upgrades v1] Error marking upgrades as notified',
      { context: 'api.v1.system.plugins.upgrades.POST' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to mark upgrades as notified',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
