/**
 * Tests for lib/tools/help-navigate-tool.ts
 */

import { validateHelpNavigateInput } from '@/lib/tools/help-navigate-tool'

describe('validateHelpNavigateInput', () => {
  describe('invalid types', () => {
    it('returns false for null', () => {
      expect(validateHelpNavigateInput(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(validateHelpNavigateInput(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(validateHelpNavigateInput('/settings')).toBe(false)
    })

    it('returns false for number', () => {
      expect(validateHelpNavigateInput(42)).toBe(false)
    })

    it('returns false for array', () => {
      expect(validateHelpNavigateInput(['/settings'])).toBe(false)
    })
  })

  describe('missing or invalid url field', () => {
    it('returns false for empty object', () => {
      expect(validateHelpNavigateInput({})).toBe(false)
    })

    it('returns false for missing url', () => {
      expect(validateHelpNavigateInput({ path: '/settings' })).toBe(false)
    })

    it('returns false for empty url string', () => {
      expect(validateHelpNavigateInput({ url: '' })).toBe(false)
    })

    it('returns false for whitespace-only url', () => {
      expect(validateHelpNavigateInput({ url: '   ' })).toBe(false)
    })

    it('returns false for non-string url', () => {
      expect(validateHelpNavigateInput({ url: 123 })).toBe(false)
    })
  })

  describe('url format validation', () => {
    it('returns false for url not starting with /', () => {
      expect(validateHelpNavigateInput({ url: 'settings' })).toBe(false)
    })

    it('returns false for absolute URL (https://...)', () => {
      expect(validateHelpNavigateInput({ url: 'https://example.com/settings' })).toBe(false)
    })

    it('returns false for disallowed path like /admin', () => {
      expect(validateHelpNavigateInput({ url: '/admin' })).toBe(false)
    })

    it('returns false for disallowed path like /api/v1/something', () => {
      expect(validateHelpNavigateInput({ url: '/api/v1/something' })).toBe(false)
    })

    it('returns false for disallowed path like /chats', () => {
      expect(validateHelpNavigateInput({ url: '/chats' })).toBe(false)
    })
  })

  describe('allowed paths', () => {
    it('returns true for /settings', () => {
      expect(validateHelpNavigateInput({ url: '/settings' })).toBe(true)
    })

    it('returns true for /aurora', () => {
      expect(validateHelpNavigateInput({ url: '/aurora' })).toBe(true)
    })

    it('returns true for /salon', () => {
      expect(validateHelpNavigateInput({ url: '/salon' })).toBe(true)
    })

    it('returns true for /prospero', () => {
      expect(validateHelpNavigateInput({ url: '/prospero' })).toBe(true)
    })

    it('returns true for /profile', () => {
      expect(validateHelpNavigateInput({ url: '/profile' })).toBe(true)
    })

    it('returns true for /files', () => {
      expect(validateHelpNavigateInput({ url: '/files' })).toBe(true)
    })

    it('returns true for /setup', () => {
      expect(validateHelpNavigateInput({ url: '/setup' })).toBe(true)
    })

    it('returns true for /settings?tab=chat&section=dangerous-content', () => {
      expect(validateHelpNavigateInput({ url: '/settings?tab=chat&section=dangerous-content' })).toBe(true)
    })

    it('returns true for /aurora/:id (pattern with subpaths)', () => {
      expect(validateHelpNavigateInput({ url: '/aurora/character-id-here' })).toBe(true)
    })

    it('returns true for /salon subpaths', () => {
      expect(validateHelpNavigateInput({ url: '/salon/chat-123' })).toBe(true)
    })

    it('returns true for /prospero with query params', () => {
      expect(validateHelpNavigateInput({ url: '/prospero?tab=editor' })).toBe(true)
    })

    it('returns true for /settings with complex query string', () => {
      expect(validateHelpNavigateInput({ url: '/settings?tab=appearance&section=theme' })).toBe(true)
    })
  })

  describe('ignoring extra fields', () => {
    it('ignores extra fields and validates url only', () => {
      expect(validateHelpNavigateInput({ url: '/settings', extra: 'ignored', other: 123 })).toBe(true)
    })
  })
})
