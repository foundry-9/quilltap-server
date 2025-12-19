/**
 * Arctic Provider Registry
 *
 * Manages Arctic OAuth provider plugins.
 * Similar to the old auth provider registry but for Arctic.
 */

import { logger } from '@/lib/logger';
import type {
  ArcticProviderPlugin,
  ArcticProviderInstance,
  ArcticProviderConfig,
  ArcticUserInfo,
} from './types';

/**
 * Registered Arctic providers
 */
const arcticProviders: Map<string, ArcticProviderPlugin> = new Map();

/**
 * Cached provider instances
 */
const providerInstances: Map<string, ArcticProviderInstance> = new Map();

/**
 * Register an Arctic provider plugin
 *
 * @param plugin - The Arctic provider plugin to register
 */
export function registerArcticProvider(plugin: ArcticProviderPlugin): void {
  const { providerId, displayName } = plugin.config;

  if (arcticProviders.has(providerId)) {
    logger.warn('Arctic provider already registered, replacing', {
      context: 'arctic.registry.registerArcticProvider',
      providerId,
    });
  }

  arcticProviders.set(providerId, plugin);

  // Clear cached instance if exists
  providerInstances.delete(providerId);

  logger.info('Arctic provider registered', {
    context: 'arctic.registry.registerArcticProvider',
    providerId,
    displayName,
    isConfigured: plugin.isConfigured(),
  });
}

/**
 * Unregister an Arctic provider
 *
 * @param providerId - The provider ID to unregister
 */
export function unregisterArcticProvider(providerId: string): void {
  arcticProviders.delete(providerId);
  providerInstances.delete(providerId);

  logger.debug('Arctic provider unregistered', {
    context: 'arctic.registry.unregisterArcticProvider',
    providerId,
  });
}

/**
 * Get all registered Arctic providers
 *
 * @returns Map of all registered providers
 */
export function getAllArcticProviders(): Map<string, ArcticProviderPlugin> {
  return new Map(arcticProviders);
}

/**
 * Get an Arctic provider by ID
 *
 * @param providerId - The provider ID
 * @returns The provider plugin or null
 */
export function getArcticProviderPlugin(providerId: string): ArcticProviderPlugin | null {
  return arcticProviders.get(providerId) || null;
}

/**
 * Get an Arctic provider instance by ID
 * Creates the instance if not already cached
 *
 * @param providerId - The provider ID
 * @returns The provider instance or null if not configured
 */
export function getArcticProvider(providerId: string): ArcticProviderInstance | null {
  // Check cache first
  const cached = providerInstances.get(providerId);
  if (cached) {
    return cached;
  }

  // Get plugin
  const plugin = arcticProviders.get(providerId);
  if (!plugin) {
    logger.debug('Arctic provider not found', {
      context: 'arctic.registry.getArcticProvider',
      providerId,
    });
    return null;
  }

  // Check if configured
  if (!plugin.isConfigured()) {
    logger.debug('Arctic provider not configured', {
      context: 'arctic.registry.getArcticProvider',
      providerId,
      missingVars: plugin.getConfigStatus().missingVars,
    });
    return null;
  }

  // Create instance
  const instance = plugin.createArcticProvider();
  if (!instance) {
    logger.warn('Arctic provider failed to create instance', {
      context: 'arctic.registry.getArcticProvider',
      providerId,
    });
    return null;
  }

  // Cache instance
  providerInstances.set(providerId, instance);

  logger.debug('Arctic provider instance created', {
    context: 'arctic.registry.getArcticProvider',
    providerId,
  });

  return instance;
}

/**
 * Fetch user info from an OAuth provider
 *
 * @param providerId - The provider ID
 * @param accessToken - The access token from OAuth
 * @returns User info or null
 */
export async function fetchProviderUserInfo(
  providerId: string,
  accessToken: string
): Promise<ArcticUserInfo | null> {
  const plugin = arcticProviders.get(providerId);
  if (!plugin) {
    logger.warn('Cannot fetch user info - provider not found', {
      context: 'arctic.registry.fetchProviderUserInfo',
      providerId,
    });
    return null;
  }

  try {
    const userInfo = await plugin.fetchUserInfo(accessToken);
    logger.debug('User info fetched from provider', {
      context: 'arctic.registry.fetchProviderUserInfo',
      providerId,
      userId: userInfo.id,
    });
    return userInfo;
  } catch (error) {
    logger.error(
      'Failed to fetch user info from provider',
      { context: 'arctic.registry.fetchProviderUserInfo', providerId },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Get scopes for an OAuth provider
 *
 * @param providerId - The provider ID
 * @returns Array of scopes
 */
export function getProviderScopes(providerId: string): string[] {
  const plugin = arcticProviders.get(providerId);
  if (!plugin) {
    return [];
  }
  return plugin.getScopes();
}

/**
 * Get configured Arctic providers
 *
 * @returns Array of configured provider plugins
 */
export function getConfiguredArcticProviders(): ArcticProviderPlugin[] {
  const configured: ArcticProviderPlugin[] = [];

  for (const plugin of arcticProviders.values()) {
    if (plugin.isConfigured()) {
      configured.push(plugin);
    }
  }

  return configured;
}

/**
 * Get provider configs for UI display
 *
 * @returns Array of provider configs for configured providers
 */
export function getArcticProviderConfigs(): ArcticProviderConfig[] {
  return getConfiguredArcticProviders().map((plugin) => plugin.config);
}

/**
 * Clear all registered providers and cached instances
 * Useful for testing or hot-reload
 */
export function clearArcticProviders(): void {
  arcticProviders.clear();
  providerInstances.clear();

  logger.debug('All Arctic providers cleared', {
    context: 'arctic.registry.clearArcticProviders',
  });
}

/**
 * Refresh provider configuration status
 * Re-checks environment variables for all providers
 */
export function refreshArcticProviderStatus(): void {
  // Clear cached instances to force re-creation
  providerInstances.clear();

  for (const [providerId, plugin] of arcticProviders) {
    const status = plugin.getConfigStatus();
    logger.debug('Arctic provider status refreshed', {
      context: 'arctic.registry.refreshArcticProviderStatus',
      providerId,
      isConfigured: status.isConfigured,
      missingVars: status.missingVars,
    });
  }
}
