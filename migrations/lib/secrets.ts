/**
 * Secrets Encryption Utilities for Upgrade Plugin
 *
 * Self-contained AES-256-GCM encryption for mount point secrets.
 * Does NOT depend on @/lib imports to avoid pulling in next/server during startup.
 */

import {
  createCipheriv,
  createDecipheriv,
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
export function getEncryptionKey(): Buffer {
  // Return cached key if available
  if (cachedKey) {
    return cachedKey;
  }

  // Try to get key from explicit encryption key env var first
  const explicitKey = process.env.QUILLTAP_ENCRYPTION_KEY;
  if (explicitKey) {
    logger.debug('Using QUILLTAP_ENCRYPTION_KEY for mount point secrets', {
      keyLength: explicitKey.length,
    });
    cachedKey = deriveKey(explicitKey);
    return cachedKey;
  }

  // Fall back to master pepper
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    logger.debug('Using ENCRYPTION_MASTER_PEPPER for mount point secrets', {
      pepperLength: pepper.length,
    });
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

    logger.debug('Encrypted mount point secrets', {
      secretsCount: Object.keys(secrets).length,
      encryptedLength: encoded.length,
    });

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

/**
 * Decrypt a record of mount point secrets
 *
 * Takes the base64-encoded encrypted string, decrypts and JSON parses
 * to return the original secret record.
 */
export function decryptSecrets(encrypted: string): Record<string, string> {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Encrypted data must be a valid base64 string');
  }

  try {
    const key = getEncryptionKey();

    // Decode from base64
    const combined = Buffer.from(encrypted, 'base64').toString('hex');

    // Extract components: IV (32 hex chars) + authTag (32 hex chars) + ciphertext
    const ivHex = combined.slice(0, 32);
    const authTagHex = combined.slice(32, 64);
    const ciphertextHex = combined.slice(64);

    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Invalid encrypted data structure');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(
      ALGORITHM,
      new Uint8Array(key),
      new Uint8Array(iv)
    );

    decipher.setAuthTag(new Uint8Array(authTag));

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const secrets = JSON.parse(decrypted) as Record<string, string>;

    logger.debug('Decrypted mount point secrets', {
      secretsCount: Object.keys(secrets).length,
    });

    return secrets;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown decryption error';
    logger.debug('Failed to decrypt secrets', {
      error: errorMsg,
    });

    // Don't expose internal error details to caller
    throw new Error(
      'Failed to decrypt secrets. Invalid encryption key or corrupted data.'
    );
  }
}
