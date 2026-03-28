/**
 * Abstract Provider Registry
 *
 * Consolidates the shared logic of ProviderRegistry, ModerationProviderRegistry,
 * and SearchProviderRegistry into a single generic base class.
 *
 * These three registries were ~90% identical copy-paste code. This base class
 * provides the common implementations for registration, lookup, initialisation,
 * hot-loading, validation, stats, errors, and state export.
 *
 * @module plugins/abstract-provider-registry
 */

import { AbstractMapRegistry } from './abstract-map-registry';
import type { BaseRegistryState } from './base-registry';
import { getErrorMessage } from '@/lib/errors';
import { rewriteLocalhostUrl } from '@/lib/host-rewrite';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { loadPluginModule } from './dynamic-loader';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal shape that all provider plugin types share.
 * Each concrete provider plugin interface (LLMProviderPlugin,
 * ModerationProviderPlugin, SearchProviderPlugin) extends this implicitly.
 */
export interface BaseProviderPlugin {
  metadata: {
    providerName: string;
    displayName: string;
    description: string;
  };
  config: {
    requiresApiKey: boolean;
    requiresBaseUrl: boolean;
  };
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;
}

/**
 * State shape shared by all provider registries.
 */
export interface ProviderRegistryBaseState<TPlugin> extends BaseRegistryState {
  providers: Map<string, TPlugin>;
  errors: Map<string, string>;
}

// ============================================================================
// ABSTRACT PROVIDER REGISTRY
// ============================================================================

/**
 * Abstract base class for provider registries (LLM, Moderation, Search).
 *
 * Subclasses must provide:
 *  - `registryName`, `globalStateKey`, `createEmptyState()` (from AbstractRegistry)
 *  - `typeName` — human-readable type for log messages (e.g. 'provider', 'moderation provider')
 *
 * Subclasses may override:
 *  - `mapProviderToExportItem()` to add type-specific fields to `exportState()`
 */
export abstract class AbstractProviderRegistry<
  TPlugin extends BaseProviderPlugin,
> extends AbstractMapRegistry<TPlugin, ProviderRegistryBaseState<TPlugin>> {

  /** Human-readable type name for log messages (e.g. 'provider', 'moderation provider'). */
  protected abstract readonly typeName: string;

  // ============================================================================
  // AbstractMapRegistry implementations
  // ============================================================================

  protected getItemMap(): Map<string, TPlugin> {
    return this.state.providers;
  }

  protected getErrorMap(): Map<string, string> {
    return this.state.errors;
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register a provider plugin.
   *
   * @param plugin The provider plugin to register
   * @throws Error if a provider with the same name is already registered
   */
  registerProvider(plugin: TPlugin): void {
    const providerName = plugin.metadata.providerName;

    if (this.state.providers.has(providerName)) {
      const error = `${this.capitalizedTypeName} '${providerName}' is already registered`;
      this.registryLogger.warn(error);
      throw new Error(error);
    }

    this.state.providers.set(providerName, plugin);
  }

  // ============================================================================
  // LOOKUP
  // ============================================================================

  /**
   * Get a specific provider plugin by name.
   */
  getProvider(name: string): TPlugin | null {
    return this.state.providers.get(name) ?? null;
  }

  /**
   * Get all registered provider plugins.
   */
  getAllProviders(): TPlugin[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(name: string): boolean {
    return this.state.providers.has(name);
  }

  /**
   * Get list of all registered provider names.
   */
  getProviderNames(): string[] {
    return Array.from(this.state.providers.keys());
  }

  /**
   * Get metadata for a specific provider.
   */
  getProviderMetadata(name: string): TPlugin['metadata'] | null {
    const plugin = this.getProvider(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered providers.
   */
  getAllProviderMetadata(): TPlugin['metadata'][] {
    return this.getAllProviders().map(p => p.metadata);
  }

  /**
   * Get configuration requirements for a provider.
   */
  getConfigRequirements(name: string): TPlugin['config'] | null {
    const plugin = this.getProvider(name);
    return plugin?.config || null;
  }

  /**
   * Get the default (first registered) provider.
   */
  getDefaultProvider(): TPlugin | null {
    const providers = this.getAllProviders();
    return providers.length > 0 ? providers[0] : null;
  }

  /**
   * Check if any provider is registered and available.
   */
  isConfigured(): boolean {
    return this.state.providers.size > 0;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate an API key using the provider plugin, with localhost URL rewriting.
   *
   * @param name The provider name
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL (will be rewritten if localhost in VM/container)
   * @returns true if valid, false if provider has no validateApiKey
   * @throws Error if provider not found
   */
  async validateApiKey(name: string, apiKey: string, baseUrl?: string): Promise<boolean> {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `${this.capitalizedTypeName} '${name}' not found in registry`;
      this.registryLogger.error(error);
      throw new Error(error);
    }

    if (!plugin.validateApiKey) {
      return false;
    }

    const resolvedUrl = baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
    return plugin.validateApiKey(apiKey, resolvedUrl);
  }

  // ============================================================================
  // INITIALISATION
  // ============================================================================

  /**
   * Initialise the registry with an array of provider plugins.
   */
  async initialize(providers: TPlugin[]): Promise<void> {
    this.state.providers.clear();
    this.state.errors.clear();

    for (const provider of providers) {
      try {
        this.registerProvider(provider);
      } catch (error) {
        const providerName = provider.metadata.providerName;
        const errorMessage = getErrorMessage(error);
        this.state.errors.set(providerName, errorMessage);
        this.registryLogger.warn(`Failed to register ${this.typeName}`, {
          name: providerName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();
  }

  // ============================================================================
  // STATS & ERRORS (override AbstractMapRegistry for provider-specific keys)
  // ============================================================================

  /**
   * Get registry statistics.
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
   * Get all registration errors.
   */
  getErrors(): Array<{ provider: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([provider, error]) => ({
      provider,
      error,
    }));
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  /**
   * Map a single provider to its export representation.
   * Override in subclasses to add type-specific fields.
   */
  protected mapProviderToExportItem(name: string, plugin: TPlugin): Record<string, unknown> {
    return {
      name,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      configRequirements: {
        requiresApiKey: plugin.config.requiresApiKey,
        requiresBaseUrl: plugin.config.requiresBaseUrl,
      },
    };
  }

  /**
   * Export registry state for debugging/admin UI.
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      providers: Array.from(this.state.providers.entries()).map(
        ([name, plugin]) => this.mapProviderToExportItem(name, plugin)
      ),
      errors: Array.from(this.state.errors.entries()).map(([provider, error]) => ({
        provider,
        error,
      })),
      stats: this.getStats(),
    };
  }

  // ============================================================================
  // HOT-LOADING (template method)
  // ============================================================================

  /**
   * Template method for hot-loading a provider plugin from disk.
   *
   * @param pluginPath Path to the installed plugin directory
   * @param manifest The validated plugin manifest
   * @param capabilityFilter Capabilities to check in the manifest
   * @param extractPlugin Function to extract the typed plugin from the loaded module
   * @returns true if provider was loaded and registered, false otherwise
   */
  protected hotLoadProviderPluginBase(
    pluginPath: string,
    manifest: PluginManifest,
    capabilityFilter: string[],
    extractPlugin: (pluginModule: unknown) => TPlugin | undefined,
  ): boolean {
    const hasCapability = capabilityFilter.some(cap =>
      manifest.capabilities.includes(cap as any)
    );

    if (!hasCapability) {
      return false;
    }

    try {
      const pluginModule = loadPluginModule(pluginPath, manifest);
      if (!pluginModule) {
        return false;
      }

      const providerPlugin = extractPlugin(pluginModule);

      if (!providerPlugin?.metadata?.providerName) {
        this.registryLogger.warn(`${this.capitalizedTypeName} plugin module does not export a valid plugin object`, {
          plugin: manifest.name,
          exports: Object.keys((pluginModule as Record<string, unknown>) || {}),
        });
        return false;
      }

      if (this.state.providers.has(providerPlugin.metadata.providerName)) {
        this.registryLogger.info(`${this.capitalizedTypeName} already registered, skipping`, {
          plugin: manifest.name,
          provider: providerPlugin.metadata.providerName,
        });
        return true;
      }

      this.registerProvider(providerPlugin);
      this.registryLogger.info(`${this.capitalizedTypeName} plugin hot-loaded successfully`, {
        plugin: manifest.name,
        provider: providerPlugin.metadata.providerName,
        displayName: providerPlugin.metadata.displayName,
      });

      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.registryLogger.error(`Failed to hot-load ${this.typeName} plugin`, {
        plugin: manifest.name,
        error: errorMessage,
      });
      this.state.errors.set(manifest.name, errorMessage);
      return false;
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /** Capitalised form of typeName for use in error messages. */
  private get capitalizedTypeName(): string {
    return this.typeName.charAt(0).toUpperCase() + this.typeName.slice(1);
  }
}
