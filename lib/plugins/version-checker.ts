/**
 * Plugin Version Checker
 *
 * Checks npm registry for available updates to installed plugins.
 * Uses semver to determine if updates are breaking (major) or non-breaking (minor/patch).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/lib/logger';
import { getInstalledPlugins, type InstalledPluginInfo } from './installer';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface PluginUpdateInfo {
  /** npm package name */
  packageName: string;
  /** Currently installed version */
  currentVersion: string;
  /** Latest version available on npm */
  latestVersion: string;
  /** True if update is minor/patch (non-breaking per semver) */
  isNonBreaking: boolean;
}

// ============================================================================
// VERSION UTILITIES
// ============================================================================

/**
 * Parse a semver version string into major, minor, patch components
 * Handles versions with or without 'v' prefix and pre-release suffixes
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  // Remove 'v' prefix if present
  const cleaned = version.replace(/^v/, '');
  // Extract just the major.minor.patch part (ignore pre-release suffixes)
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) {
    // Fall back to string comparison if parsing fails
    return a.localeCompare(b);
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major < parsedB.major ? -1 : 1;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor < parsedB.minor ? -1 : 1;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch < parsedB.patch ? -1 : 1;
  }
  return 0;
}

/**
 * Determine if updating from current to latest is a non-breaking update.
 * Per semver:
 * - Major version change = breaking
 * - Minor/patch version change = non-breaking
 *
 * @param currentVersion - Currently installed version
 * @param latestVersion - Latest available version
 * @returns True if the update is non-breaking (minor or patch)
 */
export function isNonBreakingUpdate(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);

  if (!current || !latest) {
    logger.warn('Failed to parse versions for comparison', {
      context: 'VersionChecker.isNonBreakingUpdate',
      currentVersion,
      latestVersion,
    });
    // When in doubt, treat as breaking to be safe
    return false;
  }

  // Major version change is breaking
  if (latest.major !== current.major) {
    return false;
  }

  // Same major version = non-breaking (minor or patch update)
  return true;
}

// ============================================================================
// NPM REGISTRY QUERIES
// ============================================================================

const NPM_TIMEOUT = 30000; // 30 seconds for npm queries

/**
 * Get the latest version of a package from npm registry
 *
 * @param packageName - npm package name
 * @returns Latest version string, or null if unable to fetch
 */
export async function getLatestVersion(packageName: string): Promise<string | null> {
  try {
    logger.debug('Checking npm for latest version', {
      context: 'VersionChecker.getLatestVersion',
      packageName,
    });

    const { stdout, stderr } = await execAsync(
      `npm view ${packageName} version --json`,
      {
        timeout: NPM_TIMEOUT,
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );

    if (stderr && stderr.includes('ERR!')) {
      logger.warn('npm view command failed', {
        context: 'VersionChecker.getLatestVersion',
        packageName,
        stderr,
      });
      return null;
    }

    // npm view returns the version as a JSON string (e.g., "1.2.3")
    const version = JSON.parse(stdout.trim());

    logger.debug('Found latest version', {
      context: 'VersionChecker.getLatestVersion',
      packageName,
      version,
    });

    return version;
  } catch (error) {
    // Handle common errors gracefully
    if (error instanceof Error) {
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        logger.warn('Timeout checking npm for package version', {
          context: 'VersionChecker.getLatestVersion',
          packageName,
        });
      } else if (error.message.includes('ENOTFOUND')) {
        logger.warn('Cannot reach npm registry', {
          context: 'VersionChecker.getLatestVersion',
          packageName,
        });
      } else if (error.message.includes('404') || error.message.includes('Not Found')) {
        logger.warn('Package not found on npm', {
          context: 'VersionChecker.getLatestVersion',
          packageName,
        });
      } else {
        logger.warn('Error checking npm for package version', {
          context: 'VersionChecker.getLatestVersion',
          packageName,
          error: error.message,
        });
      }
    }
    return null;
  }
}

// ============================================================================
// UPDATE CHECKING
// ============================================================================

/**
 * Check all npm-installed (site) plugins for available updates
 *
 * @returns Array of plugins with available updates and their version info
 */
export async function checkForUpdates(): Promise<PluginUpdateInfo[]> {
  // Check if auto-update is disabled via environment variable
  if (process.env.PLUGIN_AUTO_UPDATE === 'false') {
    logger.info('Plugin auto-update is disabled via PLUGIN_AUTO_UPDATE=false', {
      context: 'VersionChecker.checkForUpdates',
    });
    return [];
  }

  logger.info('Checking for plugin updates', {
    context: 'VersionChecker.checkForUpdates',
  });

  const updates: PluginUpdateInfo[] = [];

  try {
    // Only check site (npm-installed) plugins, not bundled ones
    const sitePlugins = await getInstalledPlugins('site');

    if (sitePlugins.length === 0) {
      logger.debug('No site plugins installed, skipping update check', {
        context: 'VersionChecker.checkForUpdates',
      });
      return [];
    }

    logger.info('Checking updates for site plugins', {
      context: 'VersionChecker.checkForUpdates',
      count: sitePlugins.length,
      plugins: sitePlugins.map(p => p.manifest.name),
    });

    // Check each plugin sequentially to avoid overwhelming npm
    for (const plugin of sitePlugins) {
      try {
        const packageName = plugin.manifest.name;
        const currentVersion = plugin.version;
        const latestVersion = await getLatestVersion(packageName);

        if (!latestVersion) {
          logger.debug('Could not fetch latest version for plugin', {
            context: 'VersionChecker.checkForUpdates',
            packageName,
          });
          continue;
        }

        // Check if an update is available
        if (compareVersions(latestVersion, currentVersion) > 0) {
          const updateInfo: PluginUpdateInfo = {
            packageName,
            currentVersion,
            latestVersion,
            isNonBreaking: isNonBreakingUpdate(currentVersion, latestVersion),
          };

          updates.push(updateInfo);

          logger.info('Update available for plugin', {
            context: 'VersionChecker.checkForUpdates',
            packageName,
            currentVersion,
            latestVersion,
            isNonBreaking: updateInfo.isNonBreaking,
          });
        } else {
          logger.debug('Plugin is up to date', {
            context: 'VersionChecker.checkForUpdates',
            packageName,
            currentVersion,
            latestVersion,
          });
        }
      } catch (error) {
        // Log but continue checking other plugins
        logger.warn('Error checking update for plugin', {
          context: 'VersionChecker.checkForUpdates',
          plugin: plugin.manifest.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Plugin update check complete', {
      context: 'VersionChecker.checkForUpdates',
      totalChecked: sitePlugins.length,
      updatesAvailable: updates.length,
      nonBreakingUpdates: updates.filter(u => u.isNonBreaking).length,
      breakingUpdates: updates.filter(u => !u.isNonBreaking).length,
    });

    return updates;
  } catch (error) {
    logger.error(
      'Failed to check for plugin updates',
      { context: 'VersionChecker.checkForUpdates' },
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}
