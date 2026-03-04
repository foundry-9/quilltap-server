/**
 * Database Encryption Converter
 *
 * Converts an existing plaintext SQLite database to SQLCipher-encrypted format
 * using the ATTACH + sqlcipher_export workflow:
 *
 * 1. Checkpoint WAL to merge all pending writes
 * 2. Open the plaintext DB (no key)
 * 3. ATTACH a new encrypted DB with the SQLCipher key
 * 4. Use sqlcipher_export() to copy all data to the encrypted DB
 * 5. DETACH and close
 * 6. Rename: original → .pre-sqlcipher.bak, encrypted → original
 * 7. Verify by reopening with the key
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
 * Convert a plaintext SQLite database to SQLCipher-encrypted format.
 *
 * The pepper is expected to be a base64-encoded 32-byte key. It is converted
 * to a hex string and used as a raw SQLCipher key (x'...' format), which
 * bypasses SQLCipher's own KDF for maximum performance.
 *
 * On success, the original plaintext DB is renamed to `<name>.pre-sqlcipher.bak`
 * and the encrypted copy takes its place. On failure, the original is left
 * untouched and the temporary file is cleaned up.
 *
 * @param dbPath - Absolute path to the plaintext database file
 * @param pepper - Base64-encoded 32-byte encryption key
 * @throws {Error} If conversion fails at any step
 */
export function convertDatabaseToEncrypted(dbPath: string, pepper: string): void {
  const tmpPath = `${dbPath}.tmp`;
  const backupPath = `${dbPath}.pre-sqlcipher.bak`;
  const keyHex = Buffer.from(pepper, 'base64').toString('hex');

  log.info('Starting database encryption conversion', {
    dbPath,
    tmpPath,
    backupPath,
  });

  // Clean up any leftover tmp file from a previous failed attempt
  if (fs.existsSync(tmpPath)) {
    log.warn('Removing leftover temporary file from previous conversion attempt', { tmpPath });
    fs.unlinkSync(tmpPath);
  }

  let plaintextDb: InstanceType<typeof Database> | null = null;

  try {
    // Step 1: Open the plaintext DB and checkpoint WAL
    log.debug('Opening plaintext database and checkpointing WAL');
    plaintextDb = new Database(dbPath);
    plaintextDb.pragma('wal_checkpoint(TRUNCATE)');

    // Step 2: ATTACH the new encrypted DB with key
    log.debug('Attaching encrypted temporary database');
    plaintextDb.exec(`ATTACH DATABASE '${tmpPath.replace(/'/g, "''")}' AS encrypted KEY "x'${keyHex}'""`);

    // Step 3: Export all data to the encrypted DB
    log.debug('Exporting data to encrypted database via sqlcipher_export');
    plaintextDb.exec(`SELECT sqlcipher_export('encrypted')`);

    // Step 4: Detach and close
    log.debug('Detaching encrypted database');
    plaintextDb.exec('DETACH DATABASE encrypted');
    plaintextDb.close();
    plaintextDb = null;

    // Step 5: Remove WAL/SHM files for the plaintext DB (already checkpointed)
    for (const suffix of ['-wal', '-shm']) {
      const walPath = dbPath + suffix;
      if (fs.existsSync(walPath)) {
        log.debug('Removing WAL/SHM file', { path: walPath });
        fs.unlinkSync(walPath);
      }
    }

    // Step 6: Rename files
    log.debug('Renaming plaintext DB to backup and encrypted DB to primary');
    fs.renameSync(dbPath, backupPath);
    fs.renameSync(tmpPath, dbPath);

    // Step 7: Verify by reopening with key
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
    if (plaintextDb) {
      try { plaintextDb.close(); } catch { /* ignore */ }
    }

    // Clean up: remove tmp file if it exists
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // Restore original if it was moved
    if (!fs.existsSync(dbPath) && fs.existsSync(backupPath)) {
      try {
        log.warn('Restoring original database from backup after failed conversion');
        fs.renameSync(backupPath, dbPath);
      } catch { /* ignore */ }
    }

    throw error;
  }
}
