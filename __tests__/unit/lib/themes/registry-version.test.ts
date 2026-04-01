/**
 * Tests for lib/themes/registry-client.ts version functions
 */

import { parseVersion, isNewerVersion } from '@/lib/themes/registry-client'

describe('parseVersion', () => {
  describe('valid versions', () => {
    it('parses valid "1.2.3"', () => {
      expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it('strips v prefix from "v1.2.3"', () => {
      expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it('parses "0.0.0"', () => {
      expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 })
    })

    it('parses large numbers "10.20.30"', () => {
      expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 })
    })

    it('ignores pre-release suffix in "1.2.3-beta"', () => {
      expect(parseVersion('1.2.3-beta')).toEqual({ major: 1, minor: 2, patch: 3 })
    })

    it('only takes first 3 parts of "1.2.3.4"', () => {
      expect(parseVersion('1.2.3.4')).toEqual({ major: 1, minor: 2, patch: 3 })
    })
  })

  describe('invalid versions', () => {
    it('returns null for "abc"', () => {
      expect(parseVersion('abc')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseVersion('')).toBeNull()
    })

    it('returns null for "1.2" (only 2 parts)', () => {
      expect(parseVersion('1.2')).toBeNull()
    })

    it('returns null for "v" alone', () => {
      expect(parseVersion('v')).toBeNull()
    })

    it('returns null for non-numeric parts', () => {
      expect(parseVersion('a.b.c')).toBeNull()
    })
  })
})

describe('isNewerVersion', () => {
  describe('major version differences', () => {
    it('returns true for major bump "1.0.0" vs "2.0.0"', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
    })

    it('returns false for major downgrade "2.0.0" vs "1.0.0"', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('minor version differences', () => {
    it('returns true for minor bump "1.0.0" vs "1.1.0"', () => {
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true)
    })

    it('returns false for minor downgrade "1.1.0" vs "1.0.0"', () => {
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(false)
    })
  })

  describe('patch version differences', () => {
    it('returns true for patch bump "1.0.0" vs "1.0.1"', () => {
      expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true)
    })

    it('returns false for patch downgrade "1.0.1" vs "1.0.0"', () => {
      expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false)
    })
  })

  describe('same versions', () => {
    it('returns false for identical versions "1.2.3"', () => {
      expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    })

    it('returns false for "1.0.0" vs "1.0.0"', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('with v prefix', () => {
    it('handles v prefix in both versions', () => {
      expect(isNewerVersion('v1.0.0', 'v2.0.0')).toBe(true)
    })

    it('handles v prefix in first version', () => {
      expect(isNewerVersion('v1.0.0', '2.0.0')).toBe(true)
    })

    it('handles v prefix in second version', () => {
      expect(isNewerVersion('1.0.0', 'v2.0.0')).toBe(true)
    })
  })

  describe('invalid versions fallback', () => {
    it('returns true for invalid versionA and different versionB', () => {
      expect(isNewerVersion('abc', '1.0.0')).toBe(true)
    })

    it('returns false for invalid versionA and same versionB', () => {
      expect(isNewerVersion('abc', 'abc')).toBe(false)
    })

    it('returns true for both invalid but different strings', () => {
      expect(isNewerVersion('xyz', 'abc')).toBe(true)
    })

    it('returns true when versionA invalid and versionB valid', () => {
      expect(isNewerVersion('invalid', '1.2.3')).toBe(true)
    })
  })

  describe('complex versions', () => {
    it('handles "1.2.3-beta" vs "1.2.4"', () => {
      expect(isNewerVersion('1.2.3-beta', '1.2.4')).toBe(true)
    })

    it('handles "1.2.3" vs "1.2.3-beta"', () => {
      expect(isNewerVersion('1.2.3', '1.2.3-beta')).toBe(false)
    })
  })
})
