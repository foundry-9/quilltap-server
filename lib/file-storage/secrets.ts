/**
 * Mount Point Secrets Encryption Utilities
 *
 * Provides encryption/decryption for sensitive mount point secrets
 * using AES-256-GCM with PBKDF2 key derivation.
 *
 * Supports both:
 * - Master key from QUILLTAP_ENCRYPTION_KEY environment variable
 * - Fallback to ENCRYPTION_MASTER_PEPPER from lib/env.ts
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logging/create-logger';

const logger = createLogger('file-storage:secrets');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const SALT_LENGTH = 32; // 256 bits for derivation salt

// Cache for derived encryption key
let cachedKey: Buffer | null = null;

/**
 * Get the encryption key for mount point secrets
 *
 * Derives a 32-byte key using PBKDF2 from either:
 * 1. QUILLTAP_ENCRYPTION_KEY environment variable (if set)
 * 2. ENCRYPTION_MASTER_PEPPER from lib/env.ts (fallback)
 *
 * The key is cached for performance.
 *
 * @returns 32-byte Buffer containing the derived encryption key
 * @throws Error if no encryption secret is configured
 */
export function getEncryptionKey(): Buffer {
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

  // Fall back to master pepper from env.ts
  try {
    // Import here to avoid circular dependencies
    const { env } = require('@/lib/env');
    const pepper = env.ENCRYPTION_MASTER_PEPPER;

    if (!pepper) {
      throw new Error('No encryption key configured');
    }
    cachedKey = deriveKey(pepper);
    return cachedKey;
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : 'Failed to load encryption master pepper';
    logger.error('Failed to get encryption key', {
      error: errorMsg,
    });
    throw new Error(
      'Failed to get encryption key. Ensure ENCRYPTION_MASTER_PEPPER is configured.'
    );
  }
}

/**
 * Internal function to derive a key from a secret using PBKDF2
 *
 * @param secret - The secret to derive key from
 * @returns 32-byte Buffer containing the derived key
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
 * Encrypt a record of mount point secrets
 *
 * Takes a record of secret key-value pairs, JSON stringifies,
 * and encrypts using AES-256-GCM.
 *
 * @param secrets - Record of secret key-value pairs to encrypt
 * @returns Base64-encoded string containing IV + auth tag + ciphertext
 * @throws Error if encryption fails
 *
 * @example
 * ```ts
 * const secrets = {
 *   accessKey: 'aws-access-key',
 *   secretKey: 'aws-secret-key',
 *   token: 'session-token'
 * };
 * const encrypted = encryptSecrets(secrets);
 * ```
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

/**
 * Decrypt a record of mount point secrets
 *
 * Takes the base64-encoded encrypted string, decrypts and JSON parses
 * to return the original secret record.
 *
 * @param encrypted - Base64-encoded encrypted string from encryptSecrets()
 * @returns Original record of secret key-value pairs
 * @throws Error if decryption fails or data is corrupted
 *
 * @example
 * ```ts
 * const encrypted = 'base64EncodedString...';
 * const secrets = decryptSecrets(encrypted);
 * console.log(secrets.accessKey);
 * ```
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
    return secrets;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown decryption error';
    // Don't expose internal error details to caller
    throw new Error(
      'Failed to decrypt secrets. Invalid encryption key or corrupted data.'
    );
  }
}

/**
 * Test if the encryption/decryption system is working correctly
 *
 * Creates a test record, encrypts and decrypts it, then verifies
 * the roundtrip was successful.
 *
 * @returns true if encryption/decryption works, false otherwise
 *
 * @example
 * ```ts
 * if (testSecretEncryption()) {
 *   console.log('Encryption system is operational');
 * }
 * ```
 */
export function testSecretEncryption(): boolean {
  try {
    const testSecrets = {
      test_key_1: 'test-value-1',
      test_key_2: 'test-value-2',
    };

    const encrypted = encryptSecrets(testSecrets);
    const decrypted = decryptSecrets(encrypted);

    const isValid =
      decrypted.test_key_1 === testSecrets.test_key_1 &&
      decrypted.test_key_2 === testSecrets.test_key_2;

    if (!isValid) {
      logger.error('Secret encryption test failed: roundtrip verification failed');
    } else {
    }

    return isValid;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error('Secret encryption test failed', {
      error: errorMsg,
    });
    return false;
  }
}
