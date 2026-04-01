/**
 * Sync Log Collector
 *
 * Utility for collecting logs during sync operations to send back to
 * the requesting client for debugging purposes.
 *
 * This allows the receiving instance to see what happened on the
 * server side during sync, making troubleshooting easier.
 */

import { SyncLogEntry, SyncLogLevel } from './types';

/**
 * Maximum number of log entries to collect per operation.
 * Prevents memory issues with very chatty operations.
 */
const MAX_LOG_ENTRIES = 100;

/**
 * Log levels to collect. Only warn and error by default to reduce noise.
 * Can be expanded to include info/debug for more verbose logging.
 */
const COLLECTED_LEVELS: SyncLogLevel[] = ['warn', 'error'];

/**
 * A collector for sync operation logs.
 * Create a new instance for each sync operation, then pass it to
 * the endpoint functions that need to collect logs.
 */
export class SyncLogCollector {
  private logs: SyncLogEntry[] = [];
  private readonly maxEntries: number;
  private readonly levels: Set<SyncLogLevel>;

  constructor(options?: { maxEntries?: number; levels?: SyncLogLevel[] }) {
    this.maxEntries = options?.maxEntries ?? MAX_LOG_ENTRIES;
    this.levels = new Set(options?.levels ?? COLLECTED_LEVELS);
  }

  /**
   * Add a log entry if it matches the collected levels
   */
  log(level: SyncLogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.levels.has(level)) {
      return;
    }

    if (this.logs.length >= this.maxEntries) {
      // Replace oldest entry with a truncation message if we haven't already
      if (!this.logs.some((l) => l.message.includes('truncated'))) {
        this.logs.push({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: `Log collection truncated at ${this.maxEntries} entries`,
        });
      }
      return;
    }

    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ? this.sanitizeContext(context) : undefined,
    });
  }

  /**
   * Convenience methods for each log level
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Get all collected logs
   */
  getLogs(): SyncLogEntry[] {
    return [...this.logs];
  }

  /**
   * Get count of collected logs
   */
  get count(): number {
    return this.logs.length;
  }

  /**
   * Clear all collected logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Sanitize context to remove sensitive data and ensure serializability
   */
  private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      // Skip sensitive keys
      if (['password', 'apiKey', 'token', 'secret', 'ciphertext', 'iv', 'authTag'].includes(key)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Skip non-serializable values
      if (typeof value === 'function') {
        continue;
      }

      // Handle errors specially
      if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
        };
        continue;
      }

      // Truncate long strings
      if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.substring(0, 500) + '...[truncated]';
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }
}

/**
 * Create a new sync log collector with default settings
 */
export function createSyncLogCollector(options?: {
  maxEntries?: number;
  levels?: SyncLogLevel[];
}): SyncLogCollector {
  return new SyncLogCollector(options);
}
