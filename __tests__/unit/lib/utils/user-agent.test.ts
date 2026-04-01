/**
 * Tests for lib/utils/user-agent.ts
 */

import { scrubUserAgent } from '@/lib/utils/user-agent'

describe('scrubUserAgent', () => {
  describe('undefined and empty inputs', () => {
    it('returns undefined for undefined input', () => {
      expect(scrubUserAgent(undefined)).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(scrubUserAgent('')).toBeUndefined()
    })
  })

  describe('normal browser user agents', () => {
    it('passes through normal browser UA unchanged', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      expect(scrubUserAgent(ua)).toBe(ua)
    })

    it('preserves Chrome tokens while removing Electron', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/91.0.4472.124 Electron/13.0.0 Safari/537.36'
      expect(scrubUserAgent(ua)).toBe(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36'
      )
    })
  })

  describe('Quilltap token removal', () => {
    it('removes Quilltap/x.x.x token', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Quilltap/3.2.0 Chrome/91.0.4472.124 Safari/537.36'
      expect(scrubUserAgent(ua)).toBe(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36'
      )
    })

    it('removes Quilltap token with pre-release version like Quilltap/3.3.0-beta.1', () => {
      const ua = 'Mozilla/5.0 AppleWebKit/537.36 Quilltap/3.3.0-beta.1 Chrome/91.0.4472.124'
      expect(scrubUserAgent(ua)).toBe('Mozilla/5.0 AppleWebKit/537.36 Chrome/91.0.4472.124')
    })

    it('handles UA with only Quilltap token (no other tokens)', () => {
      const ua = 'Quilltap/3.3.0'
      expect(scrubUserAgent(ua)).toBe('')
    })
  })

  describe('Electron token removal', () => {
    it('removes Electron/x.x.x token', () => {
      const ua = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36'
      expect(scrubUserAgent(ua)).toBe(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      )
    })
  })

  describe('combined removals', () => {
    it('removes both Quilltap and Electron tokens', () => {
      const ua = 'Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) Quilltap/3.3.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36'
      expect(scrubUserAgent(ua)).toBe(
        'Mozilla/5.0 (...) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      )
    })

    it('collapses multiple spaces after removal', () => {
      const ua = 'Mozilla  Quilltap/3.2.0  Chrome  Electron/32.0.0  Safari'
      expect(scrubUserAgent(ua)).toBe('Mozilla Chrome Safari')
    })
  })
})
