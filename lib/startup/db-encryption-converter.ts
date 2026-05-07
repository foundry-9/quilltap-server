/**
 * Database Encryption Converter
 *
 * Converts an existing plaintext SQLite database to encrypted format using
 * PRAGMA rekey on a temporary working copy, then replaces the original.
 *
 * Working on a copy avoids "database is locked" errors caused by iCloud sync,
 * Spotlight indexing, or other processes that hold file coordination locks on
 * the original database file.
 *
 * 1. Copy the plaintext DB to a backup file (safety net)
 * 2. Copy the plaintext DB to a temporary working file
 * 3. Open the working copy (no external locks), checkpoint WAL, switch to DELETE mode
 * 4. Use PRAGMA rekey to encrypt the working copy in-place
 * 5. Verify the encrypted copy
 * 6. Replace the original with the encrypted copy
 *
 * IMPORTANT: This module uses only Node built-ins and better-sqlite3.
 * It avoids importing from lib/logger.ts or lib/env.ts to prevent
 * circular dependencies during startup.
 *
 * @module lib/startup/db-encryption-converter
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import { logger as migrationLogger } from '../../migrations/lib/logger';

const log = migrationLogger.child({ context: 'db-encryption-converter' });

/**
 * Remove WAL and SHM sidecar files for a database.
 */
function removeWalFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const filePath = dbPath + suffix;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Convert a plaintext SQLite database to encrypted format.
 *
 * The pepper is expected to be a base64-encoded 32-byte key. It is converted
 * to a hex string and used as a raw key (x'...' format), which bypasses
 * the cipher's own KDF for maximum performance.
 *
 * On success, a backup of the original plaintext DB is kept at
 * `<name>.pre-sqlcipher.bak`. On failure, the backup is restored.
 *
 * @param dbPath - Absolute path to the plaintext database file
 * @param pepper - Base64-encoded 32-byte encryption key
 * @throws {Error} If conversion fails at any step
 */
export function convertDatabaseToEncrypted(dbPath: string, pepper: string): void {
  const backupPath = `${dbPath}.pre-sqlcipher.bak`;
  const workingPath = `${dbPath}.encrypting`;
  const keyHex = Buffer.from(pepper, 'base64').toString('hex');

  log.info('Starting database encryption conversion', {
    dbPath,
    backupPath,
  });

  let db: InstanceType<typeof Database> | null = null;

  try {
    // Step 1: Create backup of the original (safety net for rollback)
    fs.copyFileSync(dbPath, backupPath);

    // Step 2: Create a working copy that is free of external file locks.
    // iCloud sync, Spotlight, and other macOS services may hold file
    // coordination locks on the original; the working copy avoids those.
    fs.copyFileSync(dbPath, workingPath);

    // Also copy WAL/SHM if they exist so the working copy is consistent
    for (const suffix of ['-wal', '-shm']) {
      const src = dbPath + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, workingPath + suffix);
      }
    }

    // Step 3: Open the working copy and checkpoint WAL → DELETE journal mode
    db = new Database(workingPath);
    db.pragma('busy_timeout = 5000');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');

    // Remove WAL/SHM from the working copy
    removeWalFiles(workingPath);

    // Step 4: Encrypt the working copy in-place using PRAGMA rekey
    db.pragma(`rekey = "x'${keyHex}'"`);

    // Leave the converted database in TRUNCATE journal mode. The next normal
    // app open will re-apply whatever mode is currently configured (default
    // TRUNCATE; WAL only when SQLITE_WAL_MODE=true), but TRUNCATE is the safe
    // resting state since cloud-synced data directories don't tolerate WAL
    // auxiliary files well.
    db.pragma('journal_mode = TRUNCATE');

    // Step 5: Close
    db.close();
    db = null;

    // Step 6: Verify by reopening with key
    const verifyDb = new Database(workingPath);
    verifyDb.pragma(`key = "x'${keyHex}'"`);
    const result = verifyDb.prepare('SELECT count(*) as cnt FROM sqlite_master').get() as { cnt: number };
    verifyDb.close();

    // Step 7: Replace the original with the encrypted working copy.
    // Remove the original's WAL/SHM files first since the encrypted
    // copy starts fresh with its own WAL.
    removeWalFiles(dbPath);
    fs.renameSync(workingPath, dbPath);

    log.info('Database encryption conversion complete', {
      dbPath,
      backupPath,
      tablesFound: result.cnt,
    });
  } catch (error) {
    log.error('Database encryption conversion failed', {
      dbPath,
      error: error instanceof Error ? error.message : String(error),
    });

    // Clean up: close DB if still open
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }

    // Clean up working copy
    try {
      if (fs.existsSync(workingPath)) fs.unlinkSync(workingPath);
      removeWalFiles(workingPath);
    } catch { /* ignore */ }

    // Restore original from backup if it exists
    if (fs.existsSync(backupPath)) {
      try {
        log.warn('Restoring original database from backup after failed conversion');
        fs.copyFileSync(backupPath, dbPath);
      } catch { /* ignore */ }
    }

    throw error;
  }
}
