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
 * Tri-state result from {@link getDatabaseEncryptionState}.
 *
 * `unknown` is returned when we can't read the header reliably — typically a
 * transient EAGAIN/EBUSY from a flaky filesystem (iCloud Drive evicting pages,
 * VirtioFS bind-mount inside Docker on macOS, etc.). Callers MUST treat
 * `unknown` as "do nothing destructive" — never as "plaintext, please convert."
 */
export type DatabaseEncryptionState = 'encrypted' | 'plaintext' | 'unknown';

/** Read errors that are worth retrying — file is there but transiently unreadable. */
const TRANSIENT_FS_CODES = new Set(['EAGAIN', 'EBUSY', 'EWOULDBLOCK', 'EINTR']);

const HEADER_READ_MAX_ATTEMPTS = 5;
const HEADER_READ_BACKOFF_MS = [50, 150, 400, 800, 1500];

function isTransientFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_FS_CODES.has(code);
}

function sleepSync(ms: number): void {
  // Synchronous sleep — fine here because this runs at startup, off the
  // request path, and the alternative (making the API async) ripples through
  // a lot of cold-path code.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait
  }
}

/**
 * Read the first 16 bytes of a file, retrying on transient errors.
 *
 * Returns the bytes actually read (may be < 16 if the file is short), or
 * throws after exhausting retries on a transient error, or rethrows
 * immediately on a non-transient error (EACCES, EIO, etc.).
 */
function readHeaderWithRetry(dbPath: string): Buffer {
  let lastErr: unknown;
  for (let attempt = 0; attempt < HEADER_READ_MAX_ATTEMPTS; attempt++) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(dbPath, 'r');
      const header = Buffer.alloc(16);
      const bytesRead = fs.readSync(fd, header, 0, 16, 0);
      return bytesRead < 16 ? header.subarray(0, bytesRead) : header;
    } catch (err) {
      lastErr = err;
      if (!isTransientFsError(err)) {
        throw err;
      }
      const backoff = HEADER_READ_BACKOFF_MS[attempt] ?? 1500;
      log.warn('Transient error reading database header — retrying', {
        path: dbPath,
        attempt: attempt + 1,
        maxAttempts: HEADER_READ_MAX_ATTEMPTS,
        backoffMs: backoff,
        error: err instanceof Error ? err.message : String(err),
      });
      sleepSync(backoff);
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Exhausted retries reading database header: ${String(lastErr)}`);
}

/**
 * Determine whether a database file is encrypted, plaintext, or unknown.
 *
 * Retries the header read on transient filesystem errors (EAGAIN/EBUSY) up
 * to {@link HEADER_READ_MAX_ATTEMPTS} times before giving up and returning
 * `unknown`. This matters on iCloud Drive bind-mounts inside Docker on
 * macOS, where the file provider can briefly return EAGAIN while pages are
 * materialized — earlier versions of this code treated that as "plaintext"
 * and went on to attempt a destructive in-place re-encryption.
 *
 * @param dbPath - Absolute path to the database file
 * @returns `'encrypted'`, `'plaintext'`, or `'unknown'`
 */
export function getDatabaseEncryptionState(dbPath: string): DatabaseEncryptionState {

  if (!fs.existsSync(dbPath)) {
    return 'plaintext';
  }

  let header: Buffer;
  try {
    header = readHeaderWithRetry(dbPath);
  } catch (error) {
    log.error('Failed to check database encryption state', {
      path: dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unknown';
  }

  if (header.length < 16) {
    // A file shorter than the SQLite header isn't a usable SQLite DB in
    // either mode. Treat as plaintext so callers that gate on
    // `state === 'plaintext'` don't get stuck — the open/migration path
    // downstream will surface a more meaningful error.
    return 'plaintext';
  }

  const headerStr = header.toString('utf8');
  const encrypted = headerStr !== SQLITE_MAGIC;

  return encrypted ? 'encrypted' : 'plaintext';
}

/**
 * Check whether a database file is encrypted (SQLCipher) or plaintext.
 *
 * Boolean wrapper around {@link getDatabaseEncryptionState}. Maps `unknown`
 * to `false` to preserve the historical signature, but **callers that may
 * act destructively on the result** (e.g. running an in-place re-encryption
 * conversion) should call {@link getDatabaseEncryptionState} directly and
 * branch on `unknown` explicitly — otherwise a transient read error gets
 * silently treated as "plaintext, please re-encrypt."
 *
 * @param dbPath - Absolute path to the database file
 * @returns true if the file appears to be encrypted, false otherwise
 *          (including when the state is unknown — see warning above)
 */
export function isDatabaseEncrypted(dbPath: string): boolean {
  return getDatabaseEncryptionState(dbPath) === 'encrypted';
}
