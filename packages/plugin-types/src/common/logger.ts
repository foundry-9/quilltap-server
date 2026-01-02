/**
 * Logger types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/common/logger
 */

/**
 * Log level type
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log context metadata
 */
export interface LogContext {
  /** Context identifier (e.g., module name) */
  context?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Logger interface that plugins can implement or receive
 *
 * This interface is compatible with Quilltap's built-in logger.
 * Plugins can use this interface to accept a logger from the host
 * application or implement their own logging.
 */
export interface PluginLogger {
  /**
   * Log a debug message
   * @param message Message to log
   * @param context Optional context metadata
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Log an info message
   * @param message Message to log
   * @param context Optional context metadata
   */
  info(message: string, context?: LogContext): void;

  /**
   * Log a warning message
   * @param message Message to log
   * @param context Optional context metadata
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Log an error message
   * @param message Message to log
   * @param context Optional context metadata
   * @param error Optional error object
   */
  error(message: string, context?: LogContext, error?: Error): void;
}

/**
 * Simple console-based logger for standalone plugin development
 *
 * This logger writes to the console and is useful for local
 * plugin development and testing.
 *
 * @param prefix Prefix to add to all log messages
 * @param minLevel Minimum log level to output (default: 'info')
 * @returns A PluginLogger instance
 *
 * @example
 * ```typescript
 * const logger = createConsoleLogger('my-plugin', 'debug');
 * logger.debug('Initializing plugin', { version: '1.0.0' });
 * logger.info('Plugin ready');
 * logger.error('Failed to connect', { endpoint: 'api.example.com' }, new Error('Connection refused'));
 * ```
 */
export function createConsoleLogger(prefix: string, minLevel: LogLevel = 'info'): PluginLogger {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const shouldLog = (level: LogLevel): boolean =>
    levels.indexOf(level) >= levels.indexOf(minLevel);

  const formatContext = (context?: LogContext): string => {
    if (!context) return '';
    const entries = Object.entries(context)
      .filter(([key]) => key !== 'context')
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    return entries ? ` ${entries}` : '';
  };

  return {
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
  };
}

/**
 * No-op logger for production or when logging is disabled
 *
 * @returns A PluginLogger that does nothing
 */
export function createNoopLogger(): PluginLogger {
  const noop = (): void => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}
