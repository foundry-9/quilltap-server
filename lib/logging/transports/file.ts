/**
 * File transport for persistent logging with rotation
 *
 * Writes JSON log entries to combined.log (everything) and error.log
 * (errors only). When a file exceeds maxFileSize it rotates into
 * `<stem>.0.log` (newest backup) through `<stem>.<maxFiles-1>.log` (oldest).
 *
 * On initialization, sweeps the log directory of any stray files in the
 * combined/error family that don't match the active or rotated name —
 * leftovers from older `<stem>.log.<N>` rotations, iCloud sync conflicts
 * (`combined 2.log`, `combined.log.9 2`), and Finder duplicates
 * (`combined(2).log`). User-owned files (terminal transcripts,
 * quilltap-stdout/stderr, embedded-server, startup, etc.) are left alone.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { LogLevel } from '@/lib/logger';
import { LogTransport, LogData } from './base';

const STEMS = ['combined', 'error'] as const;
type Stem = (typeof STEMS)[number];

function activeLogName(stem: Stem): string {
  return `${stem}.log`;
}

function rotatedLogName(stem: Stem, rotation: number): string {
  return `${stem}.${rotation}.log`;
}

/**
 * True if `entry` looks like it belongs to a log stem's family — either an
 * exact match for the stem (`combined`), or the stem followed by a
 * non-alphanumeric separator (`.`, ` `, `(`, `-`). Returning true here means
 * the file is a candidate for the allowlist check; words like `errors.log`
 * or `embedded-server.log` fall through and are never touched.
 */
function belongsToStemFamily(entry: string): boolean {
  for (const stem of STEMS) {
    if (!entry.startsWith(stem)) continue;
    if (entry.length === stem.length) return true;
    const next = entry[stem.length];
    if (!/[a-zA-Z0-9]/.test(next)) return true;
  }
  return false;
}

export class FileTransport implements LogTransport {
  private logDir: string;
  private maxFileSize: number;
  private maxFiles: number;
  private fileSizes: Map<Stem, number> = new Map();
  private initPromise: Promise<void>;

  /**
   * @param logDir Directory where log files will be stored
   * @param maxFileSize Maximum size of an active log file in bytes (default: 10MB)
   * @param maxFiles Number of rotated backups to keep per stem (default: 10 → `.0.log` through `.9.log`)
   */
  constructor(
    logDir: string,
    maxFileSize: number = 10485760,
    maxFiles: number = 10
  ) {
    this.logDir = logDir;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.initPromise = this.initializeDirectory();
  }

  private async initializeDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      await this.purgeStrayLogs();

      for (const stem of STEMS) {
        try {
          const stats = await fs.stat(join(this.logDir, activeLogName(stem)));
          this.fileSizes.set(stem, stats.size);
        } catch {
          this.fileSizes.set(stem, 0);
        }
      }
    } catch (error) {
      console.error(
        'Failed to initialize logging directory:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async purgeStrayLogs(): Promise<void> {
    const allowed = new Set<string>();
    for (const stem of STEMS) {
      allowed.add(activeLogName(stem));
      for (let i = 0; i < this.maxFiles; i++) {
        allowed.add(rotatedLogName(stem, i));
      }
    }

    let entries: string[];
    try {
      entries = await fs.readdir(this.logDir);
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (allowed.has(entry)) return;
        if (!belongsToStemFamily(entry)) return;
        try {
          await fs.unlink(join(this.logDir, entry));
        } catch {
          // best effort — sync-locked or already gone is fine
        }
      })
    );
  }

  async write(logData: LogData): Promise<void> {
    await this.initPromise;
    const line = JSON.stringify(logData) + '\n';

    await this.writeToFile('combined', line);
    if (logData.level === LogLevel.ERROR) {
      await this.writeToFile('error', line);
    }
  }

  private async writeToFile(stem: Stem, content: string): Promise<void> {
    try {
      const filePath = join(this.logDir, activeLogName(stem));
      const contentSize = Buffer.byteLength(content, 'utf-8');

      const currentSize = this.fileSizes.get(stem) ?? 0;
      if (currentSize + contentSize > this.maxFileSize) {
        await this.rotateFile(stem);
      }

      await fs.appendFile(filePath, content, 'utf-8');
      this.fileSizes.set(stem, (this.fileSizes.get(stem) ?? 0) + contentSize);
    } catch (error) {
      console.error(
        `Failed to write to ${activeLogName(stem)}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Rotate a stem: drop the oldest backup, shift each existing backup one
   * slot older (.0 → .1, .1 → .2, …), then rename the active file to .0.
   */
  private async rotateFile(stem: Stem): Promise<void> {
    try {
      const oldestPath = join(
        this.logDir,
        rotatedLogName(stem, this.maxFiles - 1)
      );
      try {
        await fs.unlink(oldestPath);
      } catch {
        // not present is fine
      }

      for (let i = this.maxFiles - 2; i >= 0; i--) {
        const oldPath = join(this.logDir, rotatedLogName(stem, i));
        const newPath = join(this.logDir, rotatedLogName(stem, i + 1));
        try {
          await fs.rename(oldPath, newPath);
        } catch {
          // not present is fine
        }
      }

      const activePath = join(this.logDir, activeLogName(stem));
      const firstBackup = join(this.logDir, rotatedLogName(stem, 0));
      try {
        await fs.rename(activePath, firstBackup);
      } catch {
        // not present is fine
      }

      this.fileSizes.set(stem, 0);
    } catch (error) {
      console.error(
        `Failed to rotate ${activeLogName(stem)}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
