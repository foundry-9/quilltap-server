/**
 * Unit tests for Character Constants
 * Tests the client-safe constants for character-related functionality.
 */

import { describe, it, expect } from '@jest/globals'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'

describe('Character Constants', () => {
  describe('USER_CONTROLLED_PROFILE_ID', () => {
    it('should be a string', () => {
      expect(typeof USER_CONTROLLED_PROFILE_ID).toBe('string')
    })

    it('should be the correct value', () => {
      expect(USER_CONTROLLED_PROFILE_ID).toBe('__user_controlled__')
    })

    it('should start and end with double underscores', () => {
      expect(USER_CONTROLLED_PROFILE_ID.startsWith('__')).toBe(true)
      expect(USER_CONTROLLED_PROFILE_ID.endsWith('__')).toBe(true)
    })

    it('should be distinct from valid UUIDs', () => {
      // This is important since UUIDs are used for real profile IDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      expect(uuidRegex.test(USER_CONTROLLED_PROFILE_ID)).toBe(false)
    })

    it('should be truthy for boolean checks', () => {
      // Ensures it can be used in conditionals
      expect(!!USER_CONTROLLED_PROFILE_ID).toBe(true)
    })
  })
})
