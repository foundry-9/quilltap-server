/**
 * Database Encryption State Detection
 *
 * Determines whether a SQLite database file is encrypted (SQLCipher) or
 * plaintext by examining its file header. A standard SQLite database starts
 * with the magic string "SQLite format 3\0" (16 bytes), while an encrypted
 * database starts with random-looking bytes.
 *
 * IMPORTANT: This module uses only Node built-ins (fs) to avoid circular
 * dependencies — it may be called before the database layer is initialized.
 *
 * @module lib/startup/db-encryption-state
 */

import fs from 'fs';
import { logger as migrationLogger } from '../../migrations/lib/logger';

const log = migrationLogger.child({ context: 'db-encryption-state' });

/** The magic bytes at the start of every unencrypted SQLite database file */
const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * Check whether a database file is encrypted (SQLCipher) or plaintext.
 *
 * Reads the first 16 bytes of the file and compares them against the
 * standard SQLite header magic string. If the bytes don't match, the
 * file is presumed to be encrypted.
 *
 * @param dbPath - Absolute path to the database file
 * @returns true if the file exists and appears to be encrypted, false if
 *          it's plaintext SQLite or doesn't exist
 */
export function isDatabaseEncrypted(dbPath: string): boolean {
  log.debug('Checking database encryption state', { path: dbPath });

  if (!fs.existsSync(dbPath)) {
    log.debug('Database file does not exist', { path: dbPath });
    return false;
  }

  try {
    const fd = fs.openSync(dbPath, 'r');
    try {
      const header = Buffer.alloc(16);
      const bytesRead = fs.readSync(fd, header, 0, 16, 0);

      if (bytesRead < 16) {
        log.debug('Database file too small to determine encryption state', {
          path: dbPath,
          bytesRead,
        });
        return false;
      }

      const headerStr = header.toString('utf8');
      const isEncrypted = headerStr !== SQLITE_MAGIC;

      log.debug('Database encryption state determined', {
        path: dbPath,
        isEncrypted,
        headerPrefix: isEncrypted ? '(encrypted)' : 'SQLite format 3',
      });

      return isEncrypted;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    log.error('Failed to check database encryption state', {
      path: dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
