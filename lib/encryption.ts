/**
 * Encryption Service for API Keys
 * Phase 0.3: Core Infrastructure
 *
 * Uses AES-256-GCM with per-user encryption keys
 * Keys are derived from user ID + master pepper for security
 */

import crypto from 'crypto'
import { logger } from '@/lib/logger'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const PBKDF2_ITERATIONS = 100000
const PBKDF2_DIGEST = 'sha256'

// Skip validation during build time (Next.js static generation)
const SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION === 'true'

// Get master pepper - may be undefined during build
const MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || ''

// Validate that master pepper is configured (skip during build)
if (!SKIP_ENV_VALIDATION && !MASTER_PEPPER) {
  throw new Error(
    'ENCRYPTION_MASTER_PEPPER environment variable is not set. ' +
    'Generate one with: openssl rand -base64 32'
  )
}

if (!SKIP_ENV_VALIDATION && MASTER_PEPPER && MASTER_PEPPER.length < 32) {
  logger.warn(
    'ENCRYPTION_MASTER_PEPPER should be at least 32 characters for security',
    { context: 'encryption.init', pepperLength: MASTER_PEPPER.length }
  )
}

/**
 * Derive a user-specific encryption key
 * Key is derived from user ID + master pepper using PBKDF2
 * This allows the user to access their keys via OAuth login
 *
 * @param userId - The user's unique ID
 * @returns Buffer containing the derived encryption key
 */
function deriveUserKey(userId: string): Buffer {
  return crypto.pbkdf2Sync(
    userId,
    MASTER_PEPPER,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  )
}

/**
 * Encrypt API key with user-specific key
 * Uses AES-256-GCM for authenticated encryption
 *
 * @param apiKey - The plaintext API key to encrypt
 * @param userId - The user's unique ID
 * @returns Object containing encrypted data, IV, and auth tag
 */
export function encryptApiKey(apiKey: string, userId: string) {
  if (!apiKey) {
    throw new Error('API key cannot be empty')
  }
  if (!userId) {
    throw new Error('User ID cannot be empty')
  }

  const key = deriveUserKey(userId)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv))

  let encrypted = cipher.update(apiKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt API key with user-specific key
 * Verifies authentication tag to ensure data integrity
 *
 * @param encrypted - The encrypted API key (hex string)
 * @param iv - The initialization vector (hex string)
 * @param authTag - The authentication tag (hex string)
 * @param userId - The user's unique ID
 * @returns The decrypted plaintext API key
 * @throws Error if decryption fails or auth tag is invalid
 */
export function decryptApiKey(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string {
  if (!encrypted || !iv || !authTag || !userId) {
    throw new Error('All parameters are required for decryption')
  }

  try {
    const key = deriveUserKey(userId)
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      new Uint8Array(key),
      new Uint8Array(Buffer.from(iv, 'hex'))
    )

    decipher.setAuthTag(new Uint8Array(Buffer.from(authTag, 'hex')))

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    // Don't expose internal error details
    throw new Error('Failed to decrypt API key. Invalid key or corrupted data.')
  }
}

/**
 * Test if encryption/decryption is working correctly
 * Used for system health checks
 *
 * @returns true if encryption is working, false otherwise
 */
export function testEncryption(): boolean {
  try {
    const testUserId = 'test-user-id'
    const testApiKey = 'test-api-key-12345'

    const encrypted = encryptApiKey(testApiKey, testUserId)
    const decrypted = decryptApiKey(
      encrypted.encrypted,
      encrypted.iv,
      encrypted.authTag,
      testUserId
    )

    return decrypted === testApiKey
  } catch (error) {
    logger.error('Encryption test failed', { context: 'encryption.testEncryption' }, error instanceof Error ? error : undefined)
    return false
  }
}

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

/**
 * Generic encrypt function that wraps encryptApiKey
 * Used for encrypting any sensitive data (TOTP secrets, backup codes, etc.)
 */
export function encryptData(data: string, userId: string) {
  return encryptApiKey(data, userId)
}

/**
 * Generic decrypt function that wraps decryptApiKey
 * Used for decrypting any sensitive data (TOTP secrets, backup codes, etc.)
 */
export function decryptData(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string {
  return decryptApiKey(encrypted, iv, authTag, userId)
}
