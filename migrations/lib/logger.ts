/**
 * Migration Logger
 *
 * Provides logging for migrations. Uses a standalone implementation
 * to avoid importing lib/env which triggers environment validation
 * before Next.js has loaded .env files.
 *
 * This logger writes to the same log files as the main app logger
 * but doesn't depend on env validation at import time.
 */

// ============================================================================
// Types
// ============================================================================

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

// ============================================================================
// Log Level Configuration
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getCurrentLevel(): number {
  const levelEnv = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return LOG_LEVELS[levelEnv || 'info'] ?? LOG_LEVELS.info;
}

// ============================================================================
// File Transport (lazy loaded)
// ============================================================================

let fs: typeof import('fs') | null = null;
let path: typeof import('path') | null = null;
let getLogsDirFn: (() => string) | null = null;
let logFileStream: import('fs').WriteStream | null = null;
let errorFileStream: import('fs').WriteStream | null = null;

async function loadDependencies(): Promise<void> {
  if (fs) return;
  fs = await import('fs');
  path = await import('path');
  const pathsModule = await import('../../lib/paths');
  getLogsDirFn = pathsModule.getLogsDir;
}

function ensureLogStreamsSync(): void {
  if (logFileStream || !fs || !path || !getLogsDirFn) return;

  try {
    const logsDir = getLogsDirFn();

    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const combinedPath = path.join(logsDir, 'combined.log');
    const errorPath = path.join(logsDir, 'error.log');

    logFileStream = fs.createWriteStream(combinedPath, { flags: 'a' });
    errorFileStream = fs.createWriteStream(errorPath, { flags: 'a' });
  } catch {
    // If we can't write to files, we'll just use console
  }
}

function writeToFile(level: LogLevel, message: string, context: LogContext): void {
  ensureLogStreamsSync();

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {
      service: 'quilltap',
      environment: process.env.NODE_ENV || 'development',
      ...context,
    },
  }) + '\n';

  logFileStream?.write(entry);
  if (level === 'error') {
    errorFileStream?.write(entry);
  }
}

// ============================================================================
// Logger Implementation
// ============================================================================

class MigrationLogger {
  private context: LogContext;
  private minLevel: number;
  private initialized: boolean = false;

  constructor(context: LogContext = {}) {
    this.context = context;
    this.minLevel = getCurrentLevel();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await loadDependencies();
    this.initialized = true;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= this.minLevel;
  }

  private log(level: LogLevel, message: string, meta?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const fullContext = { ...this.context, ...meta };

    // Write to file (if dependencies are loaded)
    const logOutput = process.env.LOG_OUTPUT || 'console';
    if ((logOutput === 'file' || logOutput === 'both') && fs) {
      writeToFile(level, message, fullContext);
    }

    // Write to console
    if (logOutput === 'console' || logOutput === 'both' || !fs) {
      const timestamp = new Date().toISOString();
      const contextStr = Object.keys(fullContext).length > 0
        ? ` ${JSON.stringify(fullContext)}`
        : '';
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`);
    }
  }

  info(message: string, meta?: LogContext): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: LogContext): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: LogContext, error?: Error): void {
    const errorMeta = error
      ? { ...meta, error: { name: error.name, message: error.message, stack: error.stack } }
      : meta;
    this.log('error', message, errorMeta);
  }

  debug(message: string, meta?: LogContext): void {
    this.log('debug', message, meta);
  }

  child(context: LogContext): MigrationLogger {
    return new MigrationLogger({ ...this.context, ...context });
  }

  /** Initialize file transports. Call this during app startup. */
  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }
}

/**
 * Logger instance for migrations
 */
export const logger = new MigrationLogger();

/**
 * Create a child logger with migration-specific context
 */
export function createMigrationLogger(migrationId: string) {
  return logger.child({ context: `migration.${migrationId}` });
}
