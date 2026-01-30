/**
 * Unit tests for lib/format-time.ts
 * Tests time formatting utilities for message timestamps
 */

import { formatMessageTime } from '@/lib/format-time';

describe('formatMessageTime', () => {
  // Helper to create date string from now with offset
  const createDate = (offsetMs: number): string => {
    const date = new Date(Date.now() + offsetMs);
    return date.toISOString();
  };

  beforeEach(() => {
    // Mock Date.now() to have consistent test results
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-22T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('recent messages (today)', () => {
    it('should show "just now" for messages less than 1 minute ago', () => {
      const dateString = createDate(-30 * 1000); // 30 seconds ago
      expect(formatMessageTime(dateString)).toBe('just now');
    });

    it('should show "just now" for messages from exactly now', () => {
      const dateString = new Date().toISOString();
      expect(formatMessageTime(dateString)).toBe('just now');
    });

    it('should show minutes for messages 1-59 minutes ago', () => {
      const dateString = createDate(-5 * 60 * 1000); // 5 minutes ago
      expect(formatMessageTime(dateString)).toBe('5m ago');
    });

    it('should show "1m ago" for exactly 1 minute', () => {
      const dateString = createDate(-60 * 1000); // 1 minute ago
      expect(formatMessageTime(dateString)).toBe('1m ago');
    });

    it('should show "59m ago" for 59 minutes', () => {
      const dateString = createDate(-59 * 60 * 1000); // 59 minutes ago
      expect(formatMessageTime(dateString)).toBe('59m ago');
    });

    it('should show hours for messages 1-23 hours ago', () => {
      const dateString = createDate(-3 * 60 * 60 * 1000); // 3 hours ago
      expect(formatMessageTime(dateString)).toBe('3h ago');
    });

    it('should show "1h ago" for exactly 1 hour', () => {
      const dateString = createDate(-60 * 60 * 1000); // 1 hour ago
      expect(formatMessageTime(dateString)).toBe('1h ago');
    });

    it('should show "23h ago" for 23 hours', () => {
      // 23 hours ago from noon crosses midnight, so shows date
      const dateString = createDate(-23 * 60 * 60 * 1000); // 23 hours ago
      const result = formatMessageTime(dateString);
      // May show date or hours depending on whether it crossed midnight
      expect(result).toMatch(/^(23h ago|Jan 21)$/);
    });

    it('should truncate fractional minutes', () => {
      const dateString = createDate(-90 * 1000); // 1.5 minutes ago
      expect(formatMessageTime(dateString)).toBe('1m ago');
    });

    it('should truncate fractional hours', () => {
      const dateString = createDate(-5.5 * 60 * 60 * 1000); // 5.5 hours ago
      expect(formatMessageTime(dateString)).toBe('5h ago');
    });
  });

  describe('older messages (not today)', () => {
    it('should show date for yesterday', () => {
      jest.setSystemTime(new Date('2026-01-22T12:00:00Z'));
      const yesterday = new Date('2026-01-21T12:00:00Z').toISOString();
      const result = formatMessageTime(yesterday);
      expect(result).toBe('Jan 21');
    });

    it('should show date for last week', () => {
      jest.setSystemTime(new Date('2026-01-22T12:00:00Z'));
      const lastWeek = new Date('2026-01-15T12:00:00Z').toISOString();
      const result = formatMessageTime(lastWeek);
      expect(result).toBe('Jan 15');
    });

    it('should show date without year for current year', () => {
      jest.setSystemTime(new Date('2026-06-15T12:00:00Z'));
      const earlier = new Date('2026-03-10T12:00:00Z').toISOString();
      const result = formatMessageTime(earlier);
      expect(result).toBe('Mar 10');
    });

    it('should include year for previous year', () => {
      jest.setSystemTime(new Date('2026-01-22T12:00:00Z'));
      const lastYear = new Date('2025-12-25T12:00:00Z').toISOString();
      const result = formatMessageTime(lastYear);
      expect(result).toBe('Dec 25, 2025');
    });

    it('should include year for much older messages', () => {
      jest.setSystemTime(new Date('2026-01-22T12:00:00Z'));
      const old = new Date('2023-05-10T12:00:00Z').toISOString();
      const result = formatMessageTime(old);
      expect(result).toBe('May 10, 2023');
    });
  });

  describe('edge cases', () => {
    it('should handle midnight boundary correctly', () => {
      // Test that crossing calendar day boundary shows date, not relative time
      // Use local timezone to ensure consistent behavior across environments
      const now = new Date('2026-01-22T00:05:00');
      jest.setSystemTime(now);
      // Create a date from yesterday (local time) - clearly a different calendar day
      const yesterday = new Date('2026-01-21T23:50:00');
      const result = formatMessageTime(yesterday.toISOString());
      // Different calendar day shows date format
      expect(result).toBe('Jan 21');
    });

    it('should handle messages from earlier today', () => {
      // Test that messages from earlier today show relative time
      const now = new Date('2026-01-22T12:00:00');
      jest.setSystemTime(now);
      // Midnight of the same calendar day (local time)
      const midnight = new Date('2026-01-22T00:00:00');
      const result = formatMessageTime(midnight.toISOString());
      // Same calendar day shows relative time
      expect(result).toBe('12h ago');
    });

    it('should handle invalid date strings gracefully', () => {
      const result = formatMessageTime('invalid-date');
      // Should not throw, but return some value
      expect(typeof result).toBe('string');
    });

    it('should handle future dates', () => {
      const future = createDate(60 * 60 * 1000); // 1 hour in future
      const result = formatMessageTime(future);
      // Should show "just now" for negative time differences
      expect(result).toBe('just now');
    });

    it('should handle leap year dates', () => {
      jest.setSystemTime(new Date('2024-03-01T12:00:00Z'));
      const leapDay = new Date('2024-02-29T12:00:00Z').toISOString();
      const result = formatMessageTime(leapDay);
      expect(result).toBe('Feb 29');
    });
  });
});
