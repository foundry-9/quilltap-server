/**
 * Logging Utilities
 *
 * Exports the plugin logger bridge and related utilities.
 *
 * @module @quilltap/plugin-utils/logging
 */

export {
  createPluginLogger,
  hasCoreLogger,
  getLogLevelFromEnv,
  __injectCoreLoggerFactory,
  __clearCoreLoggerFactory,
} from './plugin-logger';

export type { PluginLoggerWithChild } from './plugin-logger';

// Re-export logger types from plugin-types
export type { PluginLogger, LogContext, LogLevel } from '@quilltap/plugin-types';

// Re-export logger utilities from plugin-types for convenience
export { createConsoleLogger, createNoopLogger } from '@quilltap/plugin-types';
