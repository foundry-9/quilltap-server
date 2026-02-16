/**
 * Provider Registry
 *
 * Singleton registry for managing LLM provider plugins.
 * Provides centralized access to provider plugins, metadata, and factory methods
 * for creating provider instances.
 *
 * This registry integrates with the main plugin system, automatically discovering
 * and registering plugins with the LLM_PROVIDER capability.
 *
 * @module plugins/provider-registry
 */

import { logger } from '@/lib/logger';
import type { LLMProviderPlugin, ProviderMetadata, AttachmentSupport, ProviderConfigRequirements, ImageProviderConstraints, MessageFormatSupport, CheapModelConfig, ToolFormatType } from './interfaces/provider-plugin';
import type { LLMProvider } from '@/lib/llm/base';
import type { ImageGenProvider } from '@/lib/image-gen/base';
import type { EmbeddingProvider, LocalEmbeddingProvider } from '@quilltap/plugin-types';
import { getErrorMessage } from '@/lib/errors';
import { rewriteLocalhostUrl } from '@/lib/host-rewrite';
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

export interface ProviderRegistryState {
  initialized: boolean;
  providers: Map<string, LLMProviderPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapProviderRegistryState: ProviderRegistryState | undefined;
}

/**
 * Get or create the global registry state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): ProviderRegistryState {
  if (!global.__quilltapProviderRegistryState) {
    global.__quilltapProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }
  return global.__quilltapProviderRegistryState;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ProviderRegistry {
  private get state(): ProviderRegistryState {
    return getGlobalState();
  }

  private logger = logger.child({
    module: 'provider-registry',
  });

  /**
   * Register a provider plugin
   *
   * @param plugin The provider plugin to register
   * @throws Error if provider with same name is already registered
   */
  registerProvider(plugin: LLMProviderPlugin): void {
    const providerName = plugin.metadata.providerName;

    if (this.state.providers.has(providerName)) {
      const error = `Provider '${providerName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    this.state.providers.set(providerName, plugin);
  }

  /**
   * Get a specific provider plugin by name
   *
   * @param name The provider name (e.g., 'OPENAI')
   * @returns The provider plugin or null if not found
   */
  getProvider(name: string): LLMProviderPlugin | null {
    return this.state.providers.get(name) || null;
  }

  /**
   * Get all registered provider plugins
   *
   * @returns Array of all registered provider plugins
   */
  getAllProviders(): LLMProviderPlugin[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Check if a provider is registered
   *
   * @param name The provider name
   * @returns true if provider is registered, false otherwise
   */
  hasProvider(name: string): boolean {
    return this.state.providers.has(name);
  }

  /**
   * Get list of all registered provider names
   *
   * Useful for populating dropdown menus and provider selection UI
   *
   * @returns Array of provider names (e.g., ['OPENAI', 'ANTHROPIC', ...])
   */
  getProviderNames(): string[] {
    return Array.from(this.state.providers.keys());
  }

  /**
   * Create an LLMProvider instance from a registered plugin
   *
   * @param name The provider name
   * @param baseUrl Optional base URL for providers that support custom endpoints
   * @returns An instantiated LLMProvider
   * @throws Error if provider not found or creation fails
   */
  createLLMProvider(name: string, baseUrl?: string): LLMProvider {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const resolvedUrl = baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
      return plugin.createProvider(resolvedUrl);
    } catch (error) {
      this.logger.error('Failed to create LLM provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Create an ImageGenProvider instance from a registered plugin
   *
   * @param name The provider name
   * @param baseUrl Optional base URL for providers that support custom endpoints
   * @returns An instantiated ImageGenProvider
   * @throws Error if provider not found, doesn't support image generation, or creation fails
   */
  createImageProvider(name: string, baseUrl?: string): ImageGenProvider {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    if (!plugin.capabilities.imageGeneration) {
      const error = `Provider '${name}' does not support image generation`;
      this.logger.warn(error);
      throw new Error(error);
    }

    if (!plugin.createImageProvider) {
      const error = `Provider '${name}' does not implement createImageProvider`;
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const resolvedUrl = baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
      return plugin.createImageProvider(resolvedUrl);
    } catch (error) {
      this.logger.error('Failed to create image provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Create an EmbeddingProvider instance from a registered plugin
   *
   * @param name The provider name
   * @param baseUrl Optional base URL for providers that support custom endpoints
   * @returns An instantiated EmbeddingProvider or LocalEmbeddingProvider
   * @throws Error if provider not found, doesn't support embeddings, or creation fails
   */
  createEmbeddingProvider(name: string, baseUrl?: string): EmbeddingProvider | LocalEmbeddingProvider {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    if (!plugin.capabilities.embeddings) {
      const error = `Provider '${name}' does not support embeddings`;
      this.logger.warn(error);
      throw new Error(error);
    }

    if (!plugin.createEmbeddingProvider) {
      const error = `Provider '${name}' does not implement createEmbeddingProvider`;
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      const resolvedUrl = baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
      return plugin.createEmbeddingProvider(resolvedUrl);
    } catch (error) {
      this.logger.error('Failed to create embedding provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get metadata for a specific provider
   *
   * Metadata includes display name, colors, abbreviation, etc.
   * Useful for UI rendering and provider identification.
   *
   * @param name The provider name
   * @returns The provider metadata or null if not found
   */
  getProviderMetadata(name: string): ProviderMetadata | null {
    const plugin = this.getProvider(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered providers
   *
   * @returns Array of provider metadata objects
   */
  getAllProviderMetadata(): ProviderMetadata[] {
    return this.getAllProviders().map(p => p.metadata);
  }

  /**
   * Get attachment support information for a provider
   *
   * @param name The provider name
   * @returns Attachment support info or null if not found
   */
  getAttachmentSupport(name: string): AttachmentSupport | null {
    const plugin = this.getProvider(name);
    return plugin?.attachmentSupport || null;
  }

  /**
   * Get configuration requirements for a provider
   *
   * @param name The provider name
   * @returns Configuration requirements or null if not found
   */
  getConfigRequirements(name: string): ProviderConfigRequirements | null {
    const plugin = this.getProvider(name);
    return plugin?.config || null;
  }

  /**
   * Get all providers that support a specific capability
   *
   * @param capability The capability to check ('chat', 'imageGeneration', 'embeddings', 'webSearch')
   * @returns Array of provider plugins with the capability
   */
  getProvidersByCapability(capability: keyof typeof DEFAULT_CAPABILITIES): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.capabilities[capability]
    );
  }

  /**
   * Check if a provider supports a specific capability
   *
   * @param name The provider name
   * @param capability The capability to check
   * @returns true if provider supports the capability, false otherwise
   */
  supportsCapability(name: string, capability: keyof typeof DEFAULT_CAPABILITIES): boolean {
    const plugin = this.getProvider(name);
    return plugin?.capabilities[capability] ?? false;
  }

  /**
   * Get all providers that support attachments
   *
   * @returns Array of provider plugins with attachment support
   */
  getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.attachmentSupport.supportsAttachments
    );
  }

  /**
   * Get image provider constraints for a provider
   *
   * Returns constraints and limitations for image generation.
   * Used to apply provider-specific constraints to image generation tools.
   *
   * @param name The provider name
   * @returns Image provider constraints or null if not found/not supported
   */
  getImageProviderConstraints(name: string): ImageProviderConstraints | null {
    const plugin = this.getProvider(name);
    if (!plugin) {
      return null;
    }

    // Check if provider supports image generation
    if (!plugin.capabilities.imageGeneration) {
      return null;
    }

    // Call getImageProviderConstraints if it exists
    if (plugin.getImageProviderConstraints && typeof plugin.getImageProviderConstraints === 'function') {
      return plugin.getImageProviderConstraints();
    }

    return null;
  }

  // =========================================================================
  // Runtime Configuration Query Methods
  // =========================================================================

  /**
   * Get message format support for a provider
   *
   * Returns the provider's configuration for handling the 'name' field
   * in messages (used for multi-character chats).
   *
   * @param name The provider name
   * @returns MessageFormatSupport or default (no name support) if not found
   */
  getMessageFormat(name: string): MessageFormatSupport {
    const plugin = this.getProvider(name);
    return plugin?.messageFormat ?? { supportsNameField: false, supportedRoles: [] };
  }

  /**
   * Get token estimation multiplier for a provider
   *
   * Returns characters-per-token ratio for estimating token counts.
   *
   * @param name The provider name
   * @returns Characters per token (default: 3.5)
   */
  getCharsPerToken(name: string): number {
    const plugin = this.getProvider(name);
    return plugin?.charsPerToken ?? 3.5;
  }

  /**
   * Get tool format type for a provider
   *
   * Returns the tool format this provider expects.
   *
   * @param name The provider name
   * @returns Tool format type (default: 'openai')
   */
  getToolFormat(name: string): ToolFormatType {
    const plugin = this.getProvider(name);
    return plugin?.toolFormat ?? 'openai';
  }

  /**
   * Get cheap model configuration for a provider
   *
   * Returns the recommended models for cheap/background tasks.
   *
   * @param name The provider name
   * @returns CheapModelConfig or null if not configured
   */
  getCheapModelConfig(name: string): CheapModelConfig | null {
    const plugin = this.getProvider(name);
    return plugin?.cheapModels ?? null;
  }

  /**
   * Get default context window for a provider
   *
   * Returns the fallback context window when model is unknown.
   *
   * @param name The provider name
   * @returns Default context window (default: 8192)
   */
  getDefaultContextWindow(name: string): number {
    const plugin = this.getProvider(name);
    return plugin?.defaultContextWindow ?? 8192;
  }

  /**
   * Get model pricing from plugin's getModelInfo()
   *
   * Queries the plugin's model info for pricing data.
   *
   * @param providerName The provider name
   * @param modelId The model identifier
   * @returns Pricing object or null if not found
   */
  getModelPricing(providerName: string, modelId: string): { input: number; output: number } | null {
    const plugin = this.getProvider(providerName);
    const models = plugin?.getModelInfo?.() ?? [];
    const model = models.find(m => m.id === modelId);
    return model?.pricing ?? null;
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * @param providers Array of provider plugins to register
   */
  async initialize(providers: LLMProviderPlugin[]): Promise<void> {
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
        this.logger.warn('Failed to register provider', {
          name: providerName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered providers
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
   * Get all errors from provider registration
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
   * Reset the registry (for testing)
   *
   * @internal
   */
  reset(): void {
    // Reset the global state entirely
    global.__quilltapProviderRegistryState = {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }

  /**
   * Hot-load a provider plugin from disk after installation
   *
   * Loads a provider plugin module and registers it with the registry
   * without requiring a full server restart.
   *
   * @param pluginPath Path to the installed plugin directory
   * @param manifest The validated plugin manifest
   * @returns true if provider was loaded and registered, false otherwise
   */
  hotLoadProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
    // Handle LLM_PROVIDER or EMBEDDING_PROVIDER plugins
    const isLLMProvider = manifest.capabilities.includes('LLM_PROVIDER');
    const isEmbeddingProvider = manifest.capabilities.includes('EMBEDDING_PROVIDER');

    if (!isLLMProvider && !isEmbeddingProvider) {
      return false;
    }

    try {
      const mainFile = manifest.main || 'index.js';
      const modulePath = resolve(pluginPath, mainFile);

      if (!existsSync(modulePath)) {
        this.logger.error('Provider plugin main file not found', {
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

      // Extract the provider plugin object
      const providerPlugin = pluginModule?.plugin || pluginModule?.default?.plugin;

      if (!providerPlugin?.metadata?.providerName) {
        this.logger.warn('Provider plugin module does not export a valid plugin object', {
          plugin: manifest.name,
          exports: Object.keys(pluginModule || {}),
        });
        return false;
      }

      // Check if already registered (e.g., from a previous hot-load or startup)
      if (this.state.providers.has(providerPlugin.metadata.providerName)) {
        this.logger.info('Provider already registered, skipping', {
          plugin: manifest.name,
          provider: providerPlugin.metadata.providerName,
        });
        return true; // Already available, consider it success
      }

      // Register the provider
      this.registerProvider(providerPlugin);
      this.logger.info('Provider plugin hot-loaded successfully', {
        plugin: manifest.name,
        provider: providerPlugin.metadata.providerName,
        displayName: providerPlugin.metadata.displayName,
      });

      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to hot-load provider plugin', {
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
        capabilities: plugin.capabilities,
        attachmentSupport: plugin.attachmentSupport,
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
// DEFAULT CAPABILITIES
// ============================================================================

const DEFAULT_CAPABILITIES = {
  chat: 'chat',
  imageGeneration: 'imageGeneration',
  embeddings: 'embeddings',
  webSearch: 'webSearch',
} as const;

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global provider registry instance
 */
export const providerRegistry = new ProviderRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a provider plugin
 *
 * @param plugin The provider plugin to register
 */
export function registerProvider(plugin: LLMProviderPlugin): void {
  providerRegistry.registerProvider(plugin);
}

/**
 * Get a provider plugin by name
 *
 * @param name The provider name
 * @returns The provider plugin or null
 */
export function getProvider(name: string): LLMProviderPlugin | null {
  return providerRegistry.getProvider(name);
}

/**
 * Get all registered provider plugins
 *
 * @returns Array of all registered providers
 */
export function getAllProviders(): LLMProviderPlugin[] {
  return providerRegistry.getAllProviders();
}

/**
 * Check if a provider is registered
 *
 * @param name The provider name
 * @returns true if provider exists
 */
export function hasProvider(name: string): boolean {
  return providerRegistry.hasProvider(name);
}

/**
 * Get list of provider names
 *
 * @returns Array of provider names
 */
export function getProviderNames(): string[] {
  return providerRegistry.getProviderNames();
}

/**
 * Create an LLMProvider instance
 *
 * @param name The provider name
 * @param baseUrl Optional base URL
 * @returns Instantiated LLMProvider
 */
export function createLLMProvider(name: string, baseUrl?: string): LLMProvider {
  return providerRegistry.createLLMProvider(name, baseUrl);
}

/**
 * Create an ImageGenProvider instance
 *
 * @param name The provider name
 * @param baseUrl Optional base URL
 * @returns Instantiated ImageGenProvider
 */
export function createImageProvider(name: string, baseUrl?: string): ImageGenProvider {
  return providerRegistry.createImageProvider(name, baseUrl);
}

/**
 * Create an EmbeddingProvider instance
 *
 * @param name The provider name
 * @param baseUrl Optional base URL
 * @returns Instantiated EmbeddingProvider or LocalEmbeddingProvider
 */
export function createEmbeddingProvider(name: string, baseUrl?: string): EmbeddingProvider | LocalEmbeddingProvider {
  return providerRegistry.createEmbeddingProvider(name, baseUrl);
}

/**
 * Get provider metadata
 *
 * @param name The provider name
 * @returns Provider metadata or null
 */
export function getProviderMetadata(name: string): ProviderMetadata | null {
  return providerRegistry.getProviderMetadata(name);
}

/**
 * Get all provider metadata
 *
 * @returns Array of metadata for all providers
 */
export function getAllProviderMetadata(): ProviderMetadata[] {
  return providerRegistry.getAllProviderMetadata();
}

/**
 * Get attachment support for a provider
 *
 * @param name The provider name
 * @returns Attachment support info or null
 */
export function getAttachmentSupport(name: string): AttachmentSupport | null {
  return providerRegistry.getAttachmentSupport(name);
}

/**
 * Get configuration requirements for a provider
 *
 * @param name The provider name
 * @returns Config requirements or null
 */
export function getConfigRequirements(name: string): ProviderConfigRequirements | null {
  return providerRegistry.getConfigRequirements(name);
}

/**
 * Get providers with a specific capability
 *
 * @param capability The capability to check
 * @returns Array of providers with the capability
 */
export function getProvidersByCapability(
  capability: keyof typeof DEFAULT_CAPABILITIES
): LLMProviderPlugin[] {
  return providerRegistry.getProvidersByCapability(capability);
}

/**
 * Check if provider supports a capability
 *
 * @param name The provider name
 * @param capability The capability to check
 * @returns true if supported
 */
export function supportsCapability(
  name: string,
  capability: keyof typeof DEFAULT_CAPABILITIES
): boolean {
  return providerRegistry.supportsCapability(name, capability);
}

/**
 * Get providers with attachment support
 *
 * @returns Array of providers supporting attachments
 */
export function getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
  return providerRegistry.getProvidersWithAttachmentSupport();
}

/**
 * Get image provider constraints for a provider
 *
 * @param name The provider name
 * @returns Image provider constraints or null
 */
export function getImageProviderConstraints(name: string): ImageProviderConstraints | null {
  return providerRegistry.getImageProviderConstraints(name);
}

/**
 * Initialize the provider registry
 *
 * @param providers Array of provider plugins to register
 */
export async function initializeProviderRegistry(providers: LLMProviderPlugin[]): Promise<void> {
  return providerRegistry.initialize(providers);
}

/**
 * Get registry statistics
 *
 * @returns Statistics about registered providers
 */
export function getProviderRegistryStats() {
  return providerRegistry.getStats();
}

/**
 * Get registry errors
 *
 * @returns Array of registration errors
 */
export function getProviderRegistryErrors() {
  return providerRegistry.getErrors();
}

/**
 * Check if registry is initialized
 *
 * @returns true if initialized
 */
export function isProviderRegistryInitialized(): boolean {
  return providerRegistry.isInitialized();
}

// ============================================================================
// RUNTIME CONFIGURATION CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get message format support for a provider
 *
 * @param name The provider name
 * @returns MessageFormatSupport or default (no name support)
 */
export function getMessageFormat(name: string): MessageFormatSupport {
  return providerRegistry.getMessageFormat(name);
}

/**
 * Get token estimation multiplier for a provider
 *
 * @param name The provider name
 * @returns Characters per token (default: 3.5)
 */
export function getCharsPerToken(name: string): number {
  return providerRegistry.getCharsPerToken(name);
}

/**
 * Get tool format type for a provider
 *
 * @param name The provider name
 * @returns Tool format type (default: 'openai')
 */
export function getToolFormat(name: string): ToolFormatType {
  return providerRegistry.getToolFormat(name);
}

/**
 * Get cheap model configuration for a provider
 *
 * @param name The provider name
 * @returns CheapModelConfig or null
 */
export function getCheapModelConfig(name: string): CheapModelConfig | null {
  return providerRegistry.getCheapModelConfig(name);
}

/**
 * Get default context window for a provider
 *
 * @param name The provider name
 * @returns Default context window (default: 8192)
 */
export function getDefaultContextWindow(name: string): number {
  return providerRegistry.getDefaultContextWindow(name);
}

/**
 * Get model pricing from plugin's getModelInfo()
 *
 * @param providerName The provider name
 * @param modelId The model identifier
 * @returns Pricing object or null
 */
export function getModelPricing(providerName: string, modelId: string): { input: number; output: number } | null {
  return providerRegistry.getModelPricing(providerName, modelId);
}

/**
 * Hot-load a provider plugin from disk after installation
 *
 * @param pluginPath Path to the installed plugin directory
 * @param manifest The validated plugin manifest
 * @returns true if provider was loaded and registered
 */
export function hotLoadProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
  return providerRegistry.hotLoadProviderPlugin(pluginPath, manifest);
}
