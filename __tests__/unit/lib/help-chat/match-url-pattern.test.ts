/**
 * Tests for lib/help-chat/context-resolver.ts matchUrlPattern function
 */

import { matchUrlPattern } from '@/lib/help-chat/context-resolver'

describe('matchUrlPattern', () => {
  describe('exact matches', () => {
    it('matches exact path "/settings" to "/settings"', () => {
      expect(matchUrlPattern('/settings', '/settings')).toBe(true)
    })

    it('matches exact path with multiple segments "/api/v1/chars"', () => {
      expect(matchUrlPattern('/api/v1/chars', '/api/v1/chars')).toBe(true)
    })

    it('matches root "/" to "/"', () => {
      expect(matchUrlPattern('/', '/')).toBe(true)
    })
  })

  describe('parameter matches', () => {
    it('matches "/aurora/:id" to "/aurora/abc123"', () => {
      expect(matchUrlPattern('/aurora/:id', '/aurora/abc123')).toBe(true)
    })

    it('matches "/api/:type/:id" to "/api/chars/abc"', () => {
      expect(matchUrlPattern('/api/:type/:id', '/api/chars/abc')).toBe(true)
    })

    it('matches param in middle "/api/:id/edit" to "/api/123/edit"', () => {
      expect(matchUrlPattern('/api/:id/edit', '/api/123/edit')).toBe(true)
    })

    it('matches multiple params throughout pattern', () => {
      expect(matchUrlPattern('/:a/:b/:c', '/x/y/z')).toBe(true)
    })
  })

  describe('static segment mismatches', () => {
    it('does not match different length "/a/b" vs "/a/b/c"', () => {
      expect(matchUrlPattern('/a/b', '/a/b/c')).toBe(false)
    })

    it('does not match different segment "/aurora" vs "/salon"', () => {
      expect(matchUrlPattern('/aurora', '/salon')).toBe(false)
    })

    it('does not match different static with pattern "/api/:id/edit" vs "/api/123/delete"', () => {
      expect(matchUrlPattern('/api/:id/edit', '/api/123/delete')).toBe(false)
    })

    it('does not match all static segments that differ', () => {
      expect(matchUrlPattern('/a/b/c', '/x/y/z')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('matches empty strings', () => {
      expect(matchUrlPattern('', '')).toBe(true)
    })

    it('does not match empty string vs non-empty', () => {
      expect(matchUrlPattern('', '/path')).toBe(false)
    })

    it('handles single segment with param', () => {
      expect(matchUrlPattern('/:id', '/123')).toBe(true)
    })

    it('does not match mismatched lengths "/a/:id" vs "/a/b/c"', () => {
      expect(matchUrlPattern('/a/:id', '/a/b/c')).toBe(false)
    })

    it('allows param to match any value including empty-like strings', () => {
      expect(matchUrlPattern('/path/:param', '/path/')).toBe(true)
    })
  })

  describe('complex patterns', () => {
    it('matches "/settings/:tab/details/:id" to "/settings/chat/details/123"', () => {
      expect(matchUrlPattern('/settings/:tab/details/:id', '/settings/chat/details/123')).toBe(true)
    })

    it('does not match if non-param segment differs in complex pattern', () => {
      expect(matchUrlPattern('/api/v1/:resource/edit', '/api/v2/users/edit')).toBe(false)
    })
  })
})
