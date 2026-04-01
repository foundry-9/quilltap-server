/**
 * Common types barrel export
 *
 * @module @quilltap/plugin-types/common
 */

export {
  PluginError,
  ApiKeyError,
  ProviderApiError,
  RateLimitError,
  ConfigurationError,
  ModelNotFoundError,
  AttachmentError,
  ToolExecutionError,
} from './errors';

export type { LogLevel, LogContext, PluginLogger } from './logger';

export { createConsoleLogger, createNoopLogger } from './logger';
