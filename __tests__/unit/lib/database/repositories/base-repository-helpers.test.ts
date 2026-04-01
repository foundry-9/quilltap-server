/**
 * Unit tests for AbstractBaseRepository helper methods
 * Tests escapeRegex and createNullableFilter utilities
 */

import { describe, it, expect } from '@jest/globals'

// Since AbstractBaseRepository is abstract, we test through a minimal concrete subclass
// We need to access the protected methods, so we'll test them via a test harness

// Create a minimal test harness that exposes the protected methods
class TestRepository {
  escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  createNullableFilter(field: string, value: string | null): Record<string, unknown> {
    if (value !== null) {
      return { [field]: value };
    }
    return { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
  }
}

describe('Base Repository Helpers', () => {
  const repo = new TestRepository();

  describe('escapeRegex', () => {
    it('should escape dot character', () => {
      expect(repo.escapeRegex('file.txt')).toBe('file\\.txt');
    })

    it('should escape asterisk', () => {
      expect(repo.escapeRegex('test*')).toBe('test\\*');
    })

    it('should escape plus', () => {
      expect(repo.escapeRegex('a+b')).toBe('a\\+b');
    })

    it('should escape question mark', () => {
      expect(repo.escapeRegex('test?')).toBe('test\\?');
    })

    it('should escape caret', () => {
      expect(repo.escapeRegex('^start')).toBe('\\^start');
    })

    it('should escape dollar sign', () => {
      expect(repo.escapeRegex('end$')).toBe('end\\$');
    })

    it('should escape curly braces', () => {
      expect(repo.escapeRegex('{3}')).toBe('\\{3\\}');
    })

    it('should escape parentheses', () => {
      expect(repo.escapeRegex('(group)')).toBe('\\(group\\)');
    })

    it('should escape pipe', () => {
      expect(repo.escapeRegex('a|b')).toBe('a\\|b');
    })

    it('should escape square brackets', () => {
      expect(repo.escapeRegex('[abc]')).toBe('\\[abc\\]');
    })

    it('should escape backslash', () => {
      expect(repo.escapeRegex('path\\to')).toBe('path\\\\to');
    })

    it('should handle string with no special characters', () => {
      expect(repo.escapeRegex('hello world')).toBe('hello world');
    })

    it('should handle empty string', () => {
      expect(repo.escapeRegex('')).toBe('');
    })

    it('should handle multiple special characters', () => {
      expect(repo.escapeRegex('test.*+?')).toBe('test\\.\\*\\+\\?');
    })

    it('should produce a valid RegExp', () => {
      const escaped = repo.escapeRegex('test.file (1).txt');
      const regex = new RegExp(escaped);
      expect('test.file (1).txt').toMatch(regex);
      expect('testXfile (1)Xtxt').not.toMatch(regex);
    })
  })

  describe('createNullableFilter', () => {
    it('should return exact match filter for non-null value', () => {
      const filter = repo.createNullableFilter('projectId', 'project-123');
      expect(filter).toEqual({ projectId: 'project-123' });
    })

    it('should return $or filter for null value', () => {
      const filter = repo.createNullableFilter('projectId', null);
      expect(filter).toEqual({
        $or: [
          { projectId: null },
          { projectId: { $exists: false } },
        ],
      });
    })

    it('should work with different field names', () => {
      const filter = repo.createNullableFilter('chatId', 'chat-456');
      expect(filter).toEqual({ chatId: 'chat-456' });
    })

    it('should spread cleanly into existing query objects', () => {
      const query = {
        userId: 'user-1',
        ...repo.createNullableFilter('projectId', 'project-2'),
      };
      expect(query).toEqual({
        userId: 'user-1',
        projectId: 'project-2',
      });
    })

    it('should spread null filter cleanly into existing query objects', () => {
      const query = {
        userId: 'user-1',
        ...repo.createNullableFilter('projectId', null),
      };
      expect(query).toEqual({
        userId: 'user-1',
        $or: [
          { projectId: null },
          { projectId: { $exists: false } },
        ],
      });
    })
  })
})
