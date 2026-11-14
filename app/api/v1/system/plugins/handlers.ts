/**
 * The plugin system's operator endpoints, served by `/api/v1/system/plugins`
 * (`?action=state` / `upgrades` on GET, `initialize` / `mark-upgrades-notified`
 * on POST). The old `/system/plugins/initialize` and `/system/plugins/upgrades`
 * paths answer for one release through `deprecatedPath`.
 *
 * @module api/v1/system/plugins/handlers
 */

import { initializePlugins } from '@/lib/startup/plugin-initialization';
import { startupState } from '@/lib/startup/startup-state';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';

/**
 * POST /api/v1/system/plugins?action=initialize
 *
 * Initializes the plugin system by scanning and loading all plugins.
 * This endpoint is idempotent - multiple calls are safe.
 */
export async function handleInitializePlugins() {
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
 * GET /api/v1/system/plugins?action=state
 *
 * Returns the current plugin initialization status without triggering initialization.
 */
export async function handlePluginSystemState() {
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

/**
 * GET /api/v1/system/plugins?action=upgrades
 *
 * Returns upgrade information if there are un-notified upgrades.
 * Returns null results if already notified or no upgrades occurred.
 */
export async function handlePluginUpgrades() {
  try {
    // Check if server is ready
    if (!startupState.isReady()) {
      return successResponse({
        success: true,
        ready: false,
        results: null,
        message: 'Server startup not complete',
      });
    }

    // Check for un-notified upgrades
    if (!startupState.hasUnnotifiedUpgrades()) {
      return successResponse({
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

    return successResponse({
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
    return serverError('Failed to get upgrade notifications');
  }
}

/**
 * POST /api/v1/system/plugins?action=mark-upgrades-notified
 *
 * Marks upgrade notifications as acknowledged by the client.
 * Call this after showing toast notifications to prevent re-notification.
 */
export async function handleMarkUpgradesNotified() {
  try {
    startupState.markUpgradesNotified();

    logger.info('[Plugin Upgrades v1] Upgrades marked as notified', {
      context: 'api.v1.system.plugins.upgrades.POST',
    });

    return successResponse({
      success: true,
      message: 'Upgrades marked as notified',
    });
  } catch (error) {
    logger.error(
      '[Plugin Upgrades v1] Error marking upgrades as notified',
      { context: 'api.v1.system.plugins.upgrades.POST' },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to mark upgrades as notified');
  }
}
