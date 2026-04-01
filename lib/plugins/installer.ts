/**
 * Plugin Installer
 *
 * Handles installation and uninstallation of plugins from npm registry.
 * All plugins are installed site-wide.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import { safeValidatePluginManifest, pluginRequiresRestart, type PluginManifest } from '@/lib/schemas/plugin-manifest';
import { isPluginCompatible } from './manifest-loader';
import { hotLoadProviderPlugin } from './provider-registry';
import { hotLoadSearchProviderPlugin } from './search-provider-registry';
import { hotLoadModerationProviderPlugin } from './moderation-provider-registry';
import { getNpmPluginsDir } from '@/lib/paths';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface InstallResult {
  success: boolean;
  error?: string;
  manifest?: PluginManifest;
  version?: string;
  /** Whether the plugin requires a server restart to activate */
  requiresRestart?: boolean;
}

export interface UninstallResult {
  success: boolean;
  error?: string;
}

export interface PluginRegistryEntry {
  name: string;
  version: string;
  installedAt: string;
  source: 'npm' | 'local';
}

export interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

export interface InstalledPluginInfo {
  name: string;
  version: string;
  source: 'bundled' | 'site';
  manifest: PluginManifest;
  installedAt?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PLUGINS_BASE_DIR = path.join(process.cwd(), 'plugins');
const PLUGINS_DIST_DIR = path.join(PLUGINS_BASE_DIR, 'dist');

/**
 * Get the npm plugins directory path
 * Uses the data directory for persistence across app updates
 */
function getPluginsNpmDir(): string {
  return getNpmPluginsDir();
}

// Regex for unscoped plugins: qtap-plugin-*
const UNSCOPED_PLUGIN_REGEX = /^qtap-plugin-[a-z0-9-]+$/;
// Regex for scoped plugins: @org/qtap-plugin-*
const SCOPED_PLUGIN_REGEX = /^@[a-z0-9-]+\/qtap-plugin-[a-z0-9-]+$/;
const NPM_INSTALL_TIMEOUT = 120000; // 2 minutes

/**
 * Check if a package name is a valid Quilltap plugin
 * Matches both unscoped (qtap-plugin-*) and scoped (@org/qtap-plugin-*) packages
 */
function isValidPluginName(name: string): boolean {
  return UNSCOPED_PLUGIN_REGEX.test(name) || SCOPED_PLUGIN_REGEX.test(name);
}

/**
 * Convert a scoped package name to a safe directory name
 * @org/qtap-plugin-foo -> @org--qtap-plugin-foo
 */
function packageNameToDir(packageName: string): string {
  if (packageName.startsWith('@')) {
    return packageName.replace('/', '--');
  }
  return packageName;
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
// INSTALLATION
// ============================================================================

/**
 * Installs a plugin from npm registry
 *
 * @param packageName - npm package name (must start with "qtap-plugin-")
 * @returns Installation result with manifest on success
 */
export async function installPluginFromNpm(
  packageName: string
): Promise<InstallResult> {
  logger.info('Starting plugin installation from npm', {
    context: 'PluginInstaller.installPluginFromNpm',
    packageName,
  });

  // Validate package name format (supports both scoped and unscoped)
  if (!isValidPluginName(packageName)) {
    logger.warn('Invalid package name format', {
      context: 'PluginInstaller.installPluginFromNpm',
      packageName,
    });
    return {
      success: false,
      error: 'Invalid package name. Must be qtap-plugin-* or @org/qtap-plugin-* with lowercase letters, numbers, and hyphens.'
    };
  }

  // All plugins are installed site-wide
  const pluginBaseDir = getPluginsNpmDir();

  // Convert scoped package names to safe directory names (@org/pkg -> @org--pkg)
  const safeDirName = packageNameToDir(packageName);
  const pluginDir = path.join(pluginBaseDir, safeDirName);
  try {
    // Check if already installed
    const alreadyExists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (alreadyExists) {
      logger.info('Plugin already installed, will update', {
        context: 'PluginInstaller.installPluginFromNpm',
        packageName,
      });
      // Remove existing to allow fresh install
      await fs.rm(pluginDir, { recursive: true, force: true });
    }

    // Create directory structure
    await fs.mkdir(pluginDir, { recursive: true });

    // Initialize wrapper package.json for npm install
    const wrapperPkg = {
      name: `${safeDirName}-wrapper`,
      version: '1.0.0',
      private: true,
      dependencies: {},
    };
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(wrapperPkg, null, 2)
    );
    // Install the plugin from npm
    const { stdout, stderr } = await execAsync(
      `npm install ${packageName} --save --legacy-peer-deps`,
      {
        cwd: pluginDir,
        timeout: NPM_INSTALL_TIMEOUT,
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );
    // Check for npm errors (warnings are ok)
    if (stderr && stderr.includes('ERR!')) {
      logger.error('npm install failed with error', {
        context: 'PluginInstaller.installPluginFromNpm',
        stderr,
      });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: `npm install failed: ${stderr.split('\n').find(l => l.includes('ERR!')) || stderr}` };
    }

    // Locate the installed package
    const installedPath = path.join(pluginDir, 'node_modules', packageName);
    const installedExists = await fs.access(installedPath).then(() => true).catch(() => false);

    if (!installedExists) {
      logger.error('Package not found after npm install', {
        context: 'PluginInstaller.installPluginFromNpm',
        installedPath,
      });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: 'Package installation failed - package not found after install' };
    }

    // Validate manifest exists
    const manifestPath = path.join(installedPath, 'manifest.json');
    const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);

    if (!manifestExists) {
      logger.error('Plugin missing manifest.json', {
        context: 'PluginInstaller.installPluginFromNpm',
        manifestPath,
      });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: 'Plugin does not contain a manifest.json - not a valid Quilltap plugin' };
    }

    // Load and validate manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    let manifestData: unknown;
    try {
      manifestData = JSON.parse(manifestContent);
    } catch {
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: 'Invalid JSON in manifest.json' };
    }

    const validation = safeValidatePluginManifest(manifestData);
    if (!validation.success) {
      logger.error('Manifest validation failed', {
        context: 'PluginInstaller.installPluginFromNpm',
        errors: validation.errors.issues,
      });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return {
        success: false,
        error: `Invalid manifest: ${validation.errors.issues.map(i => i.message).join(', ')}`,
      };
    }

    const manifest = validation.data;

    // Check Quilltap version compatibility
    const quilltapPkg = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    const quilltapVersion = JSON.parse(quilltapPkg).version;

    if (!isPluginCompatible(manifest, quilltapVersion)) {
      logger.warn('Plugin version incompatible', {
        context: 'PluginInstaller.installPluginFromNpm',
        required: manifest.compatibility.quilltapVersion,
        current: quilltapVersion,
      });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return {
        success: false,
        error: `Plugin requires Quilltap ${manifest.compatibility.quilltapVersion}, but you have ${quilltapVersion}`,
      };
    }

    // Get version from installed package.json
    let installedVersion = manifest.version;
    try {
      const pkgJson = await fs.readFile(path.join(installedPath, 'package.json'), 'utf-8');
      installedVersion = JSON.parse(pkgJson).version || manifest.version;
    } catch {
      // Use manifest version as fallback
    }

    // Update registry
    await updateRegistry(pluginBaseDir, {
      name: packageName,
      version: installedVersion,
      installedAt: new Date().toISOString(),
      source: 'npm',
    });

    // Attempt to hot-load provider plugins so they're available immediately
    let hotLoaded = false;
    if (manifest.capabilities.includes('LLM_PROVIDER')) {
      hotLoaded = hotLoadProviderPlugin(installedPath, manifest);
      if (hotLoaded) {
        logger.info('LLM provider plugin hot-loaded successfully', {
          context: 'PluginInstaller.installPluginFromNpm',
          packageName,
        });
      }
    }

    if (manifest.capabilities.includes('SEARCH_PROVIDER')) {
      const searchHotLoaded = hotLoadSearchProviderPlugin(installedPath, manifest);
      if (searchHotLoaded) {
        hotLoaded = true;
        logger.info('Search provider plugin hot-loaded successfully', {
          context: 'PluginInstaller.installPluginFromNpm',
          packageName,
        });
      }
    }

    if (manifest.capabilities.includes('MODERATION_PROVIDER')) {
      const moderationHotLoaded = hotLoadModerationProviderPlugin(installedPath, manifest);
      if (moderationHotLoaded) {
        hotLoaded = true;
        logger.info('Moderation provider plugin hot-loaded successfully', {
          context: 'PluginInstaller.installPluginFromNpm',
          packageName,
        });
      }
    }

    // If we hot-loaded the provider, no restart is needed for LLM_PROVIDER capability
    const requiresRestart = hotLoaded ? false : pluginRequiresRestart(manifest);

    logger.info('Plugin installed successfully', {
      context: 'PluginInstaller.installPluginFromNpm',
      packageName,
      version: installedVersion,
      requiresRestart,
      hotLoaded,
    });

    return { success: true, manifest, version: installedVersion, requiresRestart };

  } catch (error) {
    logger.error(
      'Plugin installation failed',
      { context: 'PluginInstaller.installPluginFromNpm', packageName },
      error instanceof Error ? error : new Error(String(error))
    );

    // Cleanup on failure
    await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});

    if (error instanceof Error) {
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        return { success: false, error: 'Installation timed out - please try again' };
      }
      if (error.message.includes('ENOTFOUND')) {
        return { success: false, error: 'Could not reach npm registry - check your internet connection' };
      }
      return { success: false, error: error.message };
    }

    return { success: false, error: 'Unknown error during installation' };
  }
}

// ============================================================================
// UNINSTALLATION
// ============================================================================

/**
 * Uninstalls a plugin
 *
 * @param packageName - Plugin package name
 * @returns Uninstall result
 */
export async function uninstallPlugin(
  packageName: string
): Promise<UninstallResult> {
  logger.info('Uninstalling plugin', {
    context: 'PluginInstaller.uninstallPlugin',
    packageName,
  });

  // Validate package name (supports both scoped and unscoped)
  if (!isValidPluginName(packageName)) {
    return { success: false, error: 'Invalid package name. Must be qtap-plugin-* or @org/qtap-plugin-*' };
  }

  // All plugins are in the site directory
  const pluginBaseDir = getPluginsNpmDir();

  // Convert scoped package names to safe directory names
  const safeDirName = packageNameToDir(packageName);
  const pluginDir = path.join(pluginBaseDir, safeDirName);

  try {
    // Check if plugin exists
    const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (!exists) {
      return { success: false, error: 'Plugin not found' };
    }

    // Remove the plugin directory
    await fs.rm(pluginDir, { recursive: true, force: true });

    // Update registry
    await removeFromRegistry(pluginBaseDir, packageName);

    logger.info('Plugin uninstalled successfully', {
      context: 'PluginInstaller.uninstallPlugin',
      packageName,
    });

    return { success: true };

  } catch (error) {
    logger.error(
      'Plugin uninstall failed',
      { context: 'PluginInstaller.uninstallPlugin', packageName },
      error instanceof Error ? error : new Error(String(error))
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// PLUGIN LISTING
// ============================================================================

/**
 * Gets all installed plugins
 *
 * @param scope - Filter by scope ('all', 'bundled', 'site')
 * @returns List of installed plugins with their info
 */
export async function getInstalledPlugins(
  scope: 'all' | 'bundled' | 'site' = 'all'
): Promise<InstalledPluginInfo[]> {
  const plugins: InstalledPluginInfo[] = [];

  // Bundled plugins
  if (scope === 'all' || scope === 'bundled') {
    const bundled = await scanPluginDirectory(PLUGINS_DIST_DIR, 'bundled');
    plugins.push(...bundled);
  }

  // Site plugins
  if (scope === 'all' || scope === 'site') {
    const site = await scanPluginDirectory(getPluginsNpmDir(), 'site');
    plugins.push(...site);
  }

  return plugins;
}

/**
 * Checks if a plugin is installed
 *
 * @param packageName - Plugin package name
 * @returns True if installed in any scope
 */
export async function isPluginInstalled(
  packageName: string
): Promise<{ installed: boolean; scope?: 'bundled' | 'site' }> {
  // Convert scoped package names to safe directory names for path lookups
  const safeDirName = packageNameToDir(packageName);

  // Check bundled (bundled plugins use package name directly as directory)
  const bundledPath = path.join(PLUGINS_DIST_DIR, packageName, 'manifest.json');
  if (await fs.access(bundledPath).then(() => true).catch(() => false)) {
    return { installed: true, scope: 'bundled' };
  }

  // Check site (npm-installed plugins use safe directory name, but node_modules uses package name)
  const sitePath = path.join(getPluginsNpmDir(), safeDirName, 'node_modules', packageName, 'manifest.json');
  if (await fs.access(sitePath).then(() => true).catch(() => false)) {
    return { installed: true, scope: 'site' };
  }

  return { installed: false };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Scans a plugin directory for installed plugins
 */
async function scanPluginDirectory(
  baseDir: string,
  source: 'bundled' | 'site'
): Promise<InstalledPluginInfo[]> {
  const plugins: InstalledPluginInfo[] = [];

  try {
    const dirExists = await fs.access(baseDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return plugins;
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });

    // Load registry for installation dates
    let registry: PluginRegistry = { plugins: [] };
    if (source !== 'bundled') {
      try {
        const registryPath = path.join(baseDir, 'registry.json');
        const content = await fs.readFile(registryPath, 'utf-8');
        registry = JSON.parse(content);
      } catch {
        // Registry doesn't exist yet
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check for valid plugin directory names:
      // - Unscoped: qtap-plugin-*
      // - Scoped (converted): @org--qtap-plugin-*
      const isUnscopedPlugin = entry.name.startsWith('qtap-plugin-');
      const isScopedPlugin = entry.name.startsWith('@') && entry.name.includes('--qtap-plugin-');
      if (!isUnscopedPlugin && !isScopedPlugin) continue;

      // Convert directory name back to package name for scoped packages
      const packageName = dirToPackageName(entry.name);
      let pluginPath = path.join(baseDir, entry.name);

      // For npm-installed plugins, the actual plugin is in node_modules
      // node_modules uses the actual package name (with /), not the safe directory name
      if (source !== 'bundled') {
        const npmPath = path.join(pluginPath, 'node_modules', packageName);
        const npmExists = await fs.access(npmPath).then(() => true).catch(() => false);
        if (npmExists) {
          pluginPath = npmPath;
        }
      }

      const manifestPath = path.join(pluginPath, 'manifest.json');
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifestData = JSON.parse(manifestContent);
        const validation = safeValidatePluginManifest(manifestData);

        if (!validation.success) {
          logger.warn('Invalid plugin manifest during scan', {
            context: 'PluginInstaller.scanPluginDirectory',
            plugin: entry.name,
            errors: validation.errors.issues,
          });
          continue;
        }

        // Get version from package.json if available
        let version = validation.data.version;
        try {
          const pkgJson = await fs.readFile(path.join(pluginPath, 'package.json'), 'utf-8');
          version = JSON.parse(pkgJson).version || version;
        } catch {
          // Use manifest version
        }

        // Find installation date from registry (uses package name, not directory name)
        const registryEntry = registry.plugins.find(p => p.name === packageName);

        plugins.push({
          name: validation.data.name,
          version,
          source,
          manifest: validation.data,
          installedAt: registryEntry?.installedAt,
        });

      } catch (error) {
        logger.warn('Failed to load plugin manifest', {
          context: 'PluginInstaller.scanPluginDirectory',
          plugin: entry.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
  }

  return plugins;
}

/**
 * Updates the plugin registry with a new entry
 */
async function updateRegistry(
  baseDir: string,
  plugin: PluginRegistryEntry
): Promise<void> {
  const registryPath = path.join(baseDir, 'registry.json');

  let registry: PluginRegistry = { plugins: [] };
  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    registry = JSON.parse(content);
  } catch {
    // Registry doesn't exist yet
  }

  // Remove existing entry for this plugin if any
  registry.plugins = registry.plugins.filter(p => p.name !== plugin.name);
  registry.plugins.push(plugin);

  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Removes a plugin from the registry
 */
async function removeFromRegistry(
  baseDir: string,
  packageName: string
): Promise<void> {
  const registryPath = path.join(baseDir, 'registry.json');

  let registry: PluginRegistry = { plugins: [] };
  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    registry = JSON.parse(content);
  } catch {
    return; // Registry doesn't exist
  }

  const previousCount = registry.plugins.length;
  registry.plugins = registry.plugins.filter(p => p.name !== packageName);

  if (registry.plugins.length !== previousCount) {
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  getPluginsNpmDir,
  PLUGINS_DIST_DIR,
};
