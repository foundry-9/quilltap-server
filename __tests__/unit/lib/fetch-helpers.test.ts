/**
 * Unit tests for lib/fetch-helpers.ts
 * Tests HTTP utilities for safe JSON fetching and parsing
 */

import { safeJsonParse, fetchJson } from '@/lib/fetch-helpers';

// Mock fetch globally
global.fetch = jest.fn();

describe('safeJsonParse', () => {
  describe('valid JSON responses', () => {
    it('should parse valid JSON object', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('{"key":"value"}'),
      } as unknown as Response;

      const result = await safeJsonParse(mockResponse);
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse valid JSON array', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('[1,2,3]'),
      } as unknown as Response;

      const result = await safeJsonParse(mockResponse);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should parse JSON with nested objects', async () => {
      const json = JSON.stringify({ user: { name: 'Alice', age: 30 } });
      const mockResponse = {
        text: jest.fn().mockResolvedValue(json),
      } as unknown as Response;

      const result = await safeJsonParse(mockResponse);
      expect(result).toEqual({ user: { name: 'Alice', age: 30 } });
    });

    it('should parse JSON primitives', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('"string value"'),
      } as unknown as Response;

      const result = await safeJsonParse(mockResponse);
      expect(result).toBe('string value');
    });

    it('should parse JSON null', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('null'),
      } as unknown as Response;

      const result = await safeJsonParse(mockResponse);
      expect(result).toBeNull();
    });
  });

  describe('HTML error responses', () => {
    it('should throw specific error for DOCTYPE HTML', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('<!DOCTYPE html><html><body>Error</body></html>'),
        status: 500,
      } as unknown as Response;

      await expect(safeJsonParse(mockResponse)).rejects.toThrow(
        'Server error (500): Unexpected HTML response'
      );
    });

    it('should throw specific error for <html tag', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('<html><head><title>Error</title></head></html>'),
        status: 404,
      } as unknown as Response;

      await expect(safeJsonParse(mockResponse)).rejects.toThrow(
        'Server error (404): Unexpected HTML response'
      );
    });

    it('should handle HTML with whitespace', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('  <!DOCTYPE html><html>'),
        status: 503,
      } as unknown as Response;

      // Leading whitespace causes it to not match DOCTYPE check
      await expect(safeJsonParse(mockResponse)).rejects.toThrow(
        'Failed to parse response:'
      );
    });
  });

  describe('invalid JSON responses', () => {
    it('should throw error for malformed JSON', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue('{invalid json}'),
      } as unknown as Response;

      await expect(safeJsonParse(mockResponse)).rejects.toThrow(
        'Failed to parse response: {invalid json}'
      );
    });

    it('should truncate long error messages', async () => {
      const longText = 'x'.repeat(200);
      const mockResponse = {
        text: jest.fn().mockResolvedValue(longText),
      } as unknown as Response;

      await expect(safeJsonParse(mockResponse)).rejects.toThrow(/Failed to parse response:/);
      try {
        await safeJsonParse(mockResponse);
      } catch (error) {
        expect((error as Error).message.length).toBeLessThan(150);
      }
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      await expect(safeJsonParse(mockResponse)).rejects.toThrow('Failed to parse response:');
    });
  });
});

describe('fetchJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful requests', () => {
    it('should fetch and parse JSON successfully', async () => {
      const mockData = { message: 'success' };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockData)),
      });

      const result = await fetchJson('https://api.example.com/data');

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: mockData,
      });
      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', undefined);
    });

    it('should pass fetch options through', async () => {
      const mockData = { result: 'ok' };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockData)),
      });

      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test' }),
      };

      await fetchJson('https://api.example.com/post', options);

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/post', options);
    });

    it('should handle 201 Created responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 201,
        text: jest.fn().mockResolvedValue('{"id":"123"}'),
      });

      const result = await fetchJson('https://api.example.com/create');

      expect(result).toEqual({
        ok: true,
        status: 201,
        data: { id: '123' },
      });
    });

    it('should handle 204 No Content', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 204,
        text: jest.fn().mockResolvedValue('null'),
      });

      const result = await fetchJson('https://api.example.com/delete');

      expect(result).toEqual({
        ok: true,
        status: 204,
        data: null,
      });
    });
  });

  describe('error responses', () => {
    it('should handle 404 Not Found', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('{"error":"Not found"}'),
      });

      const result = await fetchJson('https://api.example.com/missing');

      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'Not found',
      });
    });

    it('should handle 500 Server Error with message', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('{"error":"Internal server error"}'),
      });

      const result = await fetchJson('https://api.example.com/crash');

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });
    });

    it('should use default error message if none provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('{}'),
      });

      const result = await fetchJson('https://api.example.com/bad');

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Request failed with status 400',
      });
    });

    it('should handle HTML error pages', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 502,
        text: jest.fn().mockResolvedValue('<!DOCTYPE html><html>Bad Gateway</html>'),
      });

      const result = await fetchJson('https://api.example.com/error');

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: 'Server error (502): Unexpected HTML response',
      });
    });
  });

  describe('network errors', () => {
    it('should handle network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await fetchJson('https://api.example.com/unreachable');

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: 'Network error',
      });
    });

    it('should handle timeout', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Request timeout'));

      const result = await fetchJson('https://api.example.com/slow');

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: 'Request timeout',
      });
    });

    it('should handle DNS resolution failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await fetchJson('https://nonexistent.domain.com');

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: 'getaddrinfo ENOTFOUND',
      });
    });

    it('should handle generic errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue('Unknown error');

      const result = await fetchJson('https://api.example.com/error');

      expect(result).toEqual({
        ok: false,
        status: 0,
        error: 'Network error',
      });
    });
  });

  describe('type safety', () => {
    it('should support generic type parameter', async () => {
      interface User {
        id: string;
        name: string;
      }

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"id":"1","name":"Alice"}'),
      });

      const result = await fetchJson<User>('https://api.example.com/user');

      expect(result.data).toEqual({ id: '1', name: 'Alice' });
      if (result.ok && result.data) {
        // TypeScript should know data is User type
        expect(result.data.id).toBe('1');
        expect(result.data.name).toBe('Alice');
      }
    });
  });
});
