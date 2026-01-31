/**
 * Plugin Manifest Loader
 *
 * Utilities for loading and validating plugin manifests from the filesystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import {
  PluginManifest,
  validatePluginManifest,
  safeValidatePluginManifest,
  functionalityToCapabilities,
  type PluginCapability,
} from '@/lib/schemas/plugin-manifest';
import { isSitePluginEnabled } from './site-plugins';
import { getNpmPluginsDir } from '@/lib/paths';

// ============================================================================
// TYPES
// ============================================================================

export type PluginSource = 'included' | 'npm' | 'git' | 'manual';

export interface LoadedPlugin {
  manifest: PluginManifest;
  pluginPath: string;
  manifestPath: string;
  enabled: boolean;
  capabilities: PluginCapability[];
  source: PluginSource;
  /** Version from package.json (preferred for display) */
  packageVersion?: string;
  /** Package name from package.json (for npm packages, may be scoped like @org/name) */
  packageName?: string;
}

export interface PluginLoadError {
  pluginName: string;
  pluginPath: string;
  error: string;
  details?: unknown;
}

export interface PluginScanResult {
  plugins: LoadedPlugin[];
  errors: PluginLoadError[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const PLUGINS_DIST_DIR = path.join(process.cwd(), 'plugins', 'dist');
const MANIFEST_FILENAME = 'manifest.json';

/**
 * Get the npm plugins directory path
 * Uses the data directory for persistence across app updates
 */
function getPluginsNpmDir(): string {
  return getNpmPluginsDir();
}

/**
 * Check if a directory name is a valid plugin directory
 * Handles both unscoped (qtap-plugin-*) and scoped (@org--qtap-plugin-*) directories
 */
function isPluginDirectoryName(dirName: string): boolean {
  // Unscoped: qtap-plugin-openai
  if (dirName.startsWith('qtap-plugin-')) return true;
  // Scoped (converted): @quilltap--qtap-plugin-gab-ai
  if (dirName.startsWith('@') && dirName.includes('--qtap-plugin-')) return true;
  return false;
}

/**
 * Check if a package name is a valid Quilltap plugin
 * Handles both unscoped (qtap-plugin-*) and scoped (@org/qtap-plugin-*) packages
 */
function isQuilltapPlugin(name: string): boolean {
  if (name.startsWith('qtap-plugin-')) return true;
  if (name.startsWith('@') && name.includes('/qtap-plugin-')) return true;
  return false;
}

/**
 * Convert a directory name back to a package name
 * @org--qtap-plugin-foo -> @org/qtap-plugin-foo
 */
function dirToPackageName(dirName: string): string {
  if (dirName.startsWith('@') && dirName.includes('--')) {
    return dirName.replace('--', '/');
  }
  return dirName;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Reads the version from a plugin's package.json
 * @param pluginPath - Path to the plugin directory
 * @returns Version string or undefined if not found
 */
async function getPackageVersion(pluginPath: string): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return undefined;
  }
}

/**
 * Get the package name from package.json
 * @param pluginPath - Path to the plugin directory
 * @returns Package name (may be scoped like @org/name) or undefined
 */
async function getPackageName(pluginPath: string): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    return packageJson.name;
  } catch {
    return undefined;
  }
}

/**
 * Determines the source of a plugin based on its path and package.json
 * @param pluginPath - Path to the plugin directory
 * @returns Plugin source type
 */
async function determinePluginSource(pluginPath: string): Promise<PluginSource> {
  // Check if plugin is in plugins/dist (included with Quilltap)
  if (pluginPath.includes(path.join('plugins', 'dist'))) {
    return 'included';
  }

  // Check if plugin is in a node_modules directory (npm-installed)
  // This takes precedence over git repository detection since npm packages
  // often have repository fields in their package.json
  if (pluginPath.includes('node_modules')) {
    return 'npm';
  }

  // Check for package.json to determine source
  try {
    const packageJsonPath = path.join(pluginPath, 'package.json');
    await fs.access(packageJsonPath);

    // Read package.json to check for repository info
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    // If it has a valid plugin name and version, likely from npm
    if (packageJson.name && isQuilltapPlugin(packageJson.name) && packageJson.version) {
      return 'npm';
    }

    // If it has a git repository, it's from git (cloned directly)
    if (packageJson.repository) {
      const repoUrl = typeof packageJson.repository === 'string'
        ? packageJson.repository
        : packageJson.repository.url;

      if (repoUrl && (repoUrl.includes('git') || repoUrl.includes('github') || repoUrl.includes('gitlab'))) {
        return 'git';
      }
    }

    return 'manual';
  } catch {
    // No package.json or can't read it = manual installation
    return 'manual';
  }
}

// ============================================================================
// MANIFEST LOADING
// ============================================================================

/**
 * Loads and validates a plugin manifest from a file
 * @param manifestPath - Path to the manifest.json file
 * @returns Validated manifest or null if invalid
 */
export async function loadPluginManifest(manifestPath: string): Promise<PluginManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    return validatePluginManifest(data);
  } catch (error) {
    logger.error('Failed to load plugin manifest:', { manifestPath, error });
    return null;
  }
}

/**
 * Loads a plugin manifest with detailed error information
 * @param manifestPath - Path to the manifest.json file
 * @returns Success or error result
 */
export async function loadPluginManifestSafe(manifestPath: string): Promise<
  | { success: true; manifest: PluginManifest }
  | { success: false; error: string; details?: unknown }
> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);

    const result = safeValidatePluginManifest(data);
    if (result.success) {
      return { success: true, manifest: result.data };
    }

    return {
      success: false,
      error: 'Manifest validation failed',
      details: result.errors.issues,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'Invalid JSON in manifest file',
        details: error.message,
      };
    }

    return {
      success: false,
      error: 'Failed to read manifest file',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// PLUGIN DISCOVERY
// ============================================================================

/**
 * Checks if a directory is a valid plugin directory
 * @param dirPath - Path to check
 * @returns True if the directory contains a valid plugin
 */
async function isPluginDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) return false;

    const manifestPath = path.join(dirPath, MANIFEST_FILENAME);
    const manifestStat = await fs.stat(manifestPath);
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

/**
 * Scans plugin directories for all installed plugins
 * Searches in the plugins/dist directory and data directory plugins/npm
 * @param pluginsDir - Base plugins directory (defaults to ./plugins)
 * @returns Scan results with loaded plugins and errors
 */
export async function scanPlugins(
  pluginsDir: string = PLUGINS_DIR
): Promise<PluginScanResult> {
  const result: PluginScanResult = {
    plugins: [],
    errors: [],
  };

  // Helper function to scan a single directory
  // isNpmInstalled indicates if plugins in this directory are npm-installed (manifest in node_modules)
  const scanDirectory = async (dirPath: string, isNpmInstalled: boolean = false) => {
    try {
      // Check if directory exists, create only for standard directories
      const dirExists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!dirExists) {
        // Only create site directory automatically
        if (dirPath === getPluginsNpmDir()) {
          await fs.mkdir(dirPath, { recursive: true });
        } else {
          return; // Skip non-existent directories
        }
      }

      // Read all entries in directory
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      // Process each potential plugin directory
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip non-plugin directories (handles both unscoped and scoped directory names)
        if (!isPluginDirectoryName(entry.name)) continue;
        // Skip special directories
        if (entry.name === 'registry.json') continue;

        // Convert directory name back to package name for scoped packages
        const packageName = dirToPackageName(entry.name);

        let pluginPath = path.join(dirPath, entry.name);
        let manifestPath = path.join(pluginPath, MANIFEST_FILENAME);

        // For npm-installed plugins, check inside node_modules
        // node_modules uses the actual package name (with /), not the safe directory name
        if (isNpmInstalled) {
          const npmPluginPath = path.join(pluginPath, 'node_modules', packageName);
          const npmManifestPath = path.join(npmPluginPath, MANIFEST_FILENAME);
          const npmExists = await fs.access(npmManifestPath).then(() => true).catch(() => false);
          if (npmExists) {
            pluginPath = npmPluginPath;
            manifestPath = npmManifestPath;
          }
        }

        // Skip if not a plugin directory
        if (!(await isPluginDirectory(pluginPath))) {
          continue;
        }

        // Load and validate manifest
        const loadResult = await loadPluginManifestSafe(manifestPath);

        if (!loadResult.success) {
          result.errors.push({
            pluginName: entry.name,
            pluginPath,
            error: loadResult.error,
            details: loadResult.details,
          });
          continue;
        }

        const manifest = loadResult.manifest;

        // Check if plugin is enabled by site configuration
        const siteEnabled = isSitePluginEnabled(manifest.name);
        if (!siteEnabled) {
          continue;
        }

        // Get capabilities from manifest
        const capabilities = [...manifest.capabilities];

        // Determine plugin source and get package info
        const source = await determinePluginSource(pluginPath);
        const packageVersion = await getPackageVersion(pluginPath);
        const npmPackageName = await getPackageName(pluginPath);

        result.plugins.push({
          manifest,
          pluginPath,
          manifestPath,
          enabled: manifest.enabledByDefault ?? false,
          capabilities,
          source,
          packageVersion,
          packageName: npmPackageName,
        });
      }
    } catch (error) {
    }
  };

  // Scan top-level plugins directory (legacy, for backward compatibility)
  await scanDirectory(pluginsDir);

  // Scan plugins/dist directory (bundled plugins)
  await scanDirectory(PLUGINS_DIST_DIR);

  // Scan data directory plugins/npm (site-wide npm-installed plugins)
  await scanDirectory(getPluginsNpmDir(), true);

  return result;
}

/**
 * Loads a specific plugin by name
 * Searches in plugins/dist and data directory plugins/npm
 * @param pluginName - Name of the plugin (directory name)
 * @param pluginsDir - Base plugins directory (defaults to ./plugins)
 * @returns Loaded plugin or null if not found/invalid
 */
export async function loadPlugin(
  pluginName: string,
  pluginsDir: string = PLUGINS_DIR
): Promise<LoadedPlugin | null> {
  // Convert scoped package names to safe directory names for filesystem lookup
  // @quilltap/qtap-plugin-gab-ai -> @quilltap--qtap-plugin-gab-ai
  const safeDirName = pluginName.startsWith('@') && pluginName.includes('/')
    ? pluginName.replace('/', '--')
    : pluginName;

  // Helper to try loading from a path
  const tryLoadFromPath = async (basePath: string, isNpmInstalled: boolean): Promise<{
    pluginPath: string;
    manifestPath: string;
  } | null> => {
    let pluginPath = path.join(basePath, safeDirName);
    let manifestPath = path.join(pluginPath, MANIFEST_FILENAME);

    // For npm-installed plugins, check inside node_modules
    // node_modules uses the actual package name (with /), not the safe directory name
    if (isNpmInstalled) {
      const npmPluginPath = path.join(pluginPath, 'node_modules', pluginName);
      const npmManifestPath = path.join(npmPluginPath, MANIFEST_FILENAME);
      const npmExists = await fs.access(npmManifestPath).then(() => true).catch(() => false);
      if (npmExists) {
        pluginPath = npmPluginPath;
        manifestPath = npmManifestPath;
      }
    }

    if (await isPluginDirectory(pluginPath)) {
      return { pluginPath, manifestPath };
    }
    return null;
  };

  // Search order: dist (bundled) > site > top-level (legacy)
  const searchPaths: Array<{ path: string; isNpm: boolean }> = [
    { path: PLUGINS_DIST_DIR, isNpm: false },
    { path: getPluginsNpmDir(), isNpm: true },
    { path: pluginsDir, isNpm: false },
  ];

  let foundPath: { pluginPath: string; manifestPath: string } | null = null;

  for (const { path: searchPath, isNpm } of searchPaths) {
    foundPath = await tryLoadFromPath(searchPath, isNpm);
    if (foundPath) break;
  }

  if (!foundPath) {
    logger.warn('Plugin directory not found or invalid:', { pluginName });
    return null;
  }

  const { pluginPath, manifestPath } = foundPath;

  const loadResult = await loadPluginManifestSafe(manifestPath);
  if (!loadResult.success) {
    logger.error('Failed to load plugin:', {
      pluginName,
      error: loadResult.error,
      details: loadResult.details,
    });
    return null;
  }

  const manifest = loadResult.manifest;

  // Get capabilities from manifest
  const capabilities = [...manifest.capabilities];

  // Determine plugin source and get package version
  const source = await determinePluginSource(pluginPath);
  const packageVersion = await getPackageVersion(pluginPath);

  return {
    manifest,
    pluginPath,
    manifestPath,
    enabled: manifest.enabledByDefault ?? false,
    capabilities,
    source,
    packageVersion,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Checks if a plugin meets minimum version requirements
 * @param manifest - Plugin manifest
 * @param quilltapVersion - Current Quilltap version
 * @returns True if compatible
 */
export function isPluginCompatible(
  manifest: PluginManifest,
  quilltapVersion: string
): boolean {
  // Simple semver check - in production, use a proper semver library
  const parseVersion = (v: string): number[] => {
    const match = new RegExp(/(\d+)\.(\d+)\.(\d+)/).exec(v);
    return match ? [Number.parseInt(match[1]), Number.parseInt(match[2]), Number.parseInt(match[3])] : [0, 0, 0];
  };

  const current = parseVersion(quilltapVersion);
  const minMatch = new RegExp(/>=?(.+)/).exec(manifest.compatibility.quilltapVersion);
  const maxMatch = manifest.compatibility.quilltapMaxVersion?.match(/<=?(.+)/);

  if (minMatch) {
    const min = parseVersion(minMatch[1]);
    for (let i = 0; i < 3; i++) {
      if (current[i] < min[i]) return false;
      if (current[i] > min[i]) break;
    }
  }

  if (maxMatch) {
    const max = parseVersion(maxMatch[1]);
    for (let i = 0; i < 3; i++) {
      if (current[i] > max[i]) return false;
      if (current[i] < max[i]) break;
    }
  }

  return true;
}

/**
 * Validates plugin permissions against security policy
 * @param manifest - Plugin manifest
 * @returns Array of security warnings/errors
 */
export function validatePluginSecurity(manifest: PluginManifest): string[] {
  const warnings: string[] = [];

  if (!manifest.sandboxed) {
    warnings.push('Plugin runs without sandboxing - security risk');
  }

  if (manifest.permissions?.userData) {
    warnings.push('Plugin requests access to user data');
  }

  if (manifest.permissions?.database) {
    warnings.push('Plugin requests database access');
  }

  if (manifest.permissions?.network && manifest.permissions.network.length > 0) {
    warnings.push(`Plugin requests network access to: ${manifest.permissions.network.join(', ')}`);
  }

  if (manifest.permissions?.fileSystem && manifest.permissions.fileSystem.length > 0) {
    warnings.push(`Plugin requests file system access to: ${manifest.permissions.fileSystem.join(', ')}`);
  }

  return warnings;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  PLUGINS_DIR,
  PLUGINS_DIST_DIR,
  getPluginsNpmDir,
  MANIFEST_FILENAME,
};
