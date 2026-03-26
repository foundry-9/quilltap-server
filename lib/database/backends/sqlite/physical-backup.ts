/**
 * SQLite Physical Backup Module
 *
 * Creates hot physical backups of the SQLite database using better-sqlite3's
 * built-in .backup() API (which wraps SQLite's Online Backup API). These are
 * byte-level copies of the database file, independent of the logical backup
 * system that exports entities as JSON.
 *
 * Physical backups:
 * - Run automatically once per day (checked on startup, skipped if recent)
 * - Are stored under <data>/data/backups/
 * - Use VACUUM INTO for SQLCipher compatibility (preserves encryption key)
 * - Follow a retention policy: all for 7 days, weekly for 4 weeks, monthly
 *   for 12 months, yearly forever
 *
 * @module lib/database/backends/sqlite/physical-backup
 */

import { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getBackupsDir } from '@/lib/paths';

const moduleLogger = logger.child({ module: 'database:physical-backup' });

// ============================================================================
// Backup filename format
// ============================================================================

/** Regex to parse backup filenames: quilltap-YYYY-MM-DDTHHmmss.db */
const BACKUP_FILENAME_RE = /^quilltap-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})\.db$/;

/** Regex to parse LLM logs backup filenames: quilltap-llm-logs-YYYY-MM-DDTHHmmss.db */
const LLM_LOGS_BACKUP_FILENAME_RE = /^quilltap-llm-logs-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})\.db$/;

/**
 * Generate a backup filename from the current timestamp.
 *
 * Format: quilltap-YYYY-MM-DDTHHmmss.db
 * Example: quilltap-2026-02-19T143022.db
 */
function generateBackupFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = [
    now.getFullYear(),
    '-', pad(now.getMonth() + 1),
    '-', pad(now.getDate()),
    'T',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  return `quilltap-${timestamp}.db`;
}

/**
 * Parse a backup filename into a Date.
 *
 * @returns Date if filename matches the expected format, null otherwise
 */
export function parseBackupFilename(filename: string): Date | null {
  const match = BACKUP_FILENAME_RE.exec(filename);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10),
  );
}

/**
 * Generate a backup filename for the LLM logs database.
 *
 * Format: quilltap-llm-logs-YYYY-MM-DDTHHmmss.db
 */
function generateLLMLogsBackupFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = [
    now.getFullYear(),
    '-', pad(now.getMonth() + 1),
    '-', pad(now.getDate()),
    'T',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  return `quilltap-llm-logs-${timestamp}.db`;
}

/**
 * Parse an LLM logs backup filename into a Date.
 *
 * @returns Date if filename matches the expected format, null otherwise
 */
export function parseLLMLogsBackupFilename(filename: string): Date | null {
  const match = LLM_LOGS_BACKUP_FILENAME_RE.exec(filename);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10),
  );
}

// ============================================================================
// Backup interval
// ============================================================================

/** Minimum interval between automatic physical backups (24 hours). */
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Find the most recent backup matching a given parse function.
 *
 * @returns Date of the newest backup, or null if none exist
 */
function findMostRecentBackup(
  parseFn: (filename: string) => Date | null,
): Date | null {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return null;

  let newest: Date | null = null;
  for (const filename of fs.readdirSync(backupsDir)) {
    const date = parseFn(filename);
    if (date && (!newest || date.getTime() > newest.getTime())) {
      newest = date;
    }
  }
  return newest;
}

/**
 * Check whether enough time has elapsed since the last backup.
 */
function shouldCreateBackup(
  parseFn: (filename: string) => Date | null,
  label: string,
): boolean {
  const lastBackup = findMostRecentBackup(parseFn);
  if (!lastBackup) {
    moduleLogger.debug(`No existing ${label} backups found, backup needed`);
    return true;
  }

  const ageMs = Date.now() - lastBackup.getTime();
  if (ageMs < BACKUP_INTERVAL_MS) {
    moduleLogger.debug(`Recent ${label} backup exists, skipping`, {
      lastBackup: lastBackup.toISOString(),
      ageHours: Math.round(ageMs / (60 * 60 * 1000) * 10) / 10,
    });
    return false;
  }

  moduleLogger.debug(`Last ${label} backup is old enough, backup needed`, {
    lastBackup: lastBackup.toISOString(),
    ageHours: Math.round(ageMs / (60 * 60 * 1000) * 10) / 10,
  });
  return true;
}

// ============================================================================
// Physical Backup
// ============================================================================

/**
 * Create a physical backup of the SQLite database.
 *
 * Uses VACUUM INTO to create an encrypted copy of the database that preserves
 * the SQLCipher key. This creates a consistent, defragmented copy. Note that
 * VACUUM INTO holds a read lock for the duration, but this is acceptable for
 * a startup backup.
 *
 * Skips the backup if the most recent one is less than 24 hours old.
 * Partial files are cleaned up on failure.
 *
 * @param db - The better-sqlite3 database instance
 * @returns The path to the created backup file, or null if skipped/failed
 */
export async function createPhysicalBackup(db: DatabaseType): Promise<string | null> {
  if (!shouldCreateBackup(parseBackupFilename, 'main database')) {
    return null;
  }

  const backupsDir = getBackupsDir();
  const filename = generateBackupFilename();
  const backupPath = path.join(backupsDir, filename);

  try {
    // Ensure backups directory exists
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      moduleLogger.debug('Created backups directory', { path: backupsDir });
    }

    moduleLogger.info('Starting physical database backup', {
      destination: backupPath,
    });

    // Use VACUUM INTO for SQLCipher-compatible backups. The .backup() API
    // creates an unkeyed target file which is incompatible with an encrypted
    // source database. VACUUM INTO preserves the encryption key and creates
    // a consistent, defragmented copy.
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    // Verify the backup file exists and has content
    const stat = fs.statSync(backupPath);
    moduleLogger.info('Startup physical backup created', {
      path: backupPath,
      sizeBytes: stat.size,
    });

    return backupPath;
  } catch (error) {
    moduleLogger.error('Physical database backup failed', {
      destination: backupPath,
      error: error instanceof Error ? error.message : String(error),
    });

    // Clean up partial file on failure
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        moduleLogger.debug('Cleaned up partial backup file', { path: backupPath });
      }
    } catch (cleanupError) {
      moduleLogger.error('Failed to clean up partial backup file', {
        path: backupPath,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    return null;
  }
}

// ============================================================================
// LLM Logs Physical Backup
// ============================================================================

/**
 * Create a physical backup of the LLM logs database.
 *
 * Same approach as createPhysicalBackup (VACUUM INTO) but for quilltap-llm-logs.db.
 *
 * @param db - The better-sqlite3 database instance for LLM logs
 * @returns The path to the created backup file, or null on failure
 */
export async function createLLMLogsPhysicalBackup(db: DatabaseType): Promise<string | null> {
  if (!shouldCreateBackup(parseLLMLogsBackupFilename, 'LLM logs')) {
    return null;
  }

  const backupsDir = getBackupsDir();
  const filename = generateLLMLogsBackupFilename();
  const backupPath = path.join(backupsDir, filename);

  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    moduleLogger.info('Starting LLM logs physical backup', {
      destination: backupPath,
    });

    // Use VACUUM INTO for SQLCipher-compatible backups (see createPhysicalBackup)
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    const stat = fs.statSync(backupPath);
    moduleLogger.info('LLM logs physical backup created', {
      path: backupPath,
      sizeBytes: stat.size,
    });

    return backupPath;
  } catch (error) {
    moduleLogger.error('LLM logs physical backup failed', {
      destination: backupPath,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (cleanupError) {
      moduleLogger.error('Failed to clean up partial LLM logs backup file', {
        path: backupPath,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    return null;
  }
}

// ============================================================================
// Retention Policy
// ============================================================================

/**
 * Apply the retention policy to physical backups.
 *
 * Keeps:
 * - All backups less than 7 days old
 * - 1 per week for weeks 1-4
 * - 1 per month for months 1-12
 * - 1 per year indefinitely
 *
 * Within each bucket, the most recent backup is kept.
 */
export async function applyRetentionPolicy(): Promise<void> {
  const backupsDir = getBackupsDir();

  try {
    if (!fs.existsSync(backupsDir)) {
      return;
    }

    const files = fs.readdirSync(backupsDir);

    // Collect main DB backups and LLM logs backups separately
    const backups: { filename: string; date: Date }[] = [];
    const llmLogsBackups: { filename: string; date: Date }[] = [];

    for (const filename of files) {
      // Check LLM logs pattern first (it's more specific)
      const llmLogsDate = parseLLMLogsBackupFilename(filename);
      if (llmLogsDate) {
        llmLogsBackups.push({ filename, date: llmLogsDate });
        continue;
      }

      const date = parseBackupFilename(filename);
      if (date) {
        backups.push({ filename, date });
      }
    }

    // Apply retention to both backup sets
    const allSets = [
      { label: 'main', items: backups },
      { label: 'llm-logs', items: llmLogsBackups },
    ];

    for (const { label, items } of allSets) {
      if (items.length === 0) {
        continue;
      }

      // Sort newest first
      items.sort((a, b) => b.date.getTime() - a.date.getTime());

      const now = new Date();
      const msPerDay = 24 * 60 * 60 * 1000;
      const keep = new Set<string>();

      // Phase 1: Keep all backups < 7 days old
      for (const backup of items) {
        const ageMs = now.getTime() - backup.date.getTime();
        if (ageMs < 7 * msPerDay) {
          keep.add(backup.filename);
        }
      }

      // Phase 2: Keep 1 per week for weeks 1-4 (days 7-28)
      for (let week = 1; week <= 4; week++) {
        const weekStart = 7 * week * msPerDay;
        const weekEnd = 7 * (week + 1) * msPerDay;

        for (const backup of items) {
          const ageMs = now.getTime() - backup.date.getTime();
          if (ageMs >= weekStart && ageMs < weekEnd) {
            keep.add(backup.filename);
            break;
          }
        }
      }

      // Phase 3: Keep 1 per month for months 1-12 (approx days 28-365)
      for (let month = 1; month <= 12; month++) {
        const monthStart = (28 + (month - 1) * 30) * msPerDay;
        const monthEnd = (28 + month * 30) * msPerDay;

        for (const backup of items) {
          const ageMs = now.getTime() - backup.date.getTime();
          if (ageMs >= monthStart && ageMs < monthEnd) {
            keep.add(backup.filename);
            break;
          }
        }
      }

      // Phase 4: Keep 1 per year for anything older than 12 months
      const yearBuckets = new Map<number, string>();
      for (const backup of items) {
        const ageMs = now.getTime() - backup.date.getTime();
        if (ageMs >= 388 * msPerDay) {
          const year = backup.date.getFullYear();
          if (!yearBuckets.has(year)) {
            yearBuckets.set(year, backup.filename);
          }
        }
      }
      for (const filename of yearBuckets.values()) {
        keep.add(filename);
      }

      // Delete backups not in the keep set
      let deleted = 0;
      for (const backup of items) {
        if (!keep.has(backup.filename)) {
          try {
            fs.unlinkSync(path.join(backupsDir, backup.filename));
            deleted++;
          } catch (error) {
            moduleLogger.warn('Failed to delete old backup', {
              filename: backup.filename,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (deleted > 0) {
        moduleLogger.info('Retention policy applied', {
          database: label,
          totalBackups: items.length,
          kept: keep.size,
          deleted,
        });
      } else {
        moduleLogger.debug('Retention policy applied, no backups deleted', {
          database: label,
          totalBackups: items.length,
        });
      }
    }
  } catch (error) {
    moduleLogger.error('Failed to apply retention policy', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — retention policy failure should not affect startup
  }
}
