/**
 * Server-side plugin initialization
 *
 * Handles scanning and loading plugins on application startup.
 * TypeScript plugins must be pre-built before the app starts
 * (run `npm run build:plugins` to build all plugins).
 */

import { logger } from '@/lib/logger';
import { scanPlugins, isPluginCompatible, validatePluginSecurity } from '@/lib/plugins/manifest-loader';
import { pluginRegistry } from '@/lib/plugins/registry';
import { registerPluginRoutes, getPluginRouteRegistry, pluginRouteRegistry } from '@/lib/plugins/route-loader';
import { initializeProviderRegistry } from '@/lib/plugins/provider-registry';
import { registerAuthProvider, clearAuthProviders } from '@/lib/plugins/auth-provider-registry';
import type { AuthProviderPluginExport } from '@/lib/plugins/interfaces/auth-provider-plugin';
import { initializeThemeRegistry, themeRegistry } from '@/lib/themes/theme-registry';
import packageJson from '@/package.json';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Create a require function that bypasses Next.js bundling for dynamic plugin loading
const dynamicRequire = createRequire(import.meta.url || __filename);

// ============================================================================
// CONSTANTS
// ============================================================================

const UPGRADE_PLUGIN_NAME = 'qtap-plugin-upgrade';

// ============================================================================
// TYPES
// ============================================================================

export interface PluginInitializationResult {
  success: boolean;
  stats: {
    total: number;
    enabled: number;
    disabled: number;
    errors: number;
  };
  warnings: Array<{
    plugin: string;
    warnings: string[];
  }>;
  errors: Array<{
    plugin: string;
    error: string;
  }>;
}

// ============================================================================
// INITIALIZATION STATE
// ============================================================================

let initializationPromise: Promise<PluginInitializationResult> | null = null;
let initialized = false;

/**
 * Run upgrade migrations from the upgrade plugin
 *
 * This function:
 * 1. Force-enables the upgrade plugin (it should always run)
 * 2. Loads and runs all pending migrations
 * 3. Disables the upgrade plugin after migrations complete
 *
 * This happens early in initialization, before provider plugins are loaded,
 * so that data migrations can enable provider plugins as needed.
 */
async function runUpgradeMigrations(): Promise<void> {
  const upgradePlugin = pluginRegistry.get(UPGRADE_PLUGIN_NAME);
  if (!upgradePlugin) {
    logger.debug('Upgrade plugin not found, skipping migrations');
    return;
  }

  // Force-enable the upgrade plugin regardless of its manifest setting
  if (!upgradePlugin.enabled) {
    pluginRegistry.enable(UPGRADE_PLUGIN_NAME);
    logger.debug('Force-enabled upgrade plugin for migrations');
  }

  try {
    // Load the upgrade plugin using require() - plugins are transpiled to JS first
    const mainFile = upgradePlugin.manifest.main || 'index.js';
    const modulePath = resolve(process.cwd(), upgradePlugin.pluginPath, mainFile);

    logger.info('Loading upgrade plugin for migrations', {
      plugin: UPGRADE_PLUGIN_NAME,
      path: modulePath,
    });

    // Use require() to load the compiled JavaScript module
    const pluginModule = dynamicRequire(modulePath);
    const plugin = pluginModule?.plugin || pluginModule?.default?.plugin || pluginModule?.default;

    if (!plugin || typeof plugin.runMigrations !== 'function') {
      logger.warn('Upgrade plugin does not export runMigrations function', {
        plugin: UPGRADE_PLUGIN_NAME,
        exports: Object.keys(pluginModule),
      });
      return;
    }

    // Run all pending migrations
    const result = await plugin.runMigrations();

    if (result.success) {
      logger.info('Upgrade migrations completed', {
        migrationsRun: result.migrationsRun,
        migrationsSkipped: result.migrationsSkipped,
        totalDurationMs: result.totalDurationMs,
      });
    } else {
      logger.error('Upgrade migrations failed', {
        results: result.results,
      });
    }

    // Disable the upgrade plugin after migrations are done
    // It doesn't need to run again until the next startup
    pluginRegistry.disable(UPGRADE_PLUGIN_NAME);
    logger.debug('Disabled upgrade plugin after migrations');

  } catch (error) {
    logger.error('Failed to run upgrade migrations', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Initialize the plugin system
 * This function is idempotent - multiple calls will return the same promise
 */
export async function initializePlugins(): Promise<PluginInitializationResult> {
  // If already initialized, return existing result
  if (initialized) {
    logger.debug('Plugin system already initialized');
    return {
      success: true,
      stats: pluginRegistry.getStats(),
      warnings: [],
      errors: pluginRegistry.getErrors(),
    };
  }

  // If initialization is in progress, return the existing promise
  if (initializationPromise) {
    logger.debug('Plugin initialization already in progress');
    return initializationPromise;
  }

  // Start new initialization
  initializationPromise = performInitialization();
  return initializationPromise;
}

/**
 * Perform the actual initialization
 */
async function performInitialization(): Promise<PluginInitializationResult> {
  const startTime = Date.now();
  logger.info('Starting plugin system initialization');

  const result: PluginInitializationResult = {
    success: false,
    stats: {
      total: 0,
      enabled: 0,
      disabled: 0,
      errors: 0,
    },
    warnings: [],
    errors: [],
  };

  try {
    // Scan for plugins
    const scanResult = await scanPlugins();

    // Store errors from scan
    result.errors = scanResult.errors.map(err => ({
      plugin: err.pluginName,
      error: err.error,
    }));

    // Validate plugins
    const quilltapVersion = packageJson.version;
    const validatedPlugins = [];

    for (const plugin of scanResult.plugins) {
      const pluginName = plugin.manifest.name;

      // Check version compatibility
      if (!isPluginCompatible(plugin.manifest, quilltapVersion)) {
        result.errors.push({
          plugin: pluginName,
          error: `Incompatible with Quilltap ${quilltapVersion}. Requires: ${plugin.manifest.compatibility.quilltapVersion}`,
        });
        logger.warn('Plugin incompatible with current version', {
          plugin: pluginName,
          required: plugin.manifest.compatibility.quilltapVersion,
          current: quilltapVersion,
        });
        continue;
      }

      // Check security warnings
      const securityWarnings = validatePluginSecurity(plugin.manifest);
      if (securityWarnings.length > 0) {
        result.warnings.push({
          plugin: pluginName,
          warnings: securityWarnings,
        });
        logger.warn('Plugin security warnings', {
          plugin: pluginName,
          warnings: securityWarnings,
        });
      }

      validatedPlugins.push(plugin);
    }

    // Initialize registry with validated plugins
    await pluginRegistry.initialize({
      plugins: validatedPlugins,
      errors: result.errors.map(e => ({
        pluginName: e.plugin,
        pluginPath: '',
        error: e.error,
      })),
    });

    // Verify that TypeScript plugins have been pre-built
    // Plugins must be built before starting the app (npm run build:plugins)
    const typescriptPlugins = validatedPlugins
      .filter(p => p.manifest.typescript === true);

    if (typescriptPlugins.length > 0) {
      logger.debug('Checking TypeScript plugins are pre-built', {
        count: typescriptPlugins.length,
      });

      for (const plugin of typescriptPlugins) {
        const mainFile = plugin.manifest.main || 'index.js';
        const jsPath = resolve(process.cwd(), plugin.pluginPath, mainFile);

        if (!existsSync(jsPath)) {
          result.errors.push({
            plugin: plugin.manifest.name,
            error: `Plugin not built. Run 'npm run build:plugins' or build the plugin individually.`,
          });
          logger.error('Plugin not built - missing compiled JavaScript', {
            plugin: plugin.manifest.name,
            expectedPath: jsPath,
          });
        }
      }
    }

    // IMPORTANT: Force-enable the upgrade plugin and run migrations early
    // This ensures data compatibility before other plugins are loaded
    await runUpgradeMigrations();

    // Get final stats
    const stats = pluginRegistry.getStats();
    result.stats = stats;
    result.success = true;
    initialized = true;

    const duration = Date.now() - startTime;
    logger.info('Plugin system initialized', {
      duration: `${duration}ms`,
      total: stats.total,
      enabled: stats.enabled,
      disabled: stats.disabled,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });

    // Log enabled plugins
    const enabledPlugins = pluginRegistry.getEnabled();
    if (enabledPlugins.length > 0) {
      logger.info('Enabled plugins:', {
        plugins: enabledPlugins.map(p => ({
          name: p.manifest.name,
          version: p.manifest.version,
          capabilities: p.capabilities,
        })),
      });
    }

    // Register API routes from enabled plugins with API_ROUTES capability
    logger.debug('Registering plugin API routes');
    registerPluginRoutes();

    const routeRegistry = getPluginRouteRegistry();
    if (routeRegistry.totalRoutes > 0) {
      logger.info('Plugin API routes registered', {
        totalRoutes: routeRegistry.totalRoutes,
        uniquePaths: routeRegistry.uniquePaths,
      });
    }

    // Initialize provider registry from enabled plugins with LLM_PROVIDER capability
    logger.debug('Initializing provider registry');
    const providerPlugins = pluginRegistry.getEnabledByCapability('LLM_PROVIDER');
    if (providerPlugins.length > 0) {
      // Load provider plugins using require() - plugins are transpiled to JS first
      const providers: any[] = [];
      for (const loadedPlugin of providerPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          logger.debug('Loading provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            path: modulePath,
          });

          // Use require() to load the compiled JavaScript module
          const pluginModule = dynamicRequire(modulePath);

          if (pluginModule?.plugin) {
            providers.push(pluginModule.plugin);
            logger.debug('Provider plugin loaded', {
              plugin: loadedPlugin.manifest.name,
              provider: pluginModule.plugin?.metadata?.providerName,
            });
          } else if (pluginModule?.default?.plugin) {
            providers.push(pluginModule.default.plugin);
            logger.debug('Provider plugin loaded (default export)', {
              plugin: loadedPlugin.manifest.name,
              provider: pluginModule.default.plugin?.metadata?.providerName,
            });
          } else {
            logger.warn('Provider plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule),
            });
          }
        } catch (error) {
          logger.error('Failed to load provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (providers.length > 0) {
        await initializeProviderRegistry(providers);
      }
    }

    // Initialize auth provider registry from enabled plugins with AUTH_METHODS capability
    logger.debug('Initializing auth provider registry');
    clearAuthProviders(); // Clear any previous registrations
    const authPlugins = pluginRegistry.getEnabledByCapability('AUTH_METHODS');
    if (authPlugins.length > 0) {
      for (const loadedPlugin of authPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          logger.debug('Loading auth provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            path: modulePath,
          });

          // Use require() to load the compiled JavaScript module
          const pluginModule = dynamicRequire(modulePath);

          // Auth plugins export config, isConfigured, getConfigStatus directly
          const authPlugin = (pluginModule?.default || pluginModule) as AuthProviderPluginExport | undefined;

          if (
            authPlugin &&
            typeof authPlugin.config === 'object' &&
            typeof authPlugin.isConfigured === 'function' &&
            typeof authPlugin.getConfigStatus === 'function' &&
            typeof authPlugin.createProvider === 'function'
          ) {
            registerAuthProvider(authPlugin);
            logger.debug('Auth provider plugin registered', {
              plugin: loadedPlugin.manifest.name,
              providerId: authPlugin.config.providerId,
              isConfigured: authPlugin.isConfigured(),
            });
          } else {
            logger.warn('Auth provider plugin missing required exports', {
              plugin: loadedPlugin.manifest.name,
              hasConfig: typeof authPlugin?.config === 'object',
              hasIsConfigured: typeof authPlugin?.isConfigured === 'function',
              hasGetConfigStatus: typeof authPlugin?.getConfigStatus === 'function',
              hasCreateProvider: typeof authPlugin?.createProvider === 'function',
            });
          }
        } catch (error) {
          logger.error('Failed to load auth provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const loadedAuthPlugins = authPlugins.length;
      logger.info('Auth provider plugins initialized', {
        total: loadedAuthPlugins,
      });
    }

    // Initialize theme registry from enabled plugins with THEME capability
    logger.debug('Initializing theme registry');
    await initializeThemeRegistry();
    const themeStats = themeRegistry.getStats();
    if (themeStats.total > 1) { // More than just the default theme
      logger.info('Theme plugins initialized', {
        total: themeStats.total,
        withDarkMode: themeStats.withDarkMode,
        withCssOverrides: themeStats.withCssOverrides,
      });
    }

    return result;
  } catch (error) {
    logger.error('Failed to initialize plugin system', { error });
    result.success = false;
    result.errors.push({
      plugin: 'system',
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }
}

/**
 * Check if plugin system is initialized
 */
export function isPluginSystemInitialized(): boolean {
  return initialized;
}

/**
 * Reset plugin system (for testing)
 */
export function resetPluginSystem(): void {
  initialized = false;
  initializationPromise = null;
  pluginRegistry.reset();
  // Clear registered plugin routes
  pluginRouteRegistry.routes.clear();
  pluginRouteRegistry.initialized = false;
  pluginRouteRegistry.skipValidation = false;
  // Reset theme registry
  themeRegistry.reset();
  logger.debug('Plugin system reset');
}

/**
 * Get current initialization state
 */
export function getPluginSystemState() {
  return {
    initialized,
    inProgress: initializationPromise !== null && !initialized,
    registry: pluginRegistry.exportState(),
  };
}
