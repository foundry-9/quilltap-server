/**
 * Unit tests for timestamp-utils.ts
 * Tests timestamp calculation, formatting, and injection logic
 */

import {
  calculateCurrentTimestamp,
  shouldInjectTimestamp,
  formatTimestampForSystemPrompt,
  initializeFictionalTime,
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
})
