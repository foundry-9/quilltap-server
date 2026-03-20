/**
 * Tests for lib/tools/help-settings-tool.ts
 */

import { validateHelpSettingsInput } from '@/lib/tools/help-settings-tool'

describe('validateHelpSettingsInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateHelpSettingsInput(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(validateHelpSettingsInput(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(validateHelpSettingsInput('overview')).toBe(false)
    })

    it('returns false for number', () => {
      expect(validateHelpSettingsInput(123)).toBe(false)
    })

    it('returns false for array', () => {
      expect(validateHelpSettingsInput(['overview'])).toBe(false)
    })
  })

  describe('missing or invalid category field', () => {
    it('returns false for empty object', () => {
      expect(validateHelpSettingsInput({})).toBe(false)
    })

    it('returns false for missing category', () => {
      expect(validateHelpSettingsInput({ type: 'overview' })).toBe(false)
    })

    it('returns false for invalid category string', () => {
      expect(validateHelpSettingsInput({ category: 'invalid' })).toBe(false)
    })

    it('returns false for non-string category', () => {
      expect(validateHelpSettingsInput({ category: 123 })).toBe(false)
    })
  })

  describe('valid categories', () => {
    it('returns true for overview', () => {
      expect(validateHelpSettingsInput({ category: 'overview' })).toBe(true)
    })

    it('returns true for chat', () => {
      expect(validateHelpSettingsInput({ category: 'chat' })).toBe(true)
    })

    it('returns true for connections', () => {
      expect(validateHelpSettingsInput({ category: 'connections' })).toBe(true)
    })

    it('returns true for embeddings', () => {
      expect(validateHelpSettingsInput({ category: 'embeddings' })).toBe(true)
    })

    it('returns true for images', () => {
      expect(validateHelpSettingsInput({ category: 'images' })).toBe(true)
    })

    it('returns true for appearance', () => {
      expect(validateHelpSettingsInput({ category: 'appearance' })).toBe(true)
    })

    it('returns true for templates', () => {
      expect(validateHelpSettingsInput({ category: 'templates' })).toBe(true)
    })

    it('returns true for system', () => {
      expect(validateHelpSettingsInput({ category: 'system' })).toBe(true)
    })
  })

  describe('ignoring extra fields', () => {
    it('ignores extra fields and validates category only', () => {
      expect(validateHelpSettingsInput({ category: 'chat', extra: 'ignored', other: 123 })).toBe(true)
    })
  })
})
