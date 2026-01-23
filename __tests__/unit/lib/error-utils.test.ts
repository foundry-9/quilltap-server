/**
 * Unit tests for lib/error-utils.ts
 * Tests client-safe error handling utilities
 */

import { getErrorMessage } from '@/lib/error-utils';

describe('getErrorMessage', () => {
  describe('Error instances', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Something went wrong');
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('should extract message from custom Error subclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error occurred');
      expect(getErrorMessage(error)).toBe('Custom error occurred');
    });

    it('should handle Error with empty message', () => {
      const error = new Error('');
      expect(getErrorMessage(error)).toBe('');
    });

    it('should handle TypeError', () => {
      const error = new TypeError('Type mismatch');
      expect(getErrorMessage(error)).toBe('Type mismatch');
    });

    it('should handle RangeError', () => {
      const error = new RangeError('Value out of range');
      expect(getErrorMessage(error)).toBe('Value out of range');
    });
  });

  describe('string errors', () => {
    it('should return string error as-is', () => {
      expect(getErrorMessage('Simple error string')).toBe('Simple error string');
    });

    it('should handle empty string', () => {
      expect(getErrorMessage('')).toBe('');
    });

    it('should handle multiline strings', () => {
      const multiline = 'Line 1\nLine 2\nLine 3';
      expect(getErrorMessage(multiline)).toBe(multiline);
    });
  });

  describe('other types', () => {
    it('should convert number to string', () => {
      expect(getErrorMessage(404)).toBe('404');
    });

    it('should convert boolean to string', () => {
      expect(getErrorMessage(false)).toBe('false');
    });

    it('should handle array', () => {
      const error = ['error', 'array'];
      expect(getErrorMessage(error)).toBe('error,array');
    });

    it('should handle object with toString', () => {
      const error = { toString: () => 'Custom toString' };
      expect(getErrorMessage(error)).toBe('Custom toString');
    });

    it('should use fallback for plain object', () => {
      const error = { foo: 'bar' };
      expect(getErrorMessage(error)).toBe('Unknown error');
    });

    it('should use fallback for nested object', () => {
      const error = { nested: { key: 'value' } };
      expect(getErrorMessage(error)).toBe('Unknown error');
    });
  });

  describe('null and undefined', () => {
    it('should use fallback for null', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
    });

    it('should use fallback for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });
  });

  describe('custom fallback', () => {
    it('should use custom fallback for null', () => {
      expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    });

    it('should use custom fallback for undefined', () => {
      expect(getErrorMessage(undefined, 'No error provided')).toBe('No error provided');
    });

    it('should use custom fallback for plain object', () => {
      expect(getErrorMessage({ foo: 'bar' }, 'Invalid error')).toBe('Invalid error');
    });

    it('should not use custom fallback for valid Error', () => {
      const error = new Error('Real error');
      expect(getErrorMessage(error, 'Fallback')).toBe('Real error');
    });

    it('should not use custom fallback for string', () => {
      expect(getErrorMessage('String error', 'Fallback')).toBe('String error');
    });

    it('should not use custom fallback for empty string', () => {
      expect(getErrorMessage('', 'Fallback')).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle Symbol', () => {
      const sym = Symbol('test');
      const result = getErrorMessage(sym);
      expect(result).toBe('Symbol(test)');
    });

    it('should handle function', () => {
      const fn = function testFunc() {};
      const result = getErrorMessage(fn);
      expect(typeof result).toBe('string');
    });

    it('should handle BigInt', () => {
      const bigInt = BigInt(9007199254740991);
      expect(getErrorMessage(bigInt)).toBe('9007199254740991');
    });

    it('should handle Date object', () => {
      const date = new Date('2026-01-22T12:00:00Z');
      const result = getErrorMessage(date);
      expect(result).toContain('2026');
    });

    it('should handle RegExp', () => {
      const regex = /test/g;
      const result = getErrorMessage(regex);
      expect(result).toBe('/test/g');
    });
  });
});
