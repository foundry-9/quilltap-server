/**
 * Plugin Upgrader
 *
 * Handles the actual upgrade of plugins by reinstalling them from npm.
 * Uses the existing installPluginFromNpm() function for the upgrade process.
 */

import { logger } from '@/lib/logger';
import { installPluginFromNpm } from './installer';
import type { PluginUpdateInfo } from './version-checker';

// ============================================================================
// TYPES
// ============================================================================

export interface UpgradeResult {
  /** npm package name */
  packageName: string;
  /** Whether the upgrade succeeded */
  success: boolean;
  /** Version before upgrade */
  fromVersion: string;
  /** Version after upgrade (if successful) */
  toVersion?: string;
  /** Error message (if failed) */
  error?: string;
  /** Whether the plugin requires a restart to activate */
  requiresRestart: boolean;
}

export interface UpgradeResults {
  /** Successfully upgraded plugins */
  upgraded: UpgradeResult[];
  /** Plugins that failed to upgrade */
  failed: UpgradeResult[];
  /** Total number of plugins checked for updates */
  totalChecked: number;
}

// ============================================================================
// UPGRADE FUNCTIONS
// ============================================================================

/**
 * Upgrade a single plugin to its latest version
 *
 * @param updateInfo - Information about the plugin to upgrade
 * @returns Result of the upgrade attempt
 */
export async function upgradePlugin(updateInfo: PluginUpdateInfo): Promise<UpgradeResult> {
  const { packageName, currentVersion, latestVersion } = updateInfo;

  logger.info('Upgrading plugin', {
    context: 'PluginUpgrader.upgradePlugin',
    packageName,
    fromVersion: currentVersion,
    toVersion: latestVersion,
  });

  try {
    // Use the existing installation function which handles updates
    // (it removes the old version before installing the new one)
    const result = await installPluginFromNpm(packageName);

    if (result.success) {
      logger.info('Plugin upgraded successfully', {
        context: 'PluginUpgrader.upgradePlugin',
        packageName,
        fromVersion: currentVersion,
        toVersion: result.version || latestVersion,
        requiresRestart: result.requiresRestart || false,
      });

      return {
        packageName,
        success: true,
        fromVersion: currentVersion,
        toVersion: result.version || latestVersion,
        requiresRestart: result.requiresRestart || false,
      };
    } else {
      logger.warn('Plugin upgrade failed', {
        context: 'PluginUpgrader.upgradePlugin',
        packageName,
        error: result.error,
      });

      return {
        packageName,
        success: false,
        fromVersion: currentVersion,
        error: result.error,
        requiresRestart: false,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      'Unexpected error during plugin upgrade',
      {
        context: 'PluginUpgrader.upgradePlugin',
        packageName,
      },
      error instanceof Error ? error : new Error(errorMessage)
    );

    return {
      packageName,
      success: false,
      fromVersion: currentVersion,
      error: errorMessage,
      requiresRestart: false,
    };
  }
}

/**
 * Upgrade multiple plugins sequentially
 *
 * Plugins are upgraded one at a time to avoid overwhelming the system
 * and to provide clear logging of each upgrade attempt.
 *
 * @param updates - Array of plugins to upgrade
 * @returns Results of all upgrade attempts
 */
export async function upgradePlugins(updates: PluginUpdateInfo[]): Promise<UpgradeResults> {
  const results: UpgradeResults = {
    upgraded: [],
    failed: [],
    totalChecked: updates.length,
  };

  if (updates.length === 0) {
    logger.debug('No plugins to upgrade', {
      context: 'PluginUpgrader.upgradePlugins',
    });
    return results;
  }

  logger.info('Starting plugin upgrades', {
    context: 'PluginUpgrader.upgradePlugins',
    count: updates.length,
    plugins: updates.map(u => `${u.packageName}@${u.currentVersion} -> ${u.latestVersion}`),
  });

  // Upgrade plugins sequentially
  for (const update of updates) {
    const result = await upgradePlugin(update);

    if (result.success) {
      results.upgraded.push(result);
    } else {
      results.failed.push(result);
    }
  }

  // Log summary
  logger.info('Plugin upgrades complete', {
    context: 'PluginUpgrader.upgradePlugins',
    totalChecked: results.totalChecked,
    upgraded: results.upgraded.length,
    failed: results.failed.length,
    upgradedPlugins: results.upgraded.map(r => r.packageName),
    failedPlugins: results.failed.map(r => ({ name: r.packageName, error: r.error })),
  });

  return results;
}
