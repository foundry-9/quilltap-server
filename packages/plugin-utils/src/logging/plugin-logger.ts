/**
 * Plugin Logger Bridge
 *
 * Provides a logger factory for plugins that automatically bridges
 * to Quilltap's core logging when running inside the host application,
 * or falls back to console logging when running standalone.
 *
 * @module @quilltap/plugin-utils/logging/plugin-logger
 */

import type { PluginLogger, LogContext, LogLevel } from '@quilltap/plugin-types';

/**
 * Extended logger interface with child logger support
 */
export interface PluginLoggerWithChild extends PluginLogger {
  /**
   * Create a child logger with additional context
   * @param additionalContext Context to merge with parent context
   * @returns A new logger with combined context
   */
  child(additionalContext: LogContext): PluginLoggerWithChild;
}

/**
 * Type for the global Quilltap logger bridge
 * Stored on globalThis to work across different npm package copies
 */
declare global {
  // eslint-disable-next-line no-var
  var __quilltap_logger_factory:
    | ((pluginName: string) => PluginLoggerWithChild)
    | undefined;
}

/**
 * Get the core logger factory from global namespace
 *
 * @returns The injected factory or null if not in Quilltap environment
 */
function getCoreLoggerFactory(): ((pluginName: string) => PluginLoggerWithChild) | null {
  return globalThis.__quilltap_logger_factory ?? null;
}

/**
 * Inject the core logger factory from Quilltap host
 *
 * This is called by Quilltap core when loading plugins to bridge
 * plugin logging into the host's logging system. Uses globalThis
 * to ensure it works even when plugins have their own copy of
 * plugin-utils in their node_modules.
 *
 * **Internal API - not for plugin use**
 *
 * @param factory A function that creates a child logger for a plugin
 */
export function __injectCoreLoggerFactory(
  factory: (pluginName: string) => PluginLoggerWithChild
): void {
  globalThis.__quilltap_logger_factory = factory;
}

/**
 * Clear the injected core logger factory
 *
 * Useful for testing or when unloading the plugin system.
 *
 * **Internal API - not for plugin use**
 */
export function __clearCoreLoggerFactory(): void {
  globalThis.__quilltap_logger_factory = undefined;
}

/**
 * Check if a core logger has been injected
 *
 * @returns True if running inside Quilltap with core logging available
 */
export function hasCoreLogger(): boolean {
  return getCoreLoggerFactory() !== null;
}

/**
 * Create a console logger with child support
 *
 * @param prefix Logger prefix
 * @param minLevel Minimum log level
 * @param baseContext Base context to include in all logs
 */
function createConsoleLoggerWithChild(
  prefix: string,
  minLevel: LogLevel = 'debug',
  baseContext: LogContext = {}
): PluginLoggerWithChild {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const shouldLog = (level: LogLevel): boolean =>
    levels.indexOf(level) >= levels.indexOf(minLevel);

  const formatContext = (context?: LogContext): string => {
    const merged = { ...baseContext, ...context };
    const entries = Object.entries(merged)
      .filter(([key]) => key !== 'context')
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    return entries ? ` ${entries}` : '';
  };

  const logger: PluginLoggerWithChild = {
    debug: (message: string, context?: LogContext): void => {
      if (shouldLog('debug')) {
        console.debug(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },

    info: (message: string, context?: LogContext): void => {
      if (shouldLog('info')) {
        console.info(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },

    warn: (message: string, context?: LogContext): void => {
      if (shouldLog('warn')) {
        console.warn(`[${prefix}] ${message}${formatContext(context)}`);
      }
    },

    error: (message: string, context?: LogContext, error?: Error): void => {
      if (shouldLog('error')) {
        console.error(
          `[${prefix}] ${message}${formatContext(context)}`,
          error ? `\n${error.stack || error.message}` : ''
        );
      }
    },

    child: (additionalContext: LogContext): PluginLoggerWithChild => {
      return createConsoleLoggerWithChild(prefix, minLevel, {
        ...baseContext,
        ...additionalContext,
      });
    },
  };

  return logger;
}

/**
 * Create a plugin logger that bridges to Quilltap core logging
 *
 * When running inside Quilltap:
 * - Routes all logs to the core logger
 * - Tags logs with `{ plugin: pluginName, module: 'plugin' }`
 * - Logs appear in Quilltap's combined.log and console
 *
 * When running standalone:
 * - Falls back to console logging with `[pluginName]` prefix
 * - Respects the specified minimum log level
 *
 * @param pluginName - The plugin identifier (e.g., 'qtap-plugin-openai')
 * @param minLevel - Minimum log level when running standalone (default: 'debug')
 * @returns A logger instance
 *
 * @example
 * ```typescript
 * // In your plugin's provider.ts
 * import { createPluginLogger } from '@quilltap/plugin-utils';
 *
 * const logger = createPluginLogger('qtap-plugin-my-provider');
 *
 * export class MyProvider implements LLMProvider {
 *   async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
 *     logger.debug('Sending message', { model: params.model });
 *
 *     try {
 *       const response = await this.client.chat({...});
 *       logger.info('Received response', { tokens: response.usage?.total_tokens });
 *       return response;
 *     } catch (error) {
 *       logger.error('Failed to send message', { model: params.model }, error as Error);
 *       throw error;
 *     }
 *   }
 * }
 * ```
 */
export function createPluginLogger(
  pluginName: string,
  minLevel: LogLevel = 'debug'
): PluginLoggerWithChild {
  // Check for core logger factory from global namespace
  const coreFactory = getCoreLoggerFactory();
  if (coreFactory) {
    return coreFactory(pluginName);
  }

  // Standalone mode: use enhanced console logger
  return createConsoleLoggerWithChild(pluginName, minLevel);
}

/**
 * Get the minimum log level from environment
 *
 * Checks for LOG_LEVEL or QUILTTAP_LOG_LEVEL environment variables.
 * Useful for configuring standalone plugin logging.
 *
 * @returns The configured log level, or 'info' as default
 */
export function getLogLevelFromEnv(): LogLevel {
  if (typeof process !== 'undefined' && process.env) {
    const envLevel = process.env.LOG_LEVEL || process.env.QUILTTAP_LOG_LEVEL;
    if (envLevel && ['debug', 'info', 'warn', 'error'].includes(envLevel)) {
      return envLevel as LogLevel;
    }
  }
  return 'info';
}
