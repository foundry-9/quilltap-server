/**
 * Moderation Provider Registry
 *
 * Singleton registry for managing content moderation provider plugins.
 * Provides centralized access to moderation provider plugins and metadata.
 *
 * Moderation providers power the Concierge content classification system
 * by providing pluggable backends (e.g., OpenAI moderation endpoint).
 *
 * @module plugins/moderation-provider-registry
 */

import { logger } from '@/lib/logger';
import type {
  ModerationProviderPlugin,
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
} from '@/lib/plugins/interfaces/moderation-provider-plugin';
import { getErrorMessage } from '@/lib/errors';
import { rewriteLocalhostUrl } from '@/lib/host-rewrite';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { loadPluginModule, extractPluginExport } from './dynamic-loader';

// ============================================================================
// TYPES
// ============================================================================

export interface ModerationProviderRegistryState {
  initialized: boolean;
  providers: Map<string, ModerationProviderPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our moderation provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapModerationProviderRegistryState: ModerationProviderRegistryState | undefined;
}

/**
 * Get or create the global registry state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): ModerationProviderRegistryState {
  if (!global.__quilltapModerationProviderRegistryState) {
    global.__quilltapModerationProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }
  return global.__quilltapModerationProviderRegistryState;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ModerationProviderRegistry {
  private get state(): ModerationProviderRegistryState {
    return getGlobalState();
  }

  private logger = logger.child({
    module: 'moderation-provider-registry',
  });

  /**
   * Register a moderation provider plugin
   *
   * @param plugin The moderation provider plugin to register
   * @throws Error if provider with same name is already registered
   */
  registerProvider(plugin: ModerationProviderPlugin): void {
    const providerName = plugin.metadata.providerName;

    if (this.state.providers.has(providerName)) {
      const error = `Moderation provider '${providerName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    this.state.providers.set(providerName, plugin);
  }

  /**
   * Get a specific moderation provider plugin by name
   *
   * @param name The provider name (e.g., 'OPENAI')
   * @returns The moderation provider plugin or null if not found
   */
  getProvider(name: string): ModerationProviderPlugin | null {
    return this.state.providers.get(name) || null;
  }

  /**
   * Get all registered moderation provider plugins
   *
   * @returns Array of all registered moderation provider plugins
   */
  getAllProviders(): ModerationProviderPlugin[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Check if a moderation provider is registered
   *
   * @param name The provider name
   * @returns true if provider is registered, false otherwise
   */
  hasProvider(name: string): boolean {
    return this.state.providers.has(name);
  }

  /**
   * Get list of all registered moderation provider names
   *
   * @returns Array of provider names (e.g., ['OPENAI', ...])
   */
  getProviderNames(): string[] {
    return Array.from(this.state.providers.keys());
  }

  /**
   * Get metadata for a specific moderation provider
   *
   * @param name The provider name
   * @returns The provider metadata or null if not found
   */
  getProviderMetadata(name: string): ModerationProviderMetadata | null {
    const plugin = this.getProvider(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered moderation providers
   *
   * @returns Array of moderation provider metadata objects
   */
  getAllProviderMetadata(): ModerationProviderMetadata[] {
    return this.getAllProviders().map(p => p.metadata);
  }

  /**
   * Get configuration requirements for a moderation provider
   *
   * @param name The provider name
   * @returns Configuration requirements or null if not found
   */
  getConfigRequirements(name: string): ModerationProviderConfigRequirements | null {
    const plugin = this.getProvider(name);
    return plugin?.config || null;
  }

  /**
   * Get the default (first registered) moderation provider
   *
   * @returns The first registered moderation provider plugin, or null if none registered
   */
  getDefaultProvider(): ModerationProviderPlugin | null {
    const providers = this.getAllProviders();
    return providers.length > 0 ? providers[0] : null;
  }

  /**
   * Check if any moderation provider is registered and available
   *
   * @returns true if at least one moderation provider is registered
   */
  isModerationConfigured(): boolean {
    return this.state.providers.size > 0;
  }

  /**
   * Validate an API key using the moderation provider plugin, with localhost URL rewriting.
   *
   * @param name The provider name
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL (will be rewritten if localhost in VM/container)
   * @returns true if the API key is valid, or false if provider has no validateApiKey
   * @throws Error if provider not found
   */
  async validateApiKey(name: string, apiKey: string, baseUrl?: string): Promise<boolean> {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Moderation provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    if (!plugin.validateApiKey) {
      return false;
    }

    const resolvedUrl = baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
    this.logger.debug('Validating moderation provider API key with URL rewriting', {
      provider: name,
      originalUrl: baseUrl,
      resolvedUrl,
    });
    return plugin.validateApiKey(apiKey, resolvedUrl);
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * @param providers Array of moderation provider plugins to register
   */
  async initialize(providers: ModerationProviderPlugin[]): Promise<void> {
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
        this.logger.warn('Failed to register moderation provider', {
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
    global.__quilltapModerationProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered moderation providers
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
   * Get all errors from moderation provider registration
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
   * Hot-load a moderation provider plugin from disk after installation
   *
   * Loads a moderation provider plugin module and registers it with the registry
   * without requiring a full server restart.
   *
   * @param pluginPath Path to the installed plugin directory
   * @param manifest The validated plugin manifest
   * @returns true if moderation provider was loaded and registered, false otherwise
   */
  hotLoadModerationProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
    const isModerationProvider = manifest.capabilities.includes('MODERATION_PROVIDER');

    if (!isModerationProvider) {
      return false;
    }

    try {
      const pluginModule = loadPluginModule(pluginPath, manifest);
      if (!pluginModule) {
        return false;
      }

      // Extract the moderation provider plugin object
      // Moderation plugins export as { moderationPlugin: ModerationProviderPlugin }
      const moduleObj = pluginModule as Record<string, unknown>;
      let moderationProviderPlugin: ModerationProviderPlugin | undefined;

      if (moduleObj.moderationPlugin && (moduleObj.moderationPlugin as ModerationProviderPlugin).metadata?.providerName) {
        moderationProviderPlugin = moduleObj.moderationPlugin as ModerationProviderPlugin;
      } else if (moduleObj.default && (moduleObj.default as Record<string, unknown>).moderationPlugin) {
        moderationProviderPlugin = (moduleObj.default as Record<string, unknown>).moderationPlugin as ModerationProviderPlugin;
      }

      if (!moderationProviderPlugin?.metadata?.providerName) {
        this.logger.warn('Moderation provider plugin module does not export a valid moderationPlugin object', {
          plugin: manifest.name,
          exports: Object.keys(moduleObj || {}),
        });
        return false;
      }

      // Check if already registered
      if (this.state.providers.has(moderationProviderPlugin.metadata.providerName)) {
        this.logger.info('Moderation provider already registered, skipping', {
          plugin: manifest.name,
          provider: moderationProviderPlugin.metadata.providerName,
        });
        return true;
      }

      // Register the provider
      this.registerProvider(moderationProviderPlugin);
      this.logger.info('Moderation provider plugin hot-loaded successfully', {
        plugin: manifest.name,
        provider: moderationProviderPlugin.metadata.providerName,
        displayName: moderationProviderPlugin.metadata.displayName,
      });

      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to hot-load moderation provider plugin', {
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
 * Global moderation provider registry instance
 */
export const moderationProviderRegistry = new ModerationProviderRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a moderation provider plugin
 */
export function registerModerationProvider(plugin: ModerationProviderPlugin): void {
  moderationProviderRegistry.registerProvider(plugin);
}

/**
 * Get a moderation provider plugin by name
 */
export function getModerationProvider(name: string): ModerationProviderPlugin | null {
  return moderationProviderRegistry.getProvider(name);
}

/**
 * Get all registered moderation provider plugins
 */
export function getAllModerationProviders(): ModerationProviderPlugin[] {
  return moderationProviderRegistry.getAllProviders();
}

/**
 * Check if a moderation provider is registered
 */
export function hasModerationProvider(name: string): boolean {
  return moderationProviderRegistry.hasProvider(name);
}

/**
 * Get the default (first registered) moderation provider
 */
export function getDefaultModerationProvider(): ModerationProviderPlugin | null {
  return moderationProviderRegistry.getDefaultProvider();
}

/**
 * Check if any moderation provider is configured and available
 */
export function isModerationConfigured(): boolean {
  return moderationProviderRegistry.isModerationConfigured();
}

/**
 * Initialize the moderation provider registry
 */
export async function initializeModerationProviderRegistry(providers: ModerationProviderPlugin[]): Promise<void> {
  return moderationProviderRegistry.initialize(providers);
}

/**
 * Get moderation provider registry statistics
 */
export function getModerationProviderRegistryStats() {
  return moderationProviderRegistry.getStats();
}

/**
 * Check if moderation provider registry is initialized
 */
export function isModerationProviderRegistryInitialized(): boolean {
  return moderationProviderRegistry.isInitialized();
}

/**
 * Hot-load a moderation provider plugin from disk after installation
 */
export function hotLoadModerationProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
  return moderationProviderRegistry.hotLoadModerationProviderPlugin(pluginPath, manifest);
}
