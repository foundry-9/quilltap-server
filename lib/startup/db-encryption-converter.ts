/**
 * Database Encryption Converter
 *
 * Converts an existing plaintext SQLite database to encrypted format using
 * PRAGMA rekey, which encrypts the database in-place:
 *
 * 1. Copy the plaintext DB to a backup file
 * 2. Open the plaintext DB (no key)
 * 3. Checkpoint WAL to merge all pending writes
 * 4. Use PRAGMA rekey to encrypt in-place
 * 5. Close and verify by reopening with key
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
  const keyHex = Buffer.from(pepper, 'base64').toString('hex');

  log.info('Starting database encryption conversion', {
    dbPath,
    backupPath,
  });

  let db: InstanceType<typeof Database> | null = null;

  try {
    // Step 1: Copy plaintext DB to backup before modifying
    log.debug('Creating backup of plaintext database');
    fs.copyFileSync(dbPath, backupPath);

    // Step 2: Open the plaintext DB
    log.debug('Opening plaintext database');
    db = new Database(dbPath);

    // Step 3: Checkpoint WAL and switch to DELETE journal mode (rekey requires it)
    log.debug('Checkpointing WAL and switching to DELETE journal mode');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');

    // Remove WAL/SHM files after switching away from WAL
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) {
        log.debug('Removing WAL/SHM file', { path: walPath });
        fs.unlinkSync(walPath);
      }
    }

    // Step 4: Encrypt the database in-place using PRAGMA rekey
    log.debug('Encrypting database in-place via PRAGMA rekey');
    db.pragma(`rekey = "x'${keyHex}'"`);

    // Step 5: Close
    db.close();
    db = null;

    // Step 6: Verify by reopening with key
    log.debug('Verifying encrypted database');
    const verifyDb = new Database(dbPath);
    verifyDb.pragma(`key = "x'${keyHex}'"`);

    // Try a simple query to confirm the DB is readable
    const result = verifyDb.prepare('SELECT count(*) as cnt FROM sqlite_master').get() as { cnt: number };
    verifyDb.close();

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
