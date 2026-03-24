/**
 * Search Provider Registry
 *
 * Singleton registry for managing web search provider plugins.
 * Provides centralized access to search provider plugins and metadata.
 *
 * Search providers power the built-in `search_web` tool by providing
 * pluggable backends (e.g., Serper, Bing, DuckDuckGo).
 *
 * Extends AbstractProviderRegistry for shared registration, lookup,
 * initialisation, validation, stats, errors, and state export logic.
 *
 * @module plugins/search-provider-registry
 */

import type {
  SearchProviderPlugin,
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
} from '@quilltap/plugin-types';
import { AbstractProviderRegistry, type ProviderRegistryBaseState } from './abstract-provider-registry';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { extractPluginExport } from './dynamic-loader';

// ============================================================================
// TYPES
// ============================================================================

export type SearchProviderRegistryState = ProviderRegistryBaseState<SearchProviderPlugin>;

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our search provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapSearchProviderRegistryState: SearchProviderRegistryState | undefined;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class SearchProviderRegistry extends AbstractProviderRegistry<SearchProviderPlugin> {
  protected readonly registryName = 'search-provider-registry';
  protected readonly globalStateKey = '__quilltapSearchProviderRegistryState';
  protected readonly typeName = 'search provider';

  protected createEmptyState(): SearchProviderRegistryState {
    return {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
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
    return this.isConfigured();
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
    return this.hotLoadProviderPluginBase(
      pluginPath,
      manifest,
      ['SEARCH_PROVIDER'],
      (pluginModule) => extractPluginExport(pluginModule) as SearchProviderPlugin | undefined,
    );
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
