/**
 * Shared AES-256-GCM + PBKDF2 primitives for the pepper lifecycle.
 *
 * Two distinct stores wrap these primitives:
 * - `pepper-vault.ts` — legacy SQLite-backed store (PBKDF2: 100k iterations)
 * - `dbkey.ts` — `.dbkey` file on disk (PBKDF2: 600k iterations, params on disk)
 *
 * Both call the same encrypt/decrypt code; the caller supplies the
 * cryptographic parameters so each store can keep its own constants or read
 * them from a versioned file.
 *
 * IMPORTANT: Like its callers, this module intentionally avoids importing
 * from `lib/env`, `lib/logger`, or `lib/encryption` to keep the pepper
 * startup path free of circular dependencies. It uses only `crypto` from
 * Node built-ins.
 */

import crypto from 'crypto'

/** Cryptographic parameters needed to encrypt or decrypt a pepper. */
export interface PepperCryptoParams {
  /** Symmetric cipher algorithm (e.g. 'aes-256-gcm'). */
  algorithm: string
  /** Number of PBKDF2 iterations. */
  kdfIterations: number
  /** PBKDF2 digest algorithm (e.g. 'sha256'). */
  kdfDigest: string
  /** AES key length in bytes (32 for AES-256). */
  keyLength: number
  /** GCM IV length in bytes (typically 16). */
  ivLength: number
  /** PBKDF2 salt length in bytes. */
  saltLength: number
}

/**
 * The bundle of hex-encoded fields produced by encryption and required for
 * decryption. Each caller wraps this in its own outer record (with version,
 * algorithm metadata, pepper hash, etc.).
 */
export interface EncryptedPepperBundle {
  salt: string
  iv: string
  ciphertext: string
  authTag: string
}

/** SHA-256 hash of a pepper as a hex string. Used for verification. */
export function hashPepper(pepper: string): string {
  return crypto.createHash('sha256').update(pepper).digest('hex')
}

/**
 * Encrypt a pepper with a passphrase using AES-GCM + PBKDF2. Generates a
 * fresh random salt and IV for each call.
 */
export function encryptPepperWithParams(
  pepper: string,
  passphrase: string,
  params: PepperCryptoParams,
): EncryptedPepperBundle {
  const salt = crypto.randomBytes(params.saltLength)
  const key = crypto.pbkdf2Sync(
    passphrase,
    new Uint8Array(salt),
    params.kdfIterations,
    params.keyLength,
    params.kdfDigest,
  )
  const iv = crypto.randomBytes(params.ivLength)
  const cipher = crypto.createCipheriv(
    params.algorithm as 'aes-256-gcm',
    new Uint8Array(key),
    new Uint8Array(iv),
  )
  let ciphertext = cipher.update(pepper, 'utf8', 'hex')
  ciphertext += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt a pepper bundle with the given passphrase and params. Returns
 * null on any failure (wrong passphrase, tampered data, missing fields).
 */
export function decryptPepperWithParams(
  bundle: EncryptedPepperBundle,
  passphrase: string,
  params: PepperCryptoParams,
): string | null {
  try {
    const salt = Buffer.from(bundle.salt, 'hex')
    const key = crypto.pbkdf2Sync(
      passphrase,
      new Uint8Array(salt),
      params.kdfIterations,
      params.keyLength,
      params.kdfDigest,
    )
    const iv = Buffer.from(bundle.iv, 'hex')
    const decipher = crypto.createDecipheriv(
      params.algorithm as 'aes-256-gcm',
      new Uint8Array(key),
      new Uint8Array(iv),
    )
    decipher.setAuthTag(new Uint8Array(Buffer.from(bundle.authTag, 'hex')))
    let plaintext = decipher.update(bundle.ciphertext, 'hex', 'utf8')
    plaintext += decipher.final('utf8')
    return plaintext
  } catch {
    return null
  }
}
