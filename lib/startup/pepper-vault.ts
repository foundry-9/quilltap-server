/**
 * Pepper Vault
 *
 * Manages the ENCRYPTION_MASTER_PEPPER lifecycle:
 * - Auto-generates pepper on first run
 * - Encrypts pepper with a user-provided passphrase (or without one)
 * - Stores encrypted pepper in SQLite pepper_vault table
 * - Decrypts and provisions pepper on subsequent startups
 *
 * IMPORTANT: This module intentionally avoids importing from lib/env.ts,
 * lib/logger.ts, or lib/encryption.ts to prevent circular dependencies
 * and premature env validation. It uses standalone utilities from the
 * migrations directory instead.
 */

import crypto from 'crypto';
import { logger as migrationLogger } from '../../migrations/lib/logger';
import {
  getSQLiteDatabase,
  closeSQLite,
  ensureSQLiteDataDir,
} from '../../migrations/lib/database-utils';

// ============================================================================
// Types
// ============================================================================

export type PepperState =
  | 'resolved'
  | 'needs-setup'
  | 'needs-unlock'
  | 'needs-vault-storage';

interface StoredPepper {
  id: number;
  encrypted_pepper: string;
  pepper_hash: string;
  has_passphrase: number;
  created_at: string;
}

interface EncryptedPepperData {
  salt: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

// ============================================================================
// Constants (match lib/encryption.ts)
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

// Internal passphrase used when the user skips setting one
const INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

const log = migrationLogger.child({ context: 'pepper-vault' });

// ============================================================================
// Module state (stored on global to survive Next.js module reloads)
// ============================================================================

// Extend globalThis type
declare global {
  var __quilltapPepperVaultState: PepperState | undefined;
}

function getCurrentPepperState(): PepperState {
  return global.__quilltapPepperVaultState || 'needs-setup';
}

function setCurrentPepperState(state: PepperState): void {
  global.__quilltapPepperVaultState = state;
}

// ============================================================================
// Crypto Helpers
// ============================================================================

/**
 * Hash a pepper using SHA-256 for verification
 */
function hashPepper(pepper: string): string {
  return crypto.createHash('sha256').update(pepper).digest('hex');
}

/**
 * Encrypt a pepper with a passphrase using AES-256-GCM
 */
function encryptPepper(pepper: string, passphrase: string): EncryptedPepperData {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.pbkdf2Sync(passphrase, new Uint8Array(salt), PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv));
  let ciphertext = cipher.update(pepper, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt a pepper with a passphrase using AES-256-GCM
 * Returns null if decryption fails (wrong passphrase)
 */
function decryptPepper(data: EncryptedPepperData, passphrase: string): string | null {
  try {
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.pbkdf2Sync(passphrase, new Uint8Array(salt), PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
    const iv = Buffer.from(data.iv, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv));
    decipher.setAuthTag(new Uint8Array(Buffer.from(data.authTag, 'hex')));

    let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically secure pepper
 */
function generatePepper(): string {
  return crypto.randomBytes(32).toString('base64');
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Ensure the pepper_vault table exists
 */
function ensurePepperVaultTable(): void {
  ensureSQLiteDataDir();
  const db = getSQLiteDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pepper_vault (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      encrypted_pepper TEXT NOT NULL,
      pepper_hash TEXT NOT NULL,
      has_passphrase INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
}

/**
 * Get the stored pepper record, if any
 */
function getStoredPepper(): StoredPepper | null {
  const db = getSQLiteDatabase();
  const row = db.prepare('SELECT * FROM pepper_vault WHERE id = 1').get() as StoredPepper | undefined;
  return row || null;
}

/**
 * Store an encrypted pepper in the vault
 */
function storePepper(
  encryptedData: EncryptedPepperData,
  pepperHash: string,
  hasPassphrase: boolean
): void {
  const db = getSQLiteDatabase();
  const json = JSON.stringify(encryptedData);

  // Use INSERT OR REPLACE to handle both first-time and re-store
  db.prepare(`
    INSERT OR REPLACE INTO pepper_vault (id, encrypted_pepper, pepper_hash, has_passphrase, created_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(json, pepperHash, hasPassphrase ? 1 : 0, new Date().toISOString());
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current pepper state
 */
export function getPepperState(): PepperState {
  return getCurrentPepperState();
}

/**
 * Provision the pepper on startup
 *
 * Determines the pepper state and auto-resolves when possible.
 * Called from instrumentation.ts before logger/env imports.
 */
export async function provisionPepper(): Promise<PepperState> {
  log.info('Provisioning pepper vault');

  try {
    ensurePepperVaultTable();

    const envPepper = process.env.ENCRYPTION_MASTER_PEPPER || '';
    const stored = getStoredPepper();

    // Case 1: Env var set + stored pepper exists
    if (envPepper && stored) {
      const envHash = hashPepper(envPepper);

      if (envHash === stored.pepper_hash) {
        // Hashes match — all good
        log.info('Pepper resolved: env var matches stored hash');
        setCurrentPepperState('resolved');
        closeSQLite();
        return 'resolved';
      }

      // Hash mismatch — FATAL: pepper was changed externally
      log.error('FATAL: ENCRYPTION_MASTER_PEPPER does not match stored pepper hash. ' +
        'The pepper has been changed since it was stored in the vault. ' +
        'This would cause all encrypted data to become unreadable. ' +
        'Restore the original pepper or delete the pepper_vault table to re-initialize.', {
        envHashPrefix: envHash.substring(0, 12),
        storedHashPrefix: stored.pepper_hash.substring(0, 12),
      });
      closeSQLite();
      process.exit(1);
    }

    // Case 2: Env var set + no stored pepper
    if (envPepper && !stored) {
      log.info('Pepper resolved from env var, vault storage recommended');
      setCurrentPepperState('needs-vault-storage');
      closeSQLite();
      return 'needs-vault-storage';
    }

    // Case 3: No env var + stored pepper exists
    if (!envPepper && stored) {
      const encryptedData: EncryptedPepperData = JSON.parse(stored.encrypted_pepper);

      if (!stored.has_passphrase) {
        // No passphrase — decrypt silently
        const pepper = decryptPepper(encryptedData, INTERNAL_PASSPHRASE);

        if (pepper && hashPepper(pepper) === stored.pepper_hash) {
          log.info('Pepper resolved: decrypted from vault (no passphrase)');
          process.env.ENCRYPTION_MASTER_PEPPER = pepper;
          setCurrentPepperState('resolved');
          closeSQLite();
          return 'resolved';
        }

        log.error('Failed to decrypt stored pepper without passphrase — vault may be corrupt');
        setCurrentPepperState('needs-setup');
        closeSQLite();
        return 'needs-setup';
      }

      // Has passphrase — need user to unlock
      log.info('Pepper stored with passphrase, unlock required');
      setCurrentPepperState('needs-unlock');
      closeSQLite();
      return 'needs-unlock';
    }

    // Case 4: No env var + no stored pepper — first run
    log.info('No pepper configured, setup required');
    setCurrentPepperState('needs-setup');
    closeSQLite();
    return 'needs-setup';
  } catch (error) {
    log.error('Error during pepper provisioning', {
      error: error instanceof Error ? error.message : String(error),
    });
    // If we can't even check the vault, fall through to needs-setup
    setCurrentPepperState('needs-setup');
    try { closeSQLite(); } catch { /* ignore */ }
    return 'needs-setup';
  }
}

/**
 * Set up a new pepper (first-run)
 *
 * Generates a new pepper, encrypts it with the given passphrase,
 * stores it in the vault, and sets it in process.env.
 *
 * @param passphrase - User-provided passphrase (empty string = no passphrase)
 * @returns The generated pepper (shown to user once)
 */
export function setupPepper(passphrase: string): { pepper: string } {
  log.info('Setting up new pepper');

  ensurePepperVaultTable();

  // Check that we're actually in needs-setup state
  if (getCurrentPepperState() !== 'needs-setup') {
    throw new Error(`Cannot setup pepper in state: ${getCurrentPepperState()}`);
  }

  const pepper = generatePepper();
  const pepperHash = hashPepper(pepper);
  const hasPassphrase = passphrase.length > 0;
  const actualPassphrase = hasPassphrase ? passphrase : INTERNAL_PASSPHRASE;

  const encryptedData = encryptPepper(pepper, actualPassphrase);
  storePepper(encryptedData, pepperHash, hasPassphrase);

  // Set in process.env so the app can use it immediately
  process.env.ENCRYPTION_MASTER_PEPPER = pepper;
  setCurrentPepperState('resolved');

  log.info('Pepper setup complete', { hasPassphrase });
  closeSQLite();

  return { pepper };
}

/**
 * Unlock an existing pepper using a passphrase
 *
 * @param passphrase - The passphrase used when storing the pepper
 * @returns true if unlock succeeded
 */
export function unlockPepper(passphrase: string): boolean {
  log.info('Attempting to unlock pepper');

  ensurePepperVaultTable();

  if (getCurrentPepperState() !== 'needs-unlock') {
    throw new Error(`Cannot unlock pepper in state: ${getCurrentPepperState()}`);
  }

  const stored = getStoredPepper();
  if (!stored) {
    log.error('No stored pepper found during unlock');
    return false;
  }

  const encryptedData: EncryptedPepperData = JSON.parse(stored.encrypted_pepper);
  const pepper = decryptPepper(encryptedData, passphrase);

  if (!pepper) {
    log.warn('Pepper unlock failed: wrong passphrase');
    closeSQLite();
    return false;
  }

  // Verify hash
  if (hashPepper(pepper) !== stored.pepper_hash) {
    log.error('Pepper unlock failed: hash mismatch after decryption');
    closeSQLite();
    return false;
  }

  // Success
  process.env.ENCRYPTION_MASTER_PEPPER = pepper;
  setCurrentPepperState('resolved');

  log.info('Pepper unlocked successfully');
  closeSQLite();
  return true;
}

/**
 * Store an existing env var pepper in the vault
 *
 * Used when the pepper is already set via env var but not yet stored.
 *
 * @param passphrase - User-provided passphrase (empty string = no passphrase)
 */
export function storePepperInVault(passphrase: string): void {
  log.info('Storing existing pepper in vault');

  ensurePepperVaultTable();

  if (getCurrentPepperState() !== 'needs-vault-storage') {
    throw new Error(`Cannot store pepper in vault in state: ${getCurrentPepperState()}`);
  }

  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (!pepper) {
    throw new Error('No pepper in environment to store');
  }

  const pepperHash = hashPepper(pepper);
  const hasPassphrase = passphrase.length > 0;
  const actualPassphrase = hasPassphrase ? passphrase : INTERNAL_PASSPHRASE;

  const encryptedData = encryptPepper(pepper, actualPassphrase);
  storePepper(encryptedData, pepperHash, hasPassphrase);

  setCurrentPepperState('resolved');

  log.info('Pepper stored in vault', { hasPassphrase });
  closeSQLite();
}
