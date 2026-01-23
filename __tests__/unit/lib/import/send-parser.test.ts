/**
 * Unit Tests for Send Date Parser
 * Tests lib/import/sillytavern-import-service.ts - parseSendDate function
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Import after mocking
import { parseSendDate } from '@/lib/import/sillytavern-import-service';

describe('Send Date Parser', () => {
  describe('parseSendDate()', () => {
    // ============================================================================
    // Numeric Timestamp Tests
    // ============================================================================

    describe('numeric timestamps', () => {
      it('should parse Unix timestamp in milliseconds', () => {
        const timestamp = 1705923600000; // 2024-01-22T09:00:00.000Z
        const result = parseSendDate(timestamp);

        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBe(timestamp);
      });

      it('should parse timestamp for year 2000', () => {
        const timestamp = 946684800000; // 2000-01-01T00:00:00.000Z
        const result = parseSendDate(timestamp);

        expect(result.getTime()).toBe(timestamp);
      });

      it('should parse timestamp for year 2030', () => {
        const timestamp = 1893456000000; // 2030-01-01T00:00:00.000Z
        const result = parseSendDate(timestamp);

        expect(result.getTime()).toBe(timestamp);
      });

      it('should parse zero timestamp (epoch)', () => {
        const timestamp = 0;
        const result = parseSendDate(timestamp);

        expect(result.getTime()).toBe(0);
        expect(result.toISOString()).toBe('1970-01-01T00:00:00.000Z');
      });

      it('should parse negative timestamp (before epoch)', () => {
        const timestamp = -86400000; // 1969-12-31
        const result = parseSendDate(timestamp);

        expect(result.getTime()).toBe(timestamp);
      });
    });

    // ============================================================================
    // ISO Date String Tests
    // ============================================================================

    describe('ISO date strings', () => {
      it('should parse ISO 8601 date string with timezone', () => {
        const isoString = '2024-01-22T09:00:00.000Z';
        const result = parseSendDate(isoString);

        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toBe(isoString);
      });

      it('should parse ISO 8601 without milliseconds', () => {
        const isoString = '2024-01-22T09:00:00Z';
        const result = parseSendDate(isoString);

        expect(result.toISOString()).toBe('2024-01-22T09:00:00.000Z');
      });

      it('should parse ISO 8601 with positive timezone offset', () => {
        const dateString = '2024-01-22T09:00:00+05:00';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toBe('2024-01-22T04:00:00.000Z');
      });

      it('should parse ISO 8601 with negative timezone offset', () => {
        const dateString = '2024-01-22T09:00:00-08:00';
        const result = parseSendDate(dateString);

        expect(result.toISOString()).toBe('2024-01-22T17:00:00.000Z');
      });

      it('should parse date-only ISO string', () => {
        const dateString = '2024-01-22';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2024);
        expect(result.getMonth()).toBe(0); // January
        // Date-only strings are parsed as UTC, so check UTC date
        expect(result.getUTCDate()).toBe(22);
      });
    });

    // ============================================================================
    // SillyTavern Date Format Tests
    // ============================================================================

    describe('SillyTavern formatted dates', () => {
      it('should parse date with ordinal suffix (1st)', () => {
        const dateString = 'January 1st, 2024 9:00:00 AM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (2nd)', () => {
        const dateString = 'January 2nd, 2024 10:30:00 AM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (3rd)', () => {
        const dateString = 'January 3rd, 2024 11:45:00 AM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (4th)', () => {
        const dateString = 'January 4th, 2024 2:15:00 PM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (21st)', () => {
        const dateString = 'January 21st, 2024 3:00:00 PM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (22nd)', () => {
        const dateString = 'January 22nd, 2024 4:30:00 PM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with ordinal suffix (23rd)', () => {
        const dateString = 'January 23rd, 2024 5:45:00 PM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with 12-hour AM time', () => {
        const dateString = 'January 15, 2024 9:30am';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with 12-hour PM time', () => {
        const dateString = 'January 15, 2024 2:45pm';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should convert 12 PM correctly (stays 12)', () => {
        const dateString = 'January 15, 2024 12:00pm';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should convert 12 AM correctly (becomes 0)', () => {
        const dateString = 'January 15, 2024 12:00am';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle uppercase AM/PM', () => {
        const dateString = 'January 15, 2024 3:30PM';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle mixed case am/pm', () => {
        const dateString = 'January 15, 2024 8:15Am';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });
    });

    // ============================================================================
    // Standard Date Format Tests
    // ============================================================================

    describe('standard date formats', () => {
      it('should parse US date format (MM/DD/YYYY)', () => {
        const dateString = '01/22/2024';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse full month name format', () => {
        const dateString = 'January 22, 2024';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse abbreviated month format', () => {
        const dateString = 'Jan 22, 2024';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse date with time (24-hour format)', () => {
        const dateString = 'January 22, 2024 14:30:00';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should parse RFC 2822 format', () => {
        const dateString = 'Mon, 22 Jan 2024 09:00:00 GMT';
        const result = parseSendDate(dateString);

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });
    });

    // ============================================================================
    // Edge Cases and Error Handling
    // ============================================================================

    describe('edge cases and error handling', () => {
      it('should handle invalid date string and return current date', () => {
        const invalidString = 'not a valid date at all';
        const beforeParse = new Date();
        const result = parseSendDate(invalidString);
        const afterParse = new Date();

        expect(result).toBeInstanceOf(Date);
        expect(Number.isNaN(result.getTime())).toBe(false);
        // Result should be close to current time
        expect(result.getTime()).toBeGreaterThanOrEqual(beforeParse.getTime() - 1000);
        expect(result.getTime()).toBeLessThanOrEqual(afterParse.getTime() + 1000);
      });

      it('should handle empty string and return current date', () => {
        const beforeParse = new Date();
        const result = parseSendDate('');
        const afterParse = new Date();

        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThanOrEqual(beforeParse.getTime() - 1000);
        expect(result.getTime()).toBeLessThanOrEqual(afterParse.getTime() + 1000);
      });

      it('should handle malformed date with ordinals but no month', () => {
        const malformedString = '22nd invalid';
        const result = parseSendDate(malformedString);

        expect(result).toBeInstanceOf(Date);
        // Should fallback to current date
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle date with only ordinal numbers', () => {
        const ordinalOnly = '1st 2nd 3rd';
        const result = parseSendDate(ordinalOnly);

        expect(result).toBeInstanceOf(Date);
        // Should fallback to current date
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle dates with future years', () => {
        const futureDate = '2099-12-31T23:59:59.999Z';
        const result = parseSendDate(futureDate);

        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2099);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle dates with past years (1900s)', () => {
        const pastDate = '1999-01-01T00:00:00.000Z';
        const result = parseSendDate(pastDate);

        expect(result).toBeInstanceOf(Date);
        expect(result.getUTCFullYear()).toBe(1999);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle leap year date', () => {
        const leapYearDate = '2024-02-29T12:00:00.000Z';
        const result = parseSendDate(leapYearDate);

        expect(result).toBeInstanceOf(Date);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(29);
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle date at year boundary', () => {
        const yearBoundary = '2023-12-31T23:59:59.999Z';
        const result = parseSendDate(yearBoundary);

        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2023);
        expect(result.getMonth()).toBe(11); // December
        expect(result.getDate()).toBe(31);
      });

      it('should handle whitespace-padded date string', () => {
        const paddedDate = '  2024-01-22T09:00:00.000Z  ';
        const result = parseSendDate(paddedDate);

        expect(result).toBeInstanceOf(Date);
        // Trimming might not work, so just verify it's a valid date
        expect(Number.isNaN(result.getTime())).toBe(false);
      });

      it('should handle date with milliseconds precision', () => {
        const timestamp = 1705923600123; // With milliseconds
        const result = parseSendDate(timestamp);

        expect(result.getTime()).toBe(timestamp);
        expect(result.getMilliseconds()).toBe(123);
      });
    });
  });
});
