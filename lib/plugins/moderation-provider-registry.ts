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

import type {
  ModerationProviderPlugin,
} from '@/lib/plugins/interfaces/moderation-provider-plugin';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { AbstractProviderRegistry, type ProviderRegistryBaseState } from './abstract-provider-registry';

// ============================================================================
// TYPES
// ============================================================================

export type ModerationProviderRegistryState = ProviderRegistryBaseState<ModerationProviderPlugin>;

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our moderation provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapModerationProviderRegistryState: ModerationProviderRegistryState | undefined;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ModerationProviderRegistry extends AbstractProviderRegistry<ModerationProviderPlugin> {
  protected readonly registryName = 'moderation-provider-registry';
  protected readonly globalStateKey = '__quilltapModerationProviderRegistryState';
  protected readonly typeName = 'moderation provider';

  protected createEmptyState(): ModerationProviderRegistryState {
    return {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }

  /**
   * Check if any moderation provider is registered and available
   *
   * @returns true if at least one moderation provider is registered
   */
  isModerationConfigured(): boolean {
    return this.isConfigured();
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
    return this.hotLoadProviderPluginBase(
      pluginPath,
      manifest,
      ['MODERATION_PROVIDER'],
      (pluginModule: unknown) => {
        const moduleObj = pluginModule as Record<string, unknown>;

        if (moduleObj.moderationPlugin && (moduleObj.moderationPlugin as ModerationProviderPlugin).metadata?.providerName) {
          return moduleObj.moderationPlugin as ModerationProviderPlugin;
        }

        if (moduleObj.default && (moduleObj.default as Record<string, unknown>).moderationPlugin) {
          return (moduleObj.default as Record<string, unknown>).moderationPlugin as ModerationProviderPlugin;
        }

        return undefined;
      },
    );
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
