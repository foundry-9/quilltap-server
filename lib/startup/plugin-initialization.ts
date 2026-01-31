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
import { initializeThemeRegistry, themeRegistry } from '@/lib/themes/theme-registry';
import { initializeRoleplayTemplateRegistry, roleplayTemplateRegistry } from '@/lib/plugins/roleplay-template-registry';
import { initializeToolRegistry, toolRegistry } from '@/lib/plugins/tool-registry';
import type { ToolPlugin } from '@/lib/plugins/interfaces/tool-plugin';
import { injectPluginLoggerFactory, clearPluginLoggerFactory } from '@/lib/plugins/plugin-logger-bridge';
import { fileStorageManager } from '@/lib/file-storage/manager';
import type { FileStorageProviderPlugin } from '@/lib/file-storage/interfaces';
import packageJson from '@/package.json';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Create a require function that bypasses Next.js bundling for dynamic plugin loading
const dynamicRequire = createRequire(import.meta.url || __filename);

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
 * Initialize the plugin system
 * This function is idempotent - multiple calls will return the same promise
 *
 * Note: Migrations are now run in instrumentation.ts BEFORE this function is called,
 * so all data is guaranteed to be in the correct format when plugins are initialized.
 *
 * @param forceRescan - If true, forces a full rescan even if already initialized.
 *                      Use this after installing or uninstalling plugins.
 */
export async function initializePlugins(forceRescan: boolean = false): Promise<PluginInitializationResult> {
  // If force rescan requested, reset state to allow reinitialization
  if (forceRescan) {
    logger.info('Forcing plugin system rescan', { context: 'initializePlugins' });
    initialized = false;
    initializationPromise = null;
  }

  // If already initialized, return existing result
  if (initialized) {
    return {
      success: true,
      stats: pluginRegistry.getStats(),
      warnings: [],
      errors: pluginRegistry.getErrors(),
    };
  }

  // If initialization is in progress, return the existing promise
  if (initializationPromise) {
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
    // Inject the logger factory before loading any plugins
    // This allows plugins using @quilltap/plugin-utils to have their
    // logs routed through Quilltap's core logging system
    injectPluginLoggerFactory();

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

    // Note: Migrations are now run in instrumentation.ts BEFORE plugin initialization.
    // This ensures data compatibility before any plugins are loaded.

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
    registerPluginRoutes();

    const routeRegistry = getPluginRouteRegistry();
    if (routeRegistry.totalRoutes > 0) {
      logger.info('Plugin API routes registered', {
        totalRoutes: routeRegistry.totalRoutes,
        uniquePaths: routeRegistry.uniquePaths,
      });
    }

    // Initialize provider registry from enabled plugins with LLM_PROVIDER capability
    const providerPlugins = pluginRegistry.getEnabledByCapability('LLM_PROVIDER');
    if (providerPlugins.length > 0) {
      // Load provider plugins using require() - plugins are transpiled to JS first
      const providers: any[] = [];
      for (const loadedPlugin of providerPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);
          // Use require() to load the compiled JavaScript module
          const pluginModule = dynamicRequire(modulePath);

          if (pluginModule?.plugin) {
            providers.push(pluginModule.plugin);
          } else if (pluginModule?.default?.plugin) {
            providers.push(pluginModule.default.plugin);
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

    // Note: AUTH_METHODS plugins are no longer supported (single-user mode only)

    // Initialize theme registry from enabled plugins with THEME capability
    // First, load module-based themes (self-contained) via dynamic require
    const themePlugins = pluginRegistry.getEnabledByCapability('THEME');
    for (const loadedPlugin of themePlugins) {
      // Check if plugin uses module-based loading
      const themeConfig = loadedPlugin.manifest.themeConfig;
      if (themeConfig?.useModule === false) {
        continue; // Skip - will be loaded file-based
      }

      try {
        const mainFile = loadedPlugin.manifest.main || 'index.js';
        const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

        if (!existsSync(modulePath)) {
          continue; // No module file, will fall back to file-based
        }
        // Use require() to load the compiled JavaScript module
        const pluginModule = dynamicRequire(modulePath);
        const themePlugin = pluginModule?.plugin || pluginModule?.default?.plugin;

        if (themePlugin?.tokens) {
          themeRegistry.registerThemeModule(loadedPlugin, themePlugin);
        }
      } catch (error) {
      }
    }

    // Then initialize the registry (handles file-based themes and default theme)
    await initializeThemeRegistry();

    // Initialize roleplay template registry from enabled plugins with ROLEPLAY_TEMPLATE capability
    await initializeRoleplayTemplateRegistry();

    // Initialize tool registry from enabled plugins with TOOL_PROVIDER capability
    const toolPlugins = pluginRegistry.getEnabledByCapability('TOOL_PROVIDER');
    if (toolPlugins.length > 0) {
      const tools: ToolPlugin[] = [];
      for (const loadedPlugin of toolPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);
          // Use require() to load the compiled JavaScript module
          const pluginModule = dynamicRequire(modulePath);

          if (pluginModule?.plugin) {
            tools.push(pluginModule.plugin as ToolPlugin);
          } else if (pluginModule?.default?.plugin) {
            tools.push(pluginModule.default.plugin as ToolPlugin);
          } else {
            logger.warn('Tool plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule),
            });
          }
        } catch (error) {
          logger.error('Failed to load tool plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (tools.length > 0) {
        await initializeToolRegistry(tools);
      }
    }

    // Initialize file storage registry from enabled plugins with FILE_BACKEND capability
    const fileBackendPlugins = pluginRegistry.getEnabledByCapability('FILE_BACKEND');
    if (fileBackendPlugins.length > 0) {
      for (const loadedPlugin of fileBackendPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);
          // Use require() to load the compiled JavaScript module
          const pluginModule = dynamicRequire(modulePath);

          if (pluginModule?.plugin) {
            fileStorageManager.registerProviderPlugin(pluginModule.plugin as FileStorageProviderPlugin);
          } else if (pluginModule?.default?.plugin) {
            fileStorageManager.registerProviderPlugin(pluginModule.default.plugin as FileStorageProviderPlugin);
          } else {
            logger.warn('File backend plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule),
            });
          }
        } catch (error) {
          logger.error('Failed to load file backend plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Initialize the file storage manager after backend plugins are registered
    // This loads mount points from the database and sets up the default backend
    try {
      await fileStorageManager.initialize();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize file storage manager', { error: errorMsg });
      result.warnings.push({
        plugin: 'file-storage',
        warnings: [`File storage initialization failed: ${errorMsg}`],
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
  // Reset roleplay template registry
  roleplayTemplateRegistry.reset();
  // Reset tool registry
  toolRegistry.reset();
  // Clear the plugin logger factory
  clearPluginLoggerFactory();
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
