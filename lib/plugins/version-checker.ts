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

/**
 * Enhanced plugin update info with additional metadata for UI display
 */
export interface EnhancedPluginUpdateInfo extends PluginUpdateInfo {
  /** Display title from plugin manifest */
  pluginTitle: string;
  /** Plugin description from manifest */
  pluginDescription?: string;
  /** Plugin homepage URL */
  homepage?: string;
  /** Normalized repository URL (GitHub, GitLab, etc.) */
  repository?: string;
  /** npm package URL */
  npmUrl: string;
  /** Changelog URL derived from repository */
  changelogUrl?: string;
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
    return [];
  }

  const updates: PluginUpdateInfo[] = [];

  try {
    // Only check site (npm-installed) plugins, not bundled ones
    const sitePlugins = await getInstalledPlugins('site');

    if (sitePlugins.length === 0) {
      return [];
    }

    // Check each plugin sequentially to avoid overwhelming npm
    for (const plugin of sitePlugins) {
      try {
        const packageName = plugin.manifest.name;
        const currentVersion = plugin.version;
        const latestVersion = await getLatestVersion(packageName);

        if (!latestVersion) {
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

// ============================================================================
// ENHANCED UPDATE CHECKING (WITH METADATA)
// ============================================================================

/**
 * Normalize a repository URL to a clean HTTPS URL
 * Handles various formats: git+https://, git://, ssh://, and object forms
 */
function normalizeRepositoryUrl(repository: unknown): string | undefined {
  if (!repository) return undefined;

  let url: string;

  if (typeof repository === 'string') {
    url = repository;
  } else if (typeof repository === 'object' && repository !== null) {
    const repo = repository as { url?: string };
    if (repo.url) {
      url = repo.url;
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  // Remove git+ prefix
  url = url.replace(/^git\+/, '');

  // Convert git:// to https://
  url = url.replace(/^git:\/\//, 'https://');

  // Convert SSH format to HTTPS
  url = url.replace(/^git@github\.com:/, 'https://github.com/');
  url = url.replace(/^git@gitlab\.com:/, 'https://gitlab.com/');
  url = url.replace(/^git@bitbucket\.org:/, 'https://bitbucket.org/');

  // Remove .git suffix
  url = url.replace(/\.git$/, '');

  return url;
}

/**
 * Derive a changelog URL from a repository URL
 * Returns the releases page for GitHub, etc.
 */
function deriveChangelogUrl(repositoryUrl: string | undefined): string | undefined {
  if (!repositoryUrl) return undefined;

  // GitHub: use releases page
  if (repositoryUrl.includes('github.com')) {
    return `${repositoryUrl}/releases`;
  }

  // GitLab: use -/releases
  if (repositoryUrl.includes('gitlab.com')) {
    return `${repositoryUrl}/-/releases`;
  }

  // Bitbucket: use downloads
  if (repositoryUrl.includes('bitbucket.org')) {
    return `${repositoryUrl}/downloads`;
  }

  return undefined;
}

/**
 * Check for plugin updates with enhanced metadata for UI display
 *
 * This function extends checkForUpdates() by adding plugin title, description,
 * homepage, repository URL, npm URL, and derived changelog URL for each update.
 *
 * @returns Array of enhanced plugin update info with metadata
 */
export async function checkForUpdatesWithMetadata(): Promise<EnhancedPluginUpdateInfo[]> {
  try {
    // Get basic update info
    const updates = await checkForUpdates();

    if (updates.length === 0) {
      return [];
    }

    // Get installed plugins to enrich with metadata
    const sitePlugins = await getInstalledPlugins('site');
    const pluginMap = new Map(sitePlugins.map(p => [p.manifest.name, p]));

    // Enrich each update with metadata
    const enhancedUpdates: EnhancedPluginUpdateInfo[] = updates.map(update => {
      const pluginInfo = pluginMap.get(update.packageName);
      const manifest = pluginInfo?.manifest;

      // Build npm URL
      const npmUrl = `https://www.npmjs.com/package/${encodeURIComponent(update.packageName)}`;

      // Normalize repository URL
      const repository = normalizeRepositoryUrl(manifest?.repository);

      // Derive changelog URL from repository
      const changelogUrl = deriveChangelogUrl(repository);

      // Get homepage, fallback to repository if not specified
      const homepage = manifest?.homepage || repository;

      const enhanced: EnhancedPluginUpdateInfo = {
        ...update,
        pluginTitle: manifest?.title || update.packageName,
        pluginDescription: manifest?.description,
        homepage,
        repository,
        npmUrl,
        changelogUrl,
      };

      return enhanced;
    });

    return enhancedUpdates;
  } catch (error) {
    logger.error(
      'Failed to check for plugin updates with metadata',
      { context: 'VersionChecker.checkForUpdatesWithMetadata' },
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}
