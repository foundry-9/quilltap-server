/**
 * Search Provider Registry
 *
 * Singleton registry for managing web search provider plugins.
 * Provides centralized access to search provider plugins and metadata.
 *
 * Search providers power the built-in `search_web` tool by providing
 * pluggable backends (e.g., Serper, Bing, DuckDuckGo).
 *
 * @module plugins/search-provider-registry
 */

import { logger } from '@/lib/logger';
import type {
  SearchProviderPlugin,
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
} from '@quilltap/plugin-types';
import { getErrorMessage } from '@/lib/errors';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

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
 */
function loadExternalPluginModule(modulePath: string): unknown {
  const originalResolveFilename = Module._resolveFilename;
  const appModulePaths = Module._nodeModulePaths(appNodeModules);

  Module._resolveFilename = function(
    request: string,
    parent: { filename?: string; paths?: string[] } | null,
    isMain: boolean,
    options?: object
  ) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      if (PEER_DEPENDENCIES.has(request) && parent?.filename && !parent.filename.includes(join('plugins', 'dist'))) {
        try {
          const fakeParent = {
            filename: join(appNodeModules, 'react', 'index.js'),
            paths: appModulePaths,
          };
          return originalResolveFilename.call(this, request, fakeParent, isMain, options);
        } catch {
          // Fall through
        }
      }
      throw error;
    }
  };

  try {
    delete dynamicRequire.cache[dynamicRequire.resolve(modulePath)];
  } catch {
    // Not in cache
  }

  try {
    return dynamicRequire(modulePath);
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface SearchProviderRegistryState {
  initialized: boolean;
  providers: Map<string, SearchProviderPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our search provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapSearchProviderRegistryState: SearchProviderRegistryState | undefined;
}

/**
 * Get or create the global registry state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): SearchProviderRegistryState {
  if (!global.__quilltapSearchProviderRegistryState) {
    global.__quilltapSearchProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }
  return global.__quilltapSearchProviderRegistryState;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class SearchProviderRegistry {
  private get state(): SearchProviderRegistryState {
    return getGlobalState();
  }

  private logger = logger.child({
    module: 'search-provider-registry',
  });

  /**
   * Register a search provider plugin
   *
   * @param plugin The search provider plugin to register
   * @throws Error if provider with same name is already registered
   */
  registerProvider(plugin: SearchProviderPlugin): void {
    const providerName = plugin.metadata.providerName;

    if (this.state.providers.has(providerName)) {
      const error = `Search provider '${providerName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    this.state.providers.set(providerName, plugin);
  }

  /**
   * Get a specific search provider plugin by name
   *
   * @param name The provider name (e.g., 'SERPER')
   * @returns The search provider plugin or null if not found
   */
  getProvider(name: string): SearchProviderPlugin | null {
    return this.state.providers.get(name) || null;
  }

  /**
   * Get all registered search provider plugins
   *
   * @returns Array of all registered search provider plugins
   */
  getAllProviders(): SearchProviderPlugin[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Check if a search provider is registered
   *
   * @param name The provider name
   * @returns true if provider is registered, false otherwise
   */
  hasProvider(name: string): boolean {
    return this.state.providers.has(name);
  }

  /**
   * Get list of all registered search provider names
   *
   * Useful for populating dropdown menus and provider selection UI
   *
   * @returns Array of provider names (e.g., ['SERPER', 'BING', ...])
   */
  getProviderNames(): string[] {
    return Array.from(this.state.providers.keys());
  }

  /**
   * Get metadata for a specific search provider
   *
   * Metadata includes display name, colors, abbreviation, etc.
   * Useful for UI rendering and provider identification.
   *
   * @param name The provider name
   * @returns The provider metadata or null if not found
   */
  getProviderMetadata(name: string): SearchProviderMetadata | null {
    const plugin = this.getProvider(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered search providers
   *
   * @returns Array of search provider metadata objects
   */
  getAllProviderMetadata(): SearchProviderMetadata[] {
    return this.getAllProviders().map(p => p.metadata);
  }

  /**
   * Get configuration requirements for a search provider
   *
   * @param name The provider name
   * @returns Configuration requirements or null if not found
   */
  getConfigRequirements(name: string): SearchProviderConfigRequirements | null {
    const plugin = this.getProvider(name);
    return plugin?.config || null;
  }

  /**
   * Get the default (first registered) search provider
   *
   * Returns the first provider that was registered, which serves as
   * the default when no specific provider is requested.
   *
   * @returns The first registered search provider plugin, or null if none registered
   */
  getDefaultProvider(): SearchProviderPlugin | null {
    const providers = this.getAllProviders();
    return providers.length > 0 ? providers[0] : null;
  }

  /**
   * Check if any search provider is registered and available
   *
   * Used by the search_web tool to determine if web search
   * functionality is available.
   *
   * @returns true if at least one search provider is registered
   */
  isSearchConfigured(): boolean {
    return this.state.providers.size > 0;
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * @param providers Array of search provider plugins to register
   */
  async initialize(providers: SearchProviderPlugin[]): Promise<void> {
    // Clear existing state
    this.state.providers.clear();
    this.state.errors.clear();

    // Register each provider
    for (const provider of providers) {
      try {
        this.registerProvider(provider);
      } catch (error) {
        const providerName = provider.metadata.providerName;
        const errorMessage = getErrorMessage(error);
        this.state.errors.set(providerName, errorMessage);
        this.logger.warn('Failed to register search provider', {
          name: providerName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();
  }

  /**
   * Reset the registry (for testing)
   *
   * @internal
   */
  reset(): void {
    // Reset the global state entirely
    global.__quilltapSearchProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered search providers
   */
  getStats() {
    return {
      total: this.state.providers.size,
      errors: this.state.errors.size,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      providers: Array.from(this.state.providers.keys()),
    };
  }

  /**
   * Get all errors from search provider registration
   *
   * @returns Array of registration errors
   */
  getErrors(): Array<{ provider: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([provider, error]) => ({
      provider,
      error,
    }));
  }

  /**
   * Check if registry is initialized
   *
   * @returns true if registry has been initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Hot-load a search provider plugin from disk after installation
   *
   * Loads a search provider plugin module and registers it with the registry
   * without requiring a full server restart.
   *
   * @param pluginPath Path to the installed plugin directory
   * @param manifest The validated plugin manifest
   * @returns true if search provider was loaded and registered, false otherwise
   */
  hotLoadSearchProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
    const isSearchProvider = manifest.capabilities.includes('SEARCH_PROVIDER');

    if (!isSearchProvider) {
      return false;
    }

    try {
      const mainFile = manifest.main || 'index.js';
      const modulePath = resolve(pluginPath, mainFile);

      if (!existsSync(modulePath)) {
        this.logger.error('Search provider plugin main file not found', {
          plugin: manifest.name,
          expectedPath: modulePath,
        });
        return false;
      }

      // Determine if this is an external (npm-installed) plugin
      // External plugins have paths containing node_modules but not in plugins/dist
      const isExternalPlugin = pluginPath.includes('node_modules') && !pluginPath.includes(join('plugins', 'dist'));

      // Load the plugin module with peer dependency resolution for external plugins
      const pluginModule = isExternalPlugin
        ? loadExternalPluginModule(modulePath)
        : (() => {
            // Clear require cache for bundled plugins
            try {
              const resolvedPath = dynamicRequire.resolve(modulePath);
              delete dynamicRequire.cache[resolvedPath];
            } catch {
              // Module may not be in cache yet, that's fine
            }
            return dynamicRequire(modulePath);
          })();

      // Extract the search provider plugin object
      const searchProviderPlugin = (pluginModule as Record<string, unknown>)?.plugin ||
        ((pluginModule as Record<string, Record<string, unknown>>)?.default?.plugin);

      if (!(searchProviderPlugin as SearchProviderPlugin)?.metadata?.providerName) {
        this.logger.warn('Search provider plugin module does not export a valid plugin object', {
          plugin: manifest.name,
          exports: Object.keys((pluginModule as Record<string, unknown>) || {}),
        });
        return false;
      }

      const typedPlugin = searchProviderPlugin as SearchProviderPlugin;

      // Check if already registered (e.g., from a previous hot-load or startup)
      if (this.state.providers.has(typedPlugin.metadata.providerName)) {
        this.logger.info('Search provider already registered, skipping', {
          plugin: manifest.name,
          provider: typedPlugin.metadata.providerName,
        });
        return true; // Already available, consider it success
      }

      // Register the provider
      this.registerProvider(typedPlugin);
      this.logger.info('Search provider plugin hot-loaded successfully', {
        plugin: manifest.name,
        provider: typedPlugin.metadata.providerName,
        displayName: typedPlugin.metadata.displayName,
      });

      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to hot-load search provider plugin', {
        plugin: manifest.name,
        error: errorMessage,
      });
      this.state.errors.set(manifest.name, errorMessage);
      return false;
    }
  }

  /**
   * Export registry state for debugging/admin UI
   *
   * @returns Complete registry state
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      providers: Array.from(this.state.providers.entries()).map(([name, plugin]) => ({
        name,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        configRequirements: {
          requiresApiKey: plugin.config.requiresApiKey,
          requiresBaseUrl: plugin.config.requiresBaseUrl,
        },
      })),
      errors: Array.from(this.state.errors.entries()).map(([provider, error]) => ({
        provider,
        error,
      })),
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global search provider registry instance
 */
export const searchProviderRegistry = new SearchProviderRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a search provider plugin
 *
 * @param plugin The search provider plugin to register
 */
export function registerSearchProvider(plugin: SearchProviderPlugin): void {
  searchProviderRegistry.registerProvider(plugin);
}

/**
 * Get a search provider plugin by name
 *
 * @param name The provider name
 * @returns The search provider plugin or null
 */
export function getSearchProvider(name: string): SearchProviderPlugin | null {
  return searchProviderRegistry.getProvider(name);
}

/**
 * Get all registered search provider plugins
 *
 * @returns Array of all registered search providers
 */
export function getAllSearchProviders(): SearchProviderPlugin[] {
  return searchProviderRegistry.getAllProviders();
}

/**
 * Check if a search provider is registered
 *
 * @param name The provider name
 * @returns true if provider exists
 */
export function hasSearchProvider(name: string): boolean {
  return searchProviderRegistry.hasProvider(name);
}

/**
 * Get list of search provider names
 *
 * @returns Array of provider names
 */
export function getSearchProviderNames(): string[] {
  return searchProviderRegistry.getProviderNames();
}

/**
 * Get search provider metadata
 *
 * @param name The provider name
 * @returns Search provider metadata or null
 */
export function getSearchProviderMetadata(name: string): SearchProviderMetadata | null {
  return searchProviderRegistry.getProviderMetadata(name);
}

/**
 * Get all search provider metadata
 *
 * @returns Array of metadata for all search providers
 */
export function getAllSearchProviderMetadata(): SearchProviderMetadata[] {
  return searchProviderRegistry.getAllProviderMetadata();
}

/**
 * Get configuration requirements for a search provider
 *
 * @param name The provider name
 * @returns Config requirements or null
 */
export function getSearchProviderConfigRequirements(name: string): SearchProviderConfigRequirements | null {
  return searchProviderRegistry.getConfigRequirements(name);
}

/**
 * Get the default (first registered) search provider
 *
 * @returns The first registered search provider plugin, or null if none
 */
export function getDefaultSearchProvider(): SearchProviderPlugin | null {
  return searchProviderRegistry.getDefaultProvider();
}

/**
 * Check if any search provider is configured and available
 *
 * @returns true if at least one search provider is registered
 */
export function isSearchConfigured(): boolean {
  return searchProviderRegistry.isSearchConfigured();
}

/**
 * Initialize the search provider registry
 *
 * @param providers Array of search provider plugins to register
 */
export async function initializeSearchProviderRegistry(providers: SearchProviderPlugin[]): Promise<void> {
  return searchProviderRegistry.initialize(providers);
}

/**
 * Get search provider registry statistics
 *
 * @returns Statistics about registered search providers
 */
export function getSearchProviderRegistryStats() {
  return searchProviderRegistry.getStats();
}

/**
 * Get search provider registry errors
 *
 * @returns Array of registration errors
 */
export function getSearchProviderRegistryErrors() {
  return searchProviderRegistry.getErrors();
}

/**
 * Check if search provider registry is initialized
 *
 * @returns true if initialized
 */
export function isSearchProviderRegistryInitialized(): boolean {
  return searchProviderRegistry.isInitialized();
}

/**
 * Hot-load a search provider plugin from disk after installation
 *
 * @param pluginPath Path to the installed plugin directory
 * @param manifest The validated plugin manifest
 * @returns true if search provider was loaded and registered
 */
export function hotLoadSearchProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
  return searchProviderRegistry.hotLoadSearchProviderPlugin(pluginPath, manifest);
}
