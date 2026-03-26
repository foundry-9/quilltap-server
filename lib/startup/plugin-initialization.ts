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
import { initializeSearchProviderRegistry, searchProviderRegistry } from '@/lib/plugins/search-provider-registry';
import { initializeModerationProviderRegistry, moderationProviderRegistry } from '@/lib/plugins/moderation-provider-registry';
import { initializeSystemPromptRegistry, systemPromptRegistry } from '@/lib/plugins/system-prompt-registry';
import type { ToolPlugin } from '@/lib/plugins/interfaces/tool-plugin';
import type { SearchProviderPlugin } from '@/lib/plugins/interfaces/search-provider-plugin';
import type { ModerationProviderPlugin } from '@/lib/plugins/interfaces/moderation-provider-plugin';
import type { ThemePlugin } from '@quilltap/plugin-types';
import { injectPluginLoggerFactory, clearPluginLoggerFactory } from '@/lib/plugins/plugin-logger-bridge';
import { __injectQuilltapVersion, __clearQuilltapVersion } from '@quilltap/plugin-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';
import packageJson from '@/package.json';
import { join } from 'node:path';

import { existsSync } from 'node:fs';

// Use an indirection for path.resolve so the bundler cannot statically analyse
// the resulting file pattern (which otherwise triggers "matches N files" warnings
// because resolve(process.cwd(), <dynamic>, <dynamic>) looks overly broad).
const _resolve: typeof import('node:path').resolve =
  typeof __non_webpack_require__ !== 'undefined'
    ? __non_webpack_require__('node:path').resolve
    : require('node:path').resolve;

// Dynamic plugin loading requires native Node.js require, not the bundler's.
// - Webpack (dev): provides __non_webpack_require__ for native require access
// - Turbopack (Next.js 16+ production) / plain Node.js: use createRequire from node:module
//   accessed via require('node:module') so webpack sees it as dead code
interface NodeModuleParent {
  filename?: string;
  paths?: string[];
}
interface NodeModuleInternal {
  _resolveFilename: (request: string, parent: NodeModuleParent | null, isMain: boolean, options?: object) => string;
  _nodeModulePaths: (from: string) => string[];
}

let dynamicRequire: NodeRequire;
let Module: NodeModuleInternal;

if (typeof __non_webpack_require__ !== 'undefined') {
  dynamicRequire = __non_webpack_require__;
  Module = __non_webpack_require__('module') as unknown as NodeModuleInternal;
} else {
  const nodeModule = require('node:module');
  dynamicRequire = nodeModule.createRequire(process.cwd() + '/') as NodeRequire;
  Module = nodeModule as unknown as NodeModuleInternal;
}

// Get the app's node_modules path for peer dependency resolution
const appNodeModules = join(process.cwd(), 'node_modules');

// Peer dependencies that external plugins can use from the host app
const PEER_DEPENDENCIES = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
]);

/**
 * Load an external plugin module with peer dependency resolution.
 *
 * External npm-installed plugins need to be able to use React and other
 * peer dependencies from the host app's node_modules. This function
 * temporarily patches Module._resolveFilename to fall back to the app's
 * node_modules when the plugin can't find a peer dependency.
 */
function loadExternalPluginModule(modulePath: string): unknown {
  // Store original _resolveFilename
  const originalResolveFilename = Module._resolveFilename;

  // Create app module paths for fallback resolution
  const appModulePaths = Module._nodeModulePaths(appNodeModules);

  // Patch _resolveFilename to handle peer dependencies
  Module._resolveFilename = function(
    request: string,
    parent: { filename?: string; paths?: string[] } | null,
    isMain: boolean,
    options?: object
  ) {
    // First, try the original resolution
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      // If it's a peer dependency and we're loading from an external plugin, try the app's node_modules
      if (PEER_DEPENDENCIES.has(request) && parent?.filename && !parent.filename.includes(join('plugins', 'dist'))) {
        try {
          // Create a fake parent with paths pointing to the app's node_modules
          const fakeParent = {
            filename: join(appNodeModules, 'react', 'index.js'),
            paths: appModulePaths,
          };
          return originalResolveFilename.call(this, request, fakeParent, isMain, options);
        } catch {
          // Fall through to throw original error
        }
      }
      throw error;
    }
  };

  try {
    // Clear the module from cache to ensure fresh load with our patched resolver
    delete dynamicRequire.cache[dynamicRequire.resolve(modulePath)];
  } catch {
    // Module not in cache, that's fine
  }

  try {
    return dynamicRequire(modulePath);
  } finally {
    // Restore original _resolveFilename
    Module._resolveFilename = originalResolveFilename;
  }
}

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

    // Inject the app version so plugins can identify themselves in API calls
    __injectQuilltapVersion(packageJson.version);

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
        const jsPath = _resolve(process.cwd(), plugin.pluginPath, mainFile);

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

    // Get final stats (but don't mark as initialized yet - registries need to be initialized first)
    const stats = pluginRegistry.getStats();
    result.stats = stats;

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

    // Initialize provider registry from enabled plugins with LLM_PROVIDER or EMBEDDING_PROVIDER capability
    // LLM_PROVIDER plugins provide chat, image generation, and optionally embeddings
    // EMBEDDING_PROVIDER plugins provide only embeddings (no LLM_PROVIDER capability)
    const llmProviderPlugins = pluginRegistry.getEnabledByCapability('LLM_PROVIDER');
    const embeddingProviderPlugins = pluginRegistry.getEnabledByCapability('EMBEDDING_PROVIDER')
      .filter(p => !p.capabilities.includes('LLM_PROVIDER')); // Exclude plugins that are already LLM providers

    const allProviderPlugins = [...llmProviderPlugins, ...embeddingProviderPlugins];

    if (allProviderPlugins.length > 0) {
      // Load provider plugins using require() - plugins are transpiled to JS first
      const providers: any[] = [];
      for (const loadedPlugin of allProviderPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          // Use external loader for npm-installed plugins to resolve peer dependencies
          // Bundled plugins (in plugins/dist) can use dynamicRequire directly
          const isExternalPlugin = loadedPlugin.source === 'npm';
          const pluginModule = isExternalPlugin
            ? loadExternalPluginModule(modulePath)
            : dynamicRequire(modulePath);

          if (pluginModule?.plugin) {
            providers.push(pluginModule.plugin);
          } else if (pluginModule?.default?.plugin) {
            providers.push(pluginModule.default.plugin);
          } else {
            logger.warn('Provider plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule as object),
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
        logger.info('Provider registry initialized', {
          llmProviders: llmProviderPlugins.length,
          embeddingOnlyProviders: embeddingProviderPlugins.length,
          totalProviders: providers.length,
        });
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
        const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

        if (!existsSync(modulePath)) {
          continue; // No module file, will fall back to file-based
        }

        // Use external loader for npm-installed plugins to resolve peer dependencies
        const isExternalPlugin = loadedPlugin.source === 'npm';
        const pluginModule = isExternalPlugin
          ? loadExternalPluginModule(modulePath)
          : dynamicRequire(modulePath);
        const themePlugin = (pluginModule as { plugin?: unknown; default?: { plugin?: unknown } })?.plugin
          || (pluginModule as { default?: { plugin?: unknown } })?.default?.plugin;

        if (themePlugin && typeof themePlugin === 'object' && 'tokens' in themePlugin) {
          themeRegistry.registerThemeModule(loadedPlugin, themePlugin as ThemePlugin);
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
          const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          // Use external loader for npm-installed plugins to resolve peer dependencies
          const isExternalPlugin = loadedPlugin.source === 'npm';
          const pluginModule = isExternalPlugin
            ? loadExternalPluginModule(modulePath)
            : dynamicRequire(modulePath);

          if ((pluginModule as { plugin?: unknown })?.plugin) {
            tools.push((pluginModule as { plugin: ToolPlugin }).plugin);
          } else if ((pluginModule as { default?: { plugin?: unknown } })?.default?.plugin) {
            tools.push((pluginModule as { default: { plugin: ToolPlugin } }).default.plugin);
          } else {
            logger.warn('Tool plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule as object),
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

    // Initialize search provider registry from enabled plugins with SEARCH_PROVIDER capability
    const searchProviderPlugins = pluginRegistry.getEnabledByCapability('SEARCH_PROVIDER');
    if (searchProviderPlugins.length > 0) {
      const searchProviders: SearchProviderPlugin[] = [];
      for (const loadedPlugin of searchProviderPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          // Use external loader for npm-installed plugins to resolve peer dependencies
          const isExternalPlugin = loadedPlugin.source === 'npm';
          const pluginModule = isExternalPlugin
            ? loadExternalPluginModule(modulePath)
            : dynamicRequire(modulePath);

          if ((pluginModule as { plugin?: unknown })?.plugin) {
            searchProviders.push((pluginModule as { plugin: SearchProviderPlugin }).plugin);
          } else if ((pluginModule as { default?: { plugin?: unknown } })?.default?.plugin) {
            searchProviders.push((pluginModule as { default: { plugin: SearchProviderPlugin } }).default.plugin);
          } else {
            logger.warn('Search provider plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule as object),
            });
          }
        } catch (error) {
          logger.error('Failed to load search provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (searchProviders.length > 0) {
        await initializeSearchProviderRegistry(searchProviders);
        logger.info('Search provider registry initialized', {
          searchProviders: searchProviders.length,
        });
      }
    }

    // Initialize moderation provider registry from enabled plugins with MODERATION_PROVIDER capability
    const moderationProviderPlugins = pluginRegistry.getEnabledByCapability('MODERATION_PROVIDER');
    if (moderationProviderPlugins.length > 0) {
      const moderationProviders: ModerationProviderPlugin[] = [];
      for (const loadedPlugin of moderationProviderPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          // Use external loader for npm-installed plugins to resolve peer dependencies
          const isExternalPlugin = loadedPlugin.source === 'npm';
          const pluginModule = isExternalPlugin
            ? loadExternalPluginModule(modulePath)
            : dynamicRequire(modulePath);

          // Moderation plugins export as { moderationPlugin: ModerationProviderPlugin }
          if ((pluginModule as { moderationPlugin?: unknown })?.moderationPlugin) {
            moderationProviders.push((pluginModule as { moderationPlugin: ModerationProviderPlugin }).moderationPlugin);
          } else if ((pluginModule as { default?: { moderationPlugin?: unknown } })?.default?.moderationPlugin) {
            moderationProviders.push((pluginModule as { default: { moderationPlugin: ModerationProviderPlugin } }).default.moderationPlugin);
          } else {
            logger.warn('Moderation provider plugin module does not export a moderationPlugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule as object),
            });
          }
        } catch (error) {
          logger.error('Failed to load moderation provider plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (moderationProviders.length > 0) {
        await initializeModerationProviderRegistry(moderationProviders);
        logger.info('Moderation provider registry initialized', {
          moderationProviders: moderationProviders.length,
        });
      }
    }

    // Initialize system prompt registry from enabled plugins with SYSTEM_PROMPT capability
    const systemPromptPlugins = pluginRegistry.getEnabledByCapability('SYSTEM_PROMPT');
    if (systemPromptPlugins.length > 0) {
      const systemPrompts: Array<{ metadata: { pluginId: string; displayName: string; description?: string; version?: string }; prompts: Array<{ name: string; content: string; modelHint: string; category: string }>; initialize?: () => void | Promise<void> }> = [];
      for (const loadedPlugin of systemPromptPlugins) {
        try {
          const mainFile = loadedPlugin.manifest.main || 'index.js';
          const modulePath = _resolve(process.cwd(), loadedPlugin.pluginPath, mainFile);

          // Use external loader for npm-installed plugins to resolve peer dependencies
          const isExternalPlugin = loadedPlugin.source === 'npm';
          const pluginModule = isExternalPlugin
            ? loadExternalPluginModule(modulePath)
            : dynamicRequire(modulePath);

          if ((pluginModule as { plugin?: unknown })?.plugin) {
            systemPrompts.push((pluginModule as { plugin: typeof systemPrompts[number] }).plugin);
          } else if ((pluginModule as { default?: { plugin?: unknown } })?.default?.plugin) {
            systemPrompts.push((pluginModule as { default: { plugin: typeof systemPrompts[number] } }).default.plugin);
          } else {
            logger.warn('System prompt plugin module does not export a plugin object', {
              plugin: loadedPlugin.manifest.name,
              exports: Object.keys(pluginModule as object),
            });
          }
        } catch (error) {
          logger.error('Failed to load system prompt plugin module', {
            plugin: loadedPlugin.manifest.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (systemPrompts.length > 0) {
        await initializeSystemPromptRegistry(systemPrompts);
        logger.info('System prompt registry initialized', {
          systemPromptPlugins: systemPrompts.length,
        });
      }
    }

    // Initialize the file storage manager
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

    // Mark as fully initialized AFTER all registries are set up
    // This is critical for avoiding race conditions where a second call to initializePlugins()
    // returns early before provider registry is initialized (Docker/production issue)
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
  // Reset search provider registry
  searchProviderRegistry.reset();
  // Reset system prompt registry
  systemPromptRegistry.reset();
  // Clear the plugin logger factory and version injection
  clearPluginLoggerFactory();
  __clearQuilltapVersion();
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
