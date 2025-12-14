/**
 * Captures stdout/stderr output to a log file for DevConsole display
 *
 * This intercepts process.stdout and process.stderr to capture Next.js
 * server output (like request logs) that aren't written through Winston.
 *
 * Only active in development mode.
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STDOUT_LOG_PATH = resolve(process.cwd(), 'logs', 'stdout.log');

let isSetup = false;

/**
 * Set up stdout/stderr capture
 * Should be called early in server startup (e.g., in instrumentation.ts)
 */
export function setupStdoutCapture(): void {
  if (isSetup) return;
  isSetup = true;

  // Ensure logs directory exists
  const logsDir = resolve(process.cwd(), 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Clear/initialize the stdout log file on startup
  writeFileSync(STDOUT_LOG_PATH, '');

  // Store original write functions
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Helper to format and write to log file
  function writeToLog(data: string | Uint8Array, source: 'stdout' | 'stderr'): void {
    const str = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');

    // Skip empty lines and heartbeat-only content
    const trimmed = str.trim();
    if (!trimmed) return;

    // Create a JSON log entry
    const entry = {
      timestamp: new Date().toISOString(),
      source,
      message: trimmed,
      level: source === 'stderr' ? 'error' : 'info',
    };

    try {
      appendFileSync(STDOUT_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail - we don't want logging to crash the server
    }
  }

  // Override stdout.write - use type assertion to handle Node.js version differences
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    writeToLog(chunk, 'stdout');

    // Call original with correct signature
    if (typeof encodingOrCallback === 'function') {
      return originalStdoutWrite(chunk, encodingOrCallback);
    }
    return originalStdoutWrite(chunk, encodingOrCallback, callback);
  } as typeof process.stdout.write;

  // Override stderr.write - use type assertion to handle Node.js version differences
  process.stderr.write = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    writeToLog(chunk, 'stderr');

    // Call original with correct signature
    if (typeof encodingOrCallback === 'function') {
      return originalStderrWrite(chunk, encodingOrCallback);
    }
    return originalStderrWrite(chunk, encodingOrCallback, callback);
  } as typeof process.stderr.write;
}

/**
 * Get the path to the stdout log file
 */
export function getStdoutLogPath(): string {
  return STDOUT_LOG_PATH;
}
