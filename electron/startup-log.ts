import * as fs from 'fs';
import * as path from 'path';

let writeStream: fs.WriteStream | null = null;

/**
 * Initialize the startup log file. Creates/truncates `startup.log` in the
 * given directory's `logs/` subdirectory. Call once at the beginning of each
 * startup sequence.
 */
export function initStartupLog(dataDir: string): void {
  closeStartupLog();

  const logsDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const logPath = path.join(logsDir, 'startup.log');
  writeStream = fs.createWriteStream(logPath, { flags: 'w' });
  writeStream.on('error', (err) => {
    console.error('[StartupLog] Write error:', err);
    writeStream = null;
  });

  logStartup('Startup log initialized', `dataDir=${dataDir}`);
}

/**
 * Append a timestamped line to the startup log.
 *
 * Format: `[ISO timestamp] [PHASE/LEVEL] message | detail`
 */
export function logStartup(message: string, detail?: string, level: string = 'INFO'): void {
  if (!writeStream) return;

  const ts = new Date().toISOString();
  const suffix = detail ? ` | ${detail}` : '';
  writeStream.write(`[${ts}] [${level.toUpperCase()}] ${message}${suffix}\n`);
}

/**
 * Flush and close the startup log stream. Safe to call multiple times.
 */
export function closeStartupLog(): void {
  if (writeStream) {
    try {
      writeStream.end();
    } catch {
      // Non-fatal — stream may already be closed
    }
    writeStream = null;
  }
}
