/**
 * Encryption Service
 *
 * Field-level API key encryption has been removed in favour of
 * database-level encryption (SQLCipher). This module now provides:
 *
 *  - maskApiKey()            — redact keys for display
 *  - Passphrase-based encryption for import/export files
 *  - Passphrase-based HMAC signing for export integrity verification
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const PBKDF2_ITERATIONS = 100000
const PBKDF2_DIGEST = 'sha256'

/**
 * Mask an API key for display purposes
 * Shows only first 8 and last 4 characters, with fixed 4-bullet masking
 * Uses fixed length masking to avoid leaking key length information
 *
 * @param apiKey - The API key to mask
 * @returns Masked API key string
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return '••••••••••••'
  }

  const prefix = apiKey.substring(0, 8)
  const suffix = apiKey.substring(apiKey.length - 4)
  const masked = '••••'

  return `${prefix}${masked}${suffix}`
}

// ============================================================================
// Passphrase-based encryption for import/export
// ============================================================================

const SALT_LENGTH = 32 // 256 bits for passphrase salt

/**
 * Derive encryption key from a passphrase using PBKDF2
 * Uses a random salt that must be stored with the encrypted data
 *
 * @param passphrase - User-provided passphrase
 * @param salt - 32-byte salt (Buffer or hex string)
 * @returns Buffer containing the derived encryption key
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Buffer | string): Buffer {
  const saltBuffer = typeof salt === 'string' ? Buffer.from(salt, 'hex') : salt

  return crypto.pbkdf2Sync(
    passphrase,
    new Uint8Array(saltBuffer),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  )
}

/**
 * Encrypt data with a user-provided passphrase
 * Uses AES-256-GCM for authenticated encryption
 *
 * @param data - Data to encrypt (will be JSON serialized)
 * @param passphrase - User-provided passphrase
 * @returns Object containing salt, iv, ciphertext, and authTag (all hex encoded)
 */
export function encryptWithPassphrase(data: unknown, passphrase: string): {
  salt: string
  iv: string
  ciphertext: string
  authTag: string
} {
  if (!passphrase) {
    throw new Error('Passphrase cannot be empty')
  }

  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKeyFromPassphrase(passphrase, salt)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv))

  const jsonData = JSON.stringify(data)
  let encrypted = cipher.update(jsonData, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: encrypted,
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt data with a user-provided passphrase
 * Verifies authentication tag to ensure data integrity
 *
 * @param encrypted - Object containing salt, iv, ciphertext, and authTag
 * @param passphrase - User-provided passphrase
 * @returns Decrypted and parsed data
 * @throws Error if passphrase is wrong or data is corrupted
 */
export function decryptWithPassphrase<T>(
  encrypted: { salt: string; iv: string; ciphertext: string; authTag: string },
  passphrase: string
): T {
  if (!encrypted.salt || !encrypted.iv || !encrypted.ciphertext || !encrypted.authTag) {
    throw new Error('Invalid encrypted data structure')
  }
  if (!passphrase) {
    throw new Error('Passphrase cannot be empty')
  }

  try {
    const key = deriveKeyFromPassphrase(passphrase, encrypted.salt)
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      new Uint8Array(key),
      new Uint8Array(Buffer.from(encrypted.iv, 'hex'))
    )

    decipher.setAuthTag(new Uint8Array(Buffer.from(encrypted.authTag, 'hex')))

    let decrypted = decipher.update(encrypted.ciphertext, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return JSON.parse(decrypted) as T
  } catch (error) {

    throw new Error('Failed to decrypt. Invalid passphrase or corrupted data.')
  }
}

/**
 * Sign data with a passphrase-derived HMAC key.
 * Used for export file integrity verification.
 *
 * @param data - String data to sign (typically the encrypted payload JSON)
 * @param passphrase - User-provided passphrase
 * @returns Hex-encoded HMAC signature
 */
export function signWithPassphrase(data: string, passphrase: string): string {
  const key = deriveKeyFromPassphrase(passphrase, Buffer.from('quilltap-export-signing'))
  return crypto.createHmac('sha256', new Uint8Array(key)).update(data).digest('hex')
}

/**
 * Verify data signature with a passphrase-derived HMAC key.
 *
 * @param data - String data that was signed
 * @param signature - Hex-encoded HMAC signature to verify
 * @param passphrase - User-provided passphrase
 * @returns true if signature is valid, false otherwise
 */
export function verifyWithPassphrase(data: string, signature: string, passphrase: string): boolean {
  try {
    const expected = signWithPassphrase(data, passphrase)
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}
