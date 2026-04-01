/**
 * Unit Tests for Mount Point Secrets Encryption
 * Tests lib/file-storage/secrets.ts
 * v2.7-dev: File Storage Abstraction - Secret Encryption
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// Store original env
const originalEnv = process.env

// Mock the logger
jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

// We need to use a different approach for testing since the module caches the key
// Create a test that works with the module's behavior

// Define the module interface for TypeScript
interface SecretsModule {
  encryptSecrets: (secrets: Record<string, string>) => string
  decryptSecrets: (encrypted: string) => Record<string, string>
  getEncryptionKey: () => Buffer
}

// Helper to import the module with proper typing
// @ts-expect-error - Jest module resolution differs from TypeScript
const importSecrets = (): Promise<SecretsModule> => import('@/lib/file-storage/secrets')

describe('Mount Point Secrets Encryption', () => {
  beforeEach(() => {
    jest.resetModules()
    // Set up encryption key for tests
    process.env = {
      ...originalEnv,
      QUILLTAP_ENCRYPTION_KEY: 'test-encryption-key-for-unit-tests-32chars!',
    }
  })

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  describe('encryptSecrets and decryptSecrets', () => {
    it('encrypts and decrypts secrets correctly', async () => {
      // Import fresh module with test environment
      const { encryptSecrets, decryptSecrets } = await importSecrets()

      const secrets = {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-west-2',
      }

      const encrypted = encryptSecrets(secrets)
      const decrypted = decryptSecrets(encrypted)

      expect(decrypted).toEqual(secrets)
    })

    it('produces different ciphertext for different secrets', async () => {
      const { encryptSecrets } = await importSecrets()

      const secrets1 = { key: 'value1' }
      const secrets2 = { key: 'value2' }

      const encrypted1 = encryptSecrets(secrets1)
      const encrypted2 = encryptSecrets(secrets2)

      expect(encrypted1).not.toBe(encrypted2)
    })

    it('produces different ciphertext on each encryption (random IV)', async () => {
      const { encryptSecrets } = await importSecrets()

      const secrets = { key: 'same-value' }

      const encrypted1 = encryptSecrets(secrets)
      const encrypted2 = encryptSecrets(secrets)

      // Even same secrets should produce different ciphertext due to random IV
      expect(encrypted1).not.toBe(encrypted2)
    })

    it('handles empty secrets object', async () => {
      const { encryptSecrets, decryptSecrets } = await importSecrets()

      const secrets = {}

      const encrypted = encryptSecrets(secrets)
      const decrypted = decryptSecrets(encrypted)

      expect(decrypted).toEqual({})
    })

    it('handles secrets with special characters', async () => {
      const { encryptSecrets, decryptSecrets } = await importSecrets()

      const secrets = {
        password: 'p@$$w0rd!#$%^&*(){}[]|\\:";\'<>,.?/',
        unicode: '日本語テスト 🔐',
        multiline: 'line1\nline2\nline3',
      }

      const encrypted = encryptSecrets(secrets)
      const decrypted = decryptSecrets(encrypted)

      expect(decrypted).toEqual(secrets)
    })

    it('handles large secrets', async () => {
      const { encryptSecrets, decryptSecrets } = await importSecrets()

      const secrets = {
        largeKey: 'x'.repeat(10000),
        anotherKey: 'y'.repeat(5000),
      }

      const encrypted = encryptSecrets(secrets)
      const decrypted = decryptSecrets(encrypted)

      expect(decrypted).toEqual(secrets)
    })

    it('returns base64 encoded string', async () => {
      const { encryptSecrets } = await importSecrets()

      const secrets = { key: 'value' }
      const encrypted = encryptSecrets(secrets)

      // Verify it's valid base64
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow()
      // Base64 string should not contain newlines
      expect(encrypted).not.toContain('\n')
    })

    it('throws error for invalid encrypted data', async () => {
      const { decryptSecrets } = await importSecrets()

      expect(() => decryptSecrets('not-valid-encrypted-data')).toThrow()
    })

    it('throws error for tampered ciphertext', async () => {
      const { encryptSecrets, decryptSecrets } = await importSecrets()

      const secrets = { key: 'value' }
      const encrypted = encryptSecrets(secrets)

      // Tamper with the encrypted data
      const tamperedBuffer = Buffer.from(encrypted, 'base64')
      tamperedBuffer[tamperedBuffer.length - 10] ^= 0xFF // Flip some bits
      const tampered = tamperedBuffer.toString('base64')

      expect(() => decryptSecrets(tampered)).toThrow()
    })

    it('throws error for null secrets', async () => {
      const { encryptSecrets } = await importSecrets()

      expect(() => encryptSecrets(null as unknown as Record<string, string>)).toThrow()
    })

    it('throws error for non-object secrets', async () => {
      const { encryptSecrets } = await importSecrets()

      expect(() => encryptSecrets('string' as unknown as Record<string, string>)).toThrow()
    })

    it('throws error for null encrypted data', async () => {
      const { decryptSecrets } = await importSecrets()

      expect(() => decryptSecrets(null as unknown as string)).toThrow()
    })

    it('throws error for non-string encrypted data', async () => {
      const { decryptSecrets } = await importSecrets()

      expect(() => decryptSecrets(123 as unknown as string)).toThrow()
    })
  })

  describe('getEncryptionKey', () => {
    it('uses QUILLTAP_ENCRYPTION_KEY when available', async () => {
      process.env.QUILLTAP_ENCRYPTION_KEY = 'explicit-encryption-key'

      const { getEncryptionKey } = await importSecrets()

      // Should not throw - key should be derived
      const key = getEncryptionKey()
      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32) // 256-bit key
    })

    it('throws error when no encryption key configured', async () => {
      delete process.env.QUILLTAP_ENCRYPTION_KEY
      delete process.env.ENCRYPTION_MASTER_PEPPER

      // This test is tricky because the module caches the key
      // We're mainly testing that the error path exists
      jest.resetModules()

      const { getEncryptionKey } = await importSecrets()

      // With no key configured, should throw
      expect(() => getEncryptionKey()).toThrow('encryption key')
    })

    it('caches derived key for performance', async () => {
      const { getEncryptionKey } = await importSecrets()

      const key1 = getEncryptionKey()
      const key2 = getEncryptionKey()

      // Should return same Buffer instance (cached)
      expect(key1).toBe(key2)
    })

    it('derives 32-byte key using PBKDF2', async () => {
      const { getEncryptionKey } = await importSecrets()

      const key = getEncryptionKey()

      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32) // 256-bit key for AES-256
    })
  })
})
