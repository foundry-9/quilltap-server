/**
 * Unit tests for timestamp-utils.ts
 * Tests timestamp calculation, formatting, and injection logic
 */

import {
  calculateCurrentTimestamp,
  shouldInjectTimestamp,
  formatTimestampForSystemPrompt,
  initializeFictionalTime,
  resolveTimezone,
} from '@/lib/chat/timestamp-utils'
import type { TimestampConfig } from '@/lib/schemas/types'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('timestamp-utils', () => {
  describe('calculateCurrentTimestamp', () => {
    it('should return current time in FRIENDLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.isFictional).toBe(false)
      expect(result.isoValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      // FRIENDLY format should contain "at" and AM/PM
      expect(result.formatted).toMatch(/at \d{1,2}:\d{2} [AP]M/)
    })

    it('should return current time in ISO8601 format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('should return date only in DATE_ONLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'DATE_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should contain month name and year, but not "at" or time
      expect(result.formatted).toMatch(/\w+ \d{1,2}, \d{4}/)
      expect(result.formatted).not.toContain('at')
      expect(result.formatted).not.toMatch(/\d{1,2}:\d{2}/)
    })

    it('should return time only in TIME_ONLY format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'TIME_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should contain time with AM/PM but no date
      expect(result.formatted).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
    })

    it('should use custom format when specified', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY-MM-DD',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should calculate fictional time with elapsed real time offset', () => {
      // Set up a fictional base time and a real base time
      const fictionalBase = '1776-07-04T16:30:00.000Z'
      const realBase = new Date(Date.now() - 120000).toISOString() // 2 minutes ago

      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: true,
        fictionalBaseTimestamp: fictionalBase,
        fictionalBaseRealTime: realBase,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      expect(result.isFictional).toBe(true)

      // The fictional time should be approximately 2 minutes after the fictional base
      const resultDate = new Date(result.isoValue)
      const expectedApprox = new Date('1776-07-04T16:32:00.000Z')

      // Allow for 10 second tolerance in test execution
      const diff = Math.abs(resultDate.getTime() - expectedApprox.getTime())
      expect(diff).toBeLessThan(10000)
    })

    it('should fallback to FRIENDLY when CUSTOM format has no customFormat', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: null,
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Should use FRIENDLY format as fallback
      expect(result.formatted).toMatch(/at \d{1,2}:\d{2} [AP]M/)
    })
  })

  describe('shouldInjectTimestamp', () => {
    it('should return false when mode is NONE', () => {
      const config: TimestampConfig = {
        mode: 'NONE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(false)
      expect(shouldInjectTimestamp(config, false)).toBe(false)
    })

    it('should return true only for initial message when mode is START_ONLY', () => {
      const config: TimestampConfig = {
        mode: 'START_ONLY',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(true)
      expect(shouldInjectTimestamp(config, false)).toBe(false)
    })

    it('should return true for all messages when mode is EVERY_MESSAGE', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      expect(shouldInjectTimestamp(config, true)).toBe(true)
      expect(shouldInjectTimestamp(config, false)).toBe(true)
    })

    it('should return false when config is null or undefined', () => {
      expect(shouldInjectTimestamp(null, true)).toBe(false)
      expect(shouldInjectTimestamp(undefined, false)).toBe(false)
    })
  })

  describe('formatTimestampForSystemPrompt', () => {
    it('should format with "Current time:" prefix when autoPrepend is true', () => {
      const timestamp = {
        formatted: 'March 15, 2024 at 2:30 PM',
        isoValue: '2024-03-15T14:30:00.000Z',
        isFictional: false,
      }

      const result = formatTimestampForSystemPrompt(timestamp, true)

      expect(result).toBe('Current time: March 15, 2024 at 2:30 PM')
    })

    it('should return just the formatted timestamp when autoPrepend is false', () => {
      const timestamp = {
        formatted: 'March 15, 2024 at 2:30 PM',
        isoValue: '2024-03-15T14:30:00.000Z',
        isFictional: false,
      }

      const result = formatTimestampForSystemPrompt(timestamp, false)

      expect(result).toBe('March 15, 2024 at 2:30 PM')
    })
  })

  describe('initializeFictionalTime', () => {
    it('should set up fictional time configuration', () => {
      const baseConfig: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const fictionalTimestamp = '1776-07-04T16:30:00.000Z'
      const before = Date.now()
      const result = initializeFictionalTime(baseConfig, fictionalTimestamp)
      const after = Date.now()

      expect(result.useFictionalTime).toBe(true)
      expect(result.fictionalBaseTimestamp).toBe(fictionalTimestamp)
      expect(result.fictionalBaseRealTime).toBeDefined()

      // The real time should be set to approximately now
      const realTime = new Date(result.fictionalBaseRealTime!).getTime()
      expect(realTime).toBeGreaterThanOrEqual(before)
      expect(realTime).toBeLessThanOrEqual(after)

      // Other config properties should be preserved
      expect(result.mode).toBe(baseConfig.mode)
      expect(result.format).toBe(baseConfig.format)
      expect(result.autoPrepend).toBe(baseConfig.autoPrepend)
    })
  })

  describe('custom format parsing', () => {
    it('should handle YYYY/MM/DD format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY/MM/DD',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
    })

    it('should handle 12-hour time format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'h:mm a',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{1,2}:\d{2} [ap]m$/)
    })

    it('should handle 24-hour time format', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'HH:mm:ss',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      expect(result.formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })

    it('should handle full month and day names', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'dddd, MMMM D, YYYY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)
      // Should contain a full day name, full month name, day number, and year
      expect(result.formatted).toMatch(/^\w+, \w+ \d{1,2}, \d{4}$/)
    })
  })

  describe('resolveTimezone', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
      delete process.env.QUILLTAP_TIMEZONE
    })

    afterAll(() => {
      process.env = originalEnv
    })

    it('should return per-chat timezone when set', () => {
      process.env.QUILLTAP_TIMEZONE = 'UTC'
      expect(resolveTimezone('America/New_York', 'Europe/London')).toBe('America/New_York')
    })

    it('should fall back to chatSettings timezone when per-chat is null', () => {
      process.env.QUILLTAP_TIMEZONE = 'UTC'
      expect(resolveTimezone(null, 'Europe/London')).toBe('Europe/London')
    })

    it('should fall back to QUILLTAP_TIMEZONE env var when both are null', () => {
      process.env.QUILLTAP_TIMEZONE = 'Asia/Tokyo'
      expect(resolveTimezone(null, null)).toBe('Asia/Tokyo')
    })

    it('should return undefined when all sources are empty', () => {
      expect(resolveTimezone(null, null)).toBeUndefined()
    })

    it('should skip empty strings', () => {
      expect(resolveTimezone('', '')).toBeUndefined()
    })
  })

  describe('timezone-aware formatting', () => {
    it('should format FRIENDLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'FRIENDLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      // Use a fixed date: 2026-02-22T12:00:00Z (noon UTC)
      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        // 12:00 UTC = 7:00 AM EST
        expect(resultNY.formatted).toContain('7:00 AM')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        // 12:00 UTC = 9:00 PM JST
        expect(resultTokyo.formatted).toContain('9:00 PM')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format ISO8601 with timezone offset', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        // Should contain an offset like -05:00
        expect(resultNY.formatted).toMatch(/2026-02-22T07:00:00-05:00/)
        // isoValue should also have offset
        expect(resultNY.isoValue).toMatch(/-05:00$/)

        const resultUTC = calculateCurrentTimestamp(config, 'UTC')
        expect(resultUTC.formatted).toMatch(/2026-02-22T12:00:00\+00:00/)
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format DATE_ONLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'DATE_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      // Use a time that crosses the date boundary:
      // 2026-02-22T23:30:00Z = Feb 22 in UTC, but Feb 23 in Tokyo (JST = UTC+9)
      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T23:30:00Z').getTime()

      try {
        const resultUTC = calculateCurrentTimestamp(config, 'UTC')
        expect(resultUTC.formatted).toContain('February 22')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toContain('February 23')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format TIME_ONLY with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'TIME_ONLY',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        expect(resultNY.formatted).toMatch(/7:00 AM/)

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toMatch(/9:00 PM/)
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should format CUSTOM with explicit timezone', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'CUSTOM',
        customFormat: 'YYYY-MM-DD HH:mm',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const originalDateNow = Date.now
      Date.now = () => new Date('2026-02-22T12:00:00Z').getTime()

      try {
        const resultNY = calculateCurrentTimestamp(config, 'America/New_York')
        expect(resultNY.formatted).toBe('2026-02-22 07:00')

        const resultTokyo = calculateCurrentTimestamp(config, 'Asia/Tokyo')
        expect(resultTokyo.formatted).toBe('2026-02-22 21:00')
      } finally {
        Date.now = originalDateNow
      }
    })

    it('should preserve existing behavior when no timezone is specified', () => {
      const config: TimestampConfig = {
        mode: 'EVERY_MESSAGE',
        format: 'ISO8601',
        useFictionalTime: false,
        autoPrepend: true,
      }

      const result = calculateCurrentTimestamp(config)

      // Without timezone, isoValue should end with Z (UTC)
      expect(result.isoValue).toMatch(/Z$/)
      // formatted should also be ISO format ending with Z
      expect(result.formatted).toMatch(/Z$/)
    })
  })
})
