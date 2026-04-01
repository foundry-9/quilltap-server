/**
 * Plugin Logger Bridge
 *
 * Bridges Quilltap's core logging system to the @quilltap/plugin-utils logger.
 * This allows plugins using plugin-utils to have their logs routed through
 * Quilltap's logging infrastructure.
 *
 * @module plugins/plugin-logger-bridge
 */

import { logger } from '@/lib/logger';

/**
 * Log context type for plugin logging
 */
interface LogContext {
  [key: string]: unknown;
}

/**
 * Extended logger interface matching plugin-utils PluginLoggerWithChild
 */
interface PluginLoggerWithChild {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: Error): void;
  child(additionalContext: LogContext): PluginLoggerWithChild;
}

/**
 * Create a child logger with plugin context
 *
 * @param pluginName - The plugin's name
 * @param additionalContext - Additional context to merge
 * @returns A logger that routes to Quilltap core
 */
function createPluginChildLogger(
  pluginName: string,
  additionalContext: LogContext = {}
): PluginLoggerWithChild {
  const baseContext = { plugin: pluginName, module: 'plugin', ...additionalContext };

  return {
    debug: (message: string, context?: LogContext) => {
      logger.debug(message, { ...baseContext, ...context });
    },

    info: (message: string, context?: LogContext) => {
      logger.info(message, { ...baseContext, ...context });
    },

    warn: (message: string, context?: LogContext) => {
      logger.warn(message, { ...baseContext, ...context });
    },

    error: (message: string, context?: LogContext, error?: Error) => {
      logger.error(message, { ...baseContext, ...context }, error);
    },

    child: (moreContext: LogContext): PluginLoggerWithChild => {
      return createPluginChildLogger(pluginName, { ...additionalContext, ...moreContext });
    },
  };
}

/**
 * Factory function that creates loggers for plugins
 *
 * @param pluginName - The plugin's name (e.g., 'qtap-plugin-openai')
 * @returns A logger that bridges to Quilltap core logging
 */
function pluginLoggerFactory(pluginName: string): PluginLoggerWithChild {
  return createPluginChildLogger(pluginName);
}

/**
 * Inject the logger factory into the global namespace
 *
 * This should be called early in the plugin initialization process,
 * before any plugins are loaded. The factory will be picked up by
 * @quilltap/plugin-utils when createPluginLogger() is called.
 */
export function injectPluginLoggerFactory(): void {
  // Use the same global key as plugin-utils
  (globalThis as Record<string, unknown>).__quilltap_logger_factory = pluginLoggerFactory;

  logger.debug('Plugin logger factory injected into global namespace', {
    context: 'plugin-logger-bridge',
  });
}

/**
 * Clear the logger factory from the global namespace
 *
 * Useful for testing or cleanup.
 */
export function clearPluginLoggerFactory(): void {
  (globalThis as Record<string, unknown>).__quilltap_logger_factory = undefined;

  logger.debug('Plugin logger factory cleared from global namespace', {
    context: 'plugin-logger-bridge',
  });
}
