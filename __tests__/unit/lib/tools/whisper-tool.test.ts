/**
 * Tests for lib/tools/whisper-tool.ts
 */

import { validateWhisperInput } from '@/lib/tools/whisper-tool'

describe('validateWhisperInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateWhisperInput(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(validateWhisperInput(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(validateWhisperInput('not an object')).toBe(false)
    })

    it('returns false for number', () => {
      expect(validateWhisperInput(42)).toBe(false)
    })

    it('returns false for array', () => {
      expect(validateWhisperInput(['target', 'message'])).toBe(false)
    })
  })

  describe('missing or invalid fields', () => {
    it('returns false for empty object', () => {
      expect(validateWhisperInput({})).toBe(false)
    })

    it('returns false for missing target', () => {
      expect(validateWhisperInput({ message: 'hello' })).toBe(false)
    })

    it('returns false for missing message', () => {
      expect(validateWhisperInput({ target: 'Alice' })).toBe(false)
    })

    it('returns false for empty target string', () => {
      expect(validateWhisperInput({ target: '', message: 'hello' })).toBe(false)
    })

    it('returns false for empty message string', () => {
      expect(validateWhisperInput({ target: 'Alice', message: '' })).toBe(false)
    })

    it('returns false for non-string target', () => {
      expect(validateWhisperInput({ target: 123, message: 'hello' })).toBe(false)
    })

    it('returns false for non-string message', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 456 })).toBe(false)
    })
  })

  describe('valid input', () => {
    it('returns true for valid input with target and message', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 'hello' })).toBe(true)
    })

    it('returns true with whitespace in message', () => {
      expect(validateWhisperInput({ target: 'Bob', message: '  hello world  ' })).toBe(true)
    })

    it('returns true with special characters in names and messages', () => {
      expect(validateWhisperInput({ target: 'Alice@123', message: 'Secret: $$$' })).toBe(true)
    })

    it('returns true ignoring extra fields', () => {
      expect(validateWhisperInput({ target: 'Alice', message: 'hi', extra: 'ignored' })).toBe(true)
    })
  })
})
