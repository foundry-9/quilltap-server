/**
 * Secrets Encryption Utilities for Upgrade Plugin
 *
 * Self-contained AES-256-GCM encryption for mount point secrets.
 * Does NOT depend on @/lib imports to avoid pulling in next/server during startup.
 */

import {
  createCipheriv,
  randomBytes,
  pbkdf2Sync,
  createHash,
} from 'crypto';
import { logger } from './logger';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const SALT_LENGTH = 32; // 256 bits for derivation salt

// Cache for derived encryption key
let cachedKey: Buffer | null = null;

/**
 * Internal function to derive a key from a secret using PBKDF2
 */
function deriveKey(secret: string): Buffer {
  // Use a fixed salt derived from the secret itself for consistency
  // This allows the same secret to always produce the same key
  const salt = createHash('sha256')
    .update('quilltap-mount-secrets' + secret)
    .digest()
    .slice(0, SALT_LENGTH);

  return pbkdf2Sync(
    secret,
    new Uint8Array(salt),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Get the encryption key for mount point secrets
 *
 * Derives a 32-byte key using PBKDF2 from either:
 * 1. QUILLTAP_ENCRYPTION_KEY environment variable (if set)
 * 2. ENCRYPTION_MASTER_PEPPER environment variable (fallback)
 *
 * The key is cached for performance.
 */
function getEncryptionKey(): Buffer {
  // Return cached key if available
  if (cachedKey) {
    return cachedKey;
  }

  // Try to get key from explicit encryption key env var first
  const explicitKey = process.env.QUILLTAP_ENCRYPTION_KEY;
  if (explicitKey) {
    cachedKey = deriveKey(explicitKey);
    return cachedKey;
  }

  // Fall back to master pepper
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    cachedKey = deriveKey(pepper);
    return cachedKey;
  }

  // If no key configured, throw error
  throw new Error(
    'No encryption key configured. Set QUILLTAP_ENCRYPTION_KEY or ENCRYPTION_MASTER_PEPPER environment variable.'
  );
}

/**
 * Encrypt a record of mount point secrets
 *
 * Takes a record of secret key-value pairs, JSON stringifies,
 * and encrypts using AES-256-GCM.
 *
 * @param secrets - Record of secret key-value pairs to encrypt
 * @returns Base64-encoded string containing IV + auth tag + ciphertext
 */
export function encryptSecrets(secrets: Record<string, string>): string {
  if (!secrets || typeof secrets !== 'object') {
    throw new Error('Secrets must be a valid object');
  }

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(
      ALGORITHM,
      new Uint8Array(key),
      new Uint8Array(iv)
    );

    const jsonData = JSON.stringify(secrets);
    let encrypted = cipher.update(jsonData, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine: IV (32 hex chars = 16 bytes) + authTag (32 hex chars = 16 bytes) + ciphertext
    const combined = iv.toString('hex') + authTag.toString('hex') + encrypted;

    // Return as base64 for easier storage/transmission
    const encoded = Buffer.from(combined, 'hex').toString('base64');
    return encoded;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown encryption error';
    logger.error('Failed to encrypt secrets', {
      error: errorMsg,
    });
    throw new Error(`Failed to encrypt secrets: ${errorMsg}`);
  }
}
