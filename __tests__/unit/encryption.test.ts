/**
 * Unit Tests for Encryption Service
 * After field-level encryption removal, only passphrase-based and masking functions remain.
 */

// Unmock the encryption module to test the real implementation
jest.unmock('@/lib/encryption')

import {
  maskApiKey,
  encryptWithPassphrase,
  decryptWithPassphrase,
  deriveKeyFromPassphrase,
  signWithPassphrase,
  verifyWithPassphrase,
} from '@/lib/encryption'

describe('Encryption Service', () => {
  describe('maskApiKey', () => {
    it('should mask a standard API key', () => {
      const masked = maskApiKey('sk-1234567890abcdefghijklmnop')
      // Shows first 8 chars, 4 bullets, last 4 chars (fixed length masking)
      expect(masked).toBe('sk-12345••••mnop')
    })

    it('should handle short keys', () => {
      const masked = maskApiKey('short')
      expect(masked).toBe('••••••••••••')
    })

    it('should handle very long keys', () => {
      const longKey = 'sk-' + 'a'.repeat(100)
      const masked = maskApiKey(longKey)
      // Should always use exactly 4 bullets regardless of length
      expect(masked).toBe('sk-aaaaa••••aaaa')
    })

    it('should handle empty string', () => {
      const masked = maskApiKey('')
      expect(masked).toBe('••••••••••••')
    })

    it('should not leak key length information', () => {
      const shortKey = 'sk-shortkey1'
      const longKey = 'sk-verylongapikey123456789012345678901234567890'
      const shortMasked = maskApiKey(shortKey)
      const longMasked = maskApiKey(longKey)

      // Both should have exactly 4 bullets in the middle
      expect(shortMasked).toMatch(/^.{8}••••.{4}$/)
      expect(longMasked).toMatch(/^.{8}••••.{4}$/)

      // Verify the actual values
      expect(shortMasked).toBe('sk-short••••key1')
      expect(longMasked).toBe('sk-veryl••••7890')
    })
  })

  describe('deriveKeyFromPassphrase', () => {
    it('should derive a 32-byte key from passphrase and salt', () => {
      const key = deriveKeyFromPassphrase('my-passphrase', Buffer.from('a'.repeat(32)))
      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32)
    })

    it('should produce consistent results for same inputs', () => {
      const salt = Buffer.from('consistent-salt-value-32-chars!!')
      const key1 = deriveKeyFromPassphrase('passphrase', salt)
      const key2 = deriveKeyFromPassphrase('passphrase', salt)
      expect(key1.equals(key2)).toBe(true)
    })

    it('should produce different keys for different passphrases', () => {
      const salt = Buffer.from('consistent-salt-value-32-chars!!')
      const key1 = deriveKeyFromPassphrase('passphrase1', salt)
      const key2 = deriveKeyFromPassphrase('passphrase2', salt)
      expect(key1.equals(key2)).toBe(false)
    })

    it('should accept hex-encoded salt string', () => {
      const saltHex = Buffer.from('salt-value-for-hex').toString('hex')
      const key = deriveKeyFromPassphrase('passphrase', saltHex)
      expect(key).toBeInstanceOf(Buffer)
      expect(key.length).toBe(32)
    })
  })

  describe('encryptWithPassphrase / decryptWithPassphrase', () => {
    it('should encrypt and decrypt data round-trip', () => {
      const data = { message: 'hello world', count: 42 }
      const encrypted = encryptWithPassphrase(data, 'my-passphrase')

      expect(encrypted).toHaveProperty('salt')
      expect(encrypted).toHaveProperty('iv')
      expect(encrypted).toHaveProperty('ciphertext')
      expect(encrypted).toHaveProperty('authTag')

      const decrypted = decryptWithPassphrase<typeof data>(encrypted, 'my-passphrase')
      expect(decrypted).toEqual(data)
    })

    it('should fail with wrong passphrase', () => {
      const data = { secret: 'value' }
      const encrypted = encryptWithPassphrase(data, 'correct-passphrase')

      expect(() => {
        decryptWithPassphrase(encrypted, 'wrong-passphrase')
      }).toThrow('Failed to decrypt')
    })

    it('should throw on empty passphrase for encrypt', () => {
      expect(() => encryptWithPassphrase('data', '')).toThrow('Passphrase cannot be empty')
    })

    it('should throw on empty passphrase for decrypt', () => {
      expect(() =>
        decryptWithPassphrase({ salt: 'a', iv: 'b', ciphertext: 'c', authTag: 'd' }, '')
      ).toThrow('Passphrase cannot be empty')
    })

    it('should throw on invalid encrypted data structure', () => {
      expect(() =>
        decryptWithPassphrase({ salt: '', iv: 'b', ciphertext: 'c', authTag: 'd' }, 'pass')
      ).toThrow('Invalid encrypted data structure')
    })

    it('should handle different data types', () => {
      const testCases = [
        'a simple string',
        42,
        [1, 2, 3],
        { nested: { deep: true } },
        null,
      ]

      for (const data of testCases) {
        const encrypted = encryptWithPassphrase(data, 'pass')
        const decrypted = decryptWithPassphrase(encrypted, 'pass')
        expect(decrypted).toEqual(data)
      }
    })

    it('should produce different ciphertext for same data each time', () => {
      const data = 'same data'
      const enc1 = encryptWithPassphrase(data, 'pass')
      const enc2 = encryptWithPassphrase(data, 'pass')
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext)
      expect(enc1.salt).not.toBe(enc2.salt)
    })
  })

  describe('signWithPassphrase / verifyWithPassphrase', () => {
    it('should sign data and verify the signature', () => {
      const data = '{"some":"json","payload":true}'
      const passphrase = 'signing-passphrase'
      const signature = signWithPassphrase(data, passphrase)

      expect(typeof signature).toBe('string')
      expect(signature.length).toBeGreaterThan(0)
      expect(verifyWithPassphrase(data, signature, passphrase)).toBe(true)
    })

    it('should reject signature with wrong passphrase', () => {
      const data = 'important data'
      const signature = signWithPassphrase(data, 'correct')

      expect(verifyWithPassphrase(data, signature, 'wrong')).toBe(false)
    })

    it('should reject signature with tampered data', () => {
      const data = 'original data'
      const signature = signWithPassphrase(data, 'pass')

      expect(verifyWithPassphrase('tampered data', signature, 'pass')).toBe(false)
    })

    it('should produce consistent signatures for same inputs', () => {
      const data = 'consistent data'
      const pass = 'consistent-pass'
      const sig1 = signWithPassphrase(data, pass)
      const sig2 = signWithPassphrase(data, pass)
      expect(sig1).toBe(sig2)
    })

    it('should return false for invalid signature format', () => {
      expect(verifyWithPassphrase('data', 'not-valid-hex!', 'pass')).toBe(false)
    })
  })
})
