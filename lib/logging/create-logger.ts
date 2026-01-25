/**
 * Module Logger Factory
 *
 * Provides a standardized way to create module-specific loggers.
 * Consolidates the pattern of `logger.child({ module: '...' })` that
 * was repeated 50+ times across the codebase.
 */

import { logger } from '@/lib/logger';

/**
 * Create a logger for a specific module
 *
 * This is a convenience wrapper around logger.child() that standardizes
 * the context format for module-specific loggers.
 *
 * @param module - The module name (e.g., 'provider-registry', 'chat-message-service')
 * @returns A child logger with the module context
 *
 * @example
 * ```ts
 * // Before (repeated in every file):
 * import { logger } from '@/lib/logger';
 * const moduleLogger = logger.child({ module: 'provider-registry' });
 *
 * // After:
 * import { createLogger } from '@/lib/logging/create-logger';
 * const logger = createLogger('provider-registry');
 * ```
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

/**
 * Create a logger for an API route
 *
 * Standardizes logging context for API routes with endpoint information.
 *
 * @param endpoint - The API endpoint path (e.g., '/api/v1/characters')
 * @returns A child logger with the endpoint context
 *
 * @example
 * ```ts
 * const logger = createApiLogger('/api/v1/characters');
 *
 * ```
 */
export function createApiLogger(endpoint: string) {
  return logger.child({ endpoint, module: 'api' });
}

/**
 * Create a logger for a service class
 *
 * Standardizes logging context for service classes.
 *
 * @param serviceName - The service class name (e.g., 'ChatMessageService')
 * @returns A child logger with the service context
 *
 * @example
 * ```ts
 * class ChatMessageService {
 *   private logger = createServiceLogger('ChatMessageService');
 *
 *   async sendMessage() {
 *     this.
 *   }
 * }
 * ```
 */
export function createServiceLogger(serviceName: string) {
  return logger.child({ service: serviceName, module: 'service' });
}

/**
 * Create a logger for a repository
 *
 * Standardizes logging context for repository classes.
 *
 * @param repositoryName - The repository name (e.g., 'CharactersRepository')
 * @returns A child logger with the repository context
 *
 * @example
 * ```ts
 * class CharactersRepository {
 *   private logger = createRepositoryLogger('CharactersRepository');
 *
 *   async findById(id: string) {
 *     this.
 *   }
 * }
 * ```
 */
export function createRepositoryLogger(repositoryName: string) {
  return logger.child({ repository: repositoryName, module: 'repository' });
}

/**
 * Create a logger for a plugin
 *
 * Standardizes logging context for plugin modules.
 *
 * @param pluginName - The plugin name (e.g., 'qtap-plugin-openai')
 * @returns A child logger with the plugin context
 *
 * @example
 * ```ts
 * const logger = createPluginLogger('qtap-plugin-openai');
 *
 * ```
 */
export function createPluginLogger(pluginName: string) {
  return logger.child({ plugin: pluginName, module: 'plugin' });
}
