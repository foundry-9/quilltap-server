/**
 * Unit Tests for SQLite Query Translator
 * Tests lib/database/backends/sqlite/query-translator.ts
 * v2.7-dev: Query Translation Utilities
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  translateFilter,
  translateSort,
  translatePagination,
  translateUpdate,
  buildSelectQuery,
  buildCountQuery,
  buildUpdateQuery,
  buildDeleteQuery,
  TranslatedQuery,
  TranslatedUpdate,
} from '@/lib/database/backends/sqlite/query-translator';
import { QueryFilter, QueryOptions, UpdateSpec } from '@/lib/database/interfaces';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('SQLite Query Translator', () => {
  // ============================================================================
  // translateFilter Tests
  // ============================================================================

  describe('translateFilter', () => {
    describe('Empty filters', () => {
      it('should return "1" for empty filter object', () => {
        const result = translateFilter({});
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });

      it('should return "1" for undefined filter', () => {
        const result = translateFilter(undefined as unknown as QueryFilter);
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });

      it('should return "1" for null filter', () => {
        const result = translateFilter(null as unknown as QueryFilter);
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });
    });

    describe('Simple equality filters', () => {
      it('should handle string equality', () => {
        const result = translateFilter({ name: 'test' });
        expect(result.sql).toBe('"name" = ?');
        expect(result.params).toEqual(['test']);
      });

      it('should handle number equality', () => {
        const result = translateFilter({ age: 25 });
        expect(result.sql).toBe('"age" = ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle boolean equality', () => {
        const result = translateFilter({ active: true });
        expect(result.sql).toBe('"active" = ?');
        expect(result.params).toEqual([true]);
      });

      it('should handle multiple field equality', () => {
        const result = translateFilter({ name: 'test', age: 25 });
        expect(result.sql).toContain('"name" = ?');
        expect(result.sql).toContain('"age" = ?');
        expect(result.sql).toContain(' AND ');
        expect(result.params).toEqual(['test', 25]);
      });
    });

    describe('Null values', () => {
      it('should handle null value filter', () => {
        const result = translateFilter({ name: null });
        expect(result.sql).toBe('"name" IS NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle undefined value filter', () => {
        const result = translateFilter({ name: undefined });
        expect(result.sql).toBe('"name" IS NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle null in multi-field filter', () => {
        const result = translateFilter({ name: null, age: 25 });
        expect(result.sql).toContain('"name" IS NULL');
        expect(result.sql).toContain('"age" = ?');
        expect(result.params).toEqual([25]);
      });
    });

    describe('Comparison operators', () => {
      it('should handle $eq operator', () => {
        const result = translateFilter({ age: { $eq: 25 } });
        expect(result.sql).toBe('"age" = ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle $ne operator', () => {
        const result = translateFilter({ age: { $ne: 25 } });
        expect(result.sql).toBe('"age" != ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle $gt operator', () => {
        const result = translateFilter({ age: { $gt: 25 } });
        expect(result.sql).toBe('"age" > ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle $gte operator', () => {
        const result = translateFilter({ age: { $gte: 25 } });
        expect(result.sql).toBe('"age" >= ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle $lt operator', () => {
        const result = translateFilter({ age: { $lt: 25 } });
        expect(result.sql).toBe('"age" < ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle $lte operator', () => {
        const result = translateFilter({ age: { $lte: 25 } });
        expect(result.sql).toBe('"age" <= ?');
        expect(result.params).toEqual([25]);
      });

      it('should handle multiple comparison operators on same field', () => {
        const result = translateFilter({ age: { $gte: 18, $lte: 65 } });
        expect(result.sql).toContain('"age" >= ?');
        expect(result.sql).toContain('"age" <= ?');
        expect(result.sql).toContain(' AND ');
        expect(result.params).toEqual([18, 65]);
      });
    });

    describe('Array operators', () => {
      it('should handle $in operator with values', () => {
        const result = translateFilter({ status: { $in: ['active', 'pending'] } });
        expect(result.sql).toBe('"status" IN (?, ?)');
        expect(result.params).toEqual(['active', 'pending']);
      });

      it('should handle $in operator with empty array', () => {
        const result = translateFilter({ status: { $in: [] } });
        expect(result.sql).toBe('0');
        expect(result.params).toEqual([]);
      });

      it('should handle $in operator with numbers', () => {
        const result = translateFilter({ id: { $in: [1, 2, 3] } });
        expect(result.sql).toBe('"id" IN (?, ?, ?)');
        expect(result.params).toEqual([1, 2, 3]);
      });

      it('should handle $nin operator with values', () => {
        const result = translateFilter({ status: { $nin: ['deleted', 'archived'] } });
        expect(result.sql).toBe('"status" NOT IN (?, ?)');
        expect(result.params).toEqual(['deleted', 'archived']);
      });

      it('should handle $nin operator with empty array', () => {
        const result = translateFilter({ status: { $nin: [] } });
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });

      it('should handle $in on JSON array column', () => {
        const jsonColumns = new Set(['tags']);
        const result = translateFilter({ tags: { $in: ['tag1', 'tag2'] } }, jsonColumns);
        expect(result.sql).toContain('EXISTS');
        expect(result.sql).toContain('json_each');
      });
    });

    describe('$exists operator', () => {
      it('should handle $exists: true', () => {
        const result = translateFilter({ email: { $exists: true } });
        expect(result.sql).toBe('"email" IS NOT NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle $exists: false', () => {
        const result = translateFilter({ email: { $exists: false } });
        expect(result.sql).toBe('"email" IS NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle $exists with other filters', () => {
        const result = translateFilter({ email: { $exists: true }, name: 'test' });
        expect(result.sql).toContain('"email" IS NOT NULL');
        expect(result.sql).toContain('"name" = ?');
      });
    });

    describe('$regex operator', () => {
      it('should convert basic regex pattern', () => {
        const result = translateFilter({ name: { $regex: '.*john' } });
        expect(result.sql).toBe('"name" LIKE ?');
        expect(result.params).toEqual(['%john']);
      });

      it('should convert dot to underscore', () => {
        const result = translateFilter({ email: { $regex: 'test.com' } });
        expect(result.sql).toBe('"email" LIKE ?');
        expect(result.params).toEqual(['test_com']);
      });

      it('should handle simple string pattern', () => {
        const result = translateFilter({ name: { $regex: 'test' } });
        expect(result.sql).toBe('"name" LIKE ?');
        expect(result.params).toEqual(['test']);
      });
    });

    describe('Logical operators - $and', () => {
      it('should handle $and with multiple conditions', () => {
        const filter: QueryFilter = {
          $and: [{ name: 'test' }, { age: 25 }],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('(');
        expect(result.sql).toContain(')');
        expect(result.sql).toContain('AND');
        expect(result.params).toEqual(['test', 25]);
      });

      it('should handle $and with complex conditions', () => {
        const filter: QueryFilter = {
          $and: [
            { age: { $gte: 18 } },
            { age: { $lte: 65 } },
            { status: 'active' },
          ],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('>= ?');
        expect(result.sql).toContain('<= ?');
        expect(result.sql).toContain('= ?');
        expect(result.params).toEqual([18, 65, 'active']);
      });

      it('should handle empty $and array', () => {
        const filter: QueryFilter = { $and: [] };
        const result = translateFilter(filter);
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });
    });

    describe('Logical operators - $or', () => {
      it('should handle $or with multiple conditions', () => {
        const filter: QueryFilter = {
          $or: [{ status: 'active' }, { status: 'pending' }],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('(');
        expect(result.sql).toContain(')');
        expect(result.sql).toContain('OR');
        expect(result.params).toEqual(['active', 'pending']);
      });

      it('should handle $or with complex conditions', () => {
        const filter: QueryFilter = {
          $or: [
            { age: { $lt: 18 } },
            { age: { $gt: 65 } },
          ],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('< ?');
        expect(result.sql).toContain('> ?');
        expect(result.sql).toContain('OR');
        expect(result.params).toEqual([18, 65]);
      });

      it('should handle empty $or array', () => {
        const filter: QueryFilter = { $or: [] };
        const result = translateFilter(filter);
        expect(result.sql).toBe('1');
        expect(result.params).toEqual([]);
      });
    });

    describe('Logical operators - $not', () => {
      it('should handle $not with simple condition', () => {
        const filter: QueryFilter = {
          $not: { status: 'deleted' },
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('NOT');
        expect(result.params).toEqual(['deleted']);
      });

      it('should handle $not with comparison operator', () => {
        const filter: QueryFilter = {
          $not: { age: { $gt: 65 } },
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('NOT');
        expect(result.params).toEqual([65]);
      });
    });

    describe('Nested field access with dot notation', () => {
      it('should handle simple nested field', () => {
        const jsonColumns = new Set(['profile']);
        const result = translateFilter({ 'profile.age': 25 }, jsonColumns);
        expect(result.sql).toContain('json_extract');
        expect(result.params).toEqual([25]);
      });

      it('should handle nested field with operator', () => {
        const jsonColumns = new Set(['profile']);
        const result = translateFilter({ 'profile.age': { $gte: 18 } }, jsonColumns);
        expect(result.sql).toContain('json_extract');
        expect(result.sql).toContain('>=');
        expect(result.params).toEqual([18]);
      });

      it('should handle deeply nested field', () => {
        const jsonColumns = new Set(['data']);
        const result = translateFilter({ 'data.address.city': 'New York' }, jsonColumns);
        expect(result.sql).toContain('json_extract');
        expect(result.sql).toContain('address.city');
        expect(result.params).toEqual(['New York']);
      });

      it('should handle non-JSON nested fields', () => {
        const result = translateFilter({ 'user.id': '123' });
        expect(result.sql).toBe('"user.id" = ?');
        expect(result.params).toEqual(['123']);
      });
    });

    describe('Array field querying', () => {
      it('should handle array value equality', () => {
        const result = translateFilter({ tags: ['tag1'] });
        expect(result.sql).toContain('EXISTS');
        expect(result.sql).toContain('json_each');
      });

      it('should handle multiple array values', () => {
        const result = translateFilter({ tags: ['tag1', 'tag2'] });
        expect(result.sql).toContain('EXISTS');
        expect(result.sql).toContain('AND');
      });
    });

    describe('Combined complex filters', () => {
      it('should handle AND with OR', () => {
        const filter: QueryFilter = {
          status: 'active',
          $or: [
            { priority: 'high' },
            { priority: 'urgent' },
          ],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('OR');
      });

      it('should handle nested logical operators', () => {
        const filter: QueryFilter = {
          $and: [
            { status: 'active' },
            {
              $or: [
                { priority: 'high' },
                { priority: 'urgent' },
              ],
            },
          ],
        };
        const result = translateFilter(filter);
        expect(result.sql).toContain('AND');
        expect(result.sql).toContain('OR');
      });
    });
  });

  // ============================================================================
  // translateSort Tests
  // ============================================================================

  describe('translateSort', () => {
    it('should return empty string for empty sort', () => {
      const result = translateSort({});
      expect(result).toBe('');
    });

    it('should return empty string for undefined sort', () => {
      const result = translateSort(undefined);
      expect(result).toBe('');
    });

    it('should handle single field ascending with 1', () => {
      const result = translateSort({ name: 1 });
      expect(result).toBe('ORDER BY "name" ASC');
    });

    it('should handle single field ascending with "asc"', () => {
      const result = translateSort({ name: 'asc' });
      expect(result).toBe('ORDER BY "name" ASC');
    });

    it('should handle single field descending with -1', () => {
      const result = translateSort({ name: -1 });
      expect(result).toBe('ORDER BY "name" DESC');
    });

    it('should handle single field descending with "desc"', () => {
      const result = translateSort({ name: 'desc' });
      expect(result).toBe('ORDER BY "name" DESC');
    });

    it('should handle multiple fields', () => {
      const result = translateSort({ status: 1, createdAt: -1 });
      expect(result).toContain('ORDER BY');
      expect(result).toContain('"status" ASC');
      expect(result).toContain('"createdAt" DESC');
      expect(result).toContain(',');
    });

    it('should handle multiple fields with mixed directions', () => {
      const result = translateSort({
        priority: 1,
        createdAt: -1,
        name: 'asc',
        updatedAt: 'desc',
      });
      expect(result).toContain('ORDER BY');
      expect(result).toContain('ASC');
      expect(result).toContain('DESC');
    });
  });

  // ============================================================================
  // translatePagination Tests
  // ============================================================================

  describe('translatePagination', () => {
    it('should return empty string for no options', () => {
      const result = translatePagination();
      expect(result).toBe('');
    });

    it('should return empty string for empty options', () => {
      const result = translatePagination({});
      expect(result).toBe('');
    });

    it('should handle limit only', () => {
      const result = translatePagination({ limit: 10 });
      expect(result).toBe('LIMIT 10');
    });

    it('should ignore limit of 0', () => {
      const result = translatePagination({ limit: 0 });
      expect(result).toBe('');
    });

    it('should ignore negative limit', () => {
      const result = translatePagination({ limit: -10 });
      expect(result).toBe('');
    });

    it('should handle skip only', () => {
      const result = translatePagination({ skip: 20 });
      expect(result).toBe('OFFSET 20');
    });

    it('should ignore skip of 0', () => {
      const result = translatePagination({ skip: 0 });
      expect(result).toBe('');
    });

    it('should ignore negative skip', () => {
      const result = translatePagination({ skip: -20 });
      expect(result).toBe('');
    });

    it('should handle both limit and skip', () => {
      const result = translatePagination({ limit: 10, skip: 20 });
      expect(result).toBe('LIMIT 10 OFFSET 20');
    });

    it('should handle large values', () => {
      const result = translatePagination({ limit: 1000000, skip: 5000000 });
      expect(result).toBe('LIMIT 1000000 OFFSET 5000000');
    });
  });

  // ============================================================================
  // translateUpdate Tests
  // ============================================================================

  describe('translateUpdate', () => {
    describe('Plain object updates', () => {
      it('should set all fields', () => {
        const update: UpdateSpec = { name: 'new name', age: 30 };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.setClauses).toContain('"name" = ?');
        expect(result.setClauses).toContain('"age" = ?');
        expect(result.params).toEqual(['new name', 30]);
      });

      it('should skip id field', () => {
        const update: UpdateSpec = { id: 'new-id', name: 'test' };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(1);
        expect(result.setClauses).toContain('"name" = ?');
        expect(result.params).toEqual(['test']);
      });

      it('should skip createdAt field', () => {
        const update: UpdateSpec = { createdAt: '2026-01-01', name: 'test' };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(1);
        expect(result.setClauses).toContain('"name" = ?');
        expect(result.params).toEqual(['test']);
      });

      it('should handle boolean fields', () => {
        const update: UpdateSpec = { active: true, archived: false };
        const result = translateUpdate(update);
        expect(result.params).toEqual([1, 0]);
      });

      it('should handle array fields as JSON', () => {
        const update: UpdateSpec = { tags: ['tag1', 'tag2'] };
        const result = translateUpdate(update);
        expect(result.setClauses).toContain('"tags" = ?');
        expect(typeof result.params[0]).toBe('string');
      });

      it('should handle object fields as JSON', () => {
        const update: UpdateSpec = { metadata: { key: 'value' } };
        const result = translateUpdate(update);
        expect(result.setClauses).toContain('"metadata" = ?');
        expect(typeof result.params[0]).toBe('string');
      });
    });

    describe('$set operator', () => {
      it('should set specified fields', () => {
        const update: UpdateSpec = { $set: { name: 'new name', age: 30 } };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.params).toEqual(['new name', 30]);
      });

      it('should handle $set with JSON columns', () => {
        const jsonColumns = new Set(['metadata']);
        const update: UpdateSpec = { $set: { metadata: { key: 'value' } } };
        const result = translateUpdate(update, jsonColumns);
        expect(result.setClauses).toContain('"metadata" = ?');
        expect(typeof result.params[0]).toBe('string');
      });
    });

    describe('$unset operator', () => {
      it('should unset specified fields', () => {
        const update: UpdateSpec = { $unset: { email: true, phone: 1 } };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.setClauses).toContain('"email" = NULL');
        expect(result.setClauses).toContain('"phone" = NULL');
        expect(result.params).toEqual([]);
      });

      it('should handle $unset with $set together', () => {
        const update: UpdateSpec = {
          $set: { name: 'test' },
          $unset: { email: true },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.setClauses).toContain('"name" = ?');
        expect(result.setClauses).toContain('"email" = NULL');
      });
    });

    describe('$inc operator', () => {
      it('should increment numeric fields', () => {
        const update: UpdateSpec = { $inc: { count: 1, score: 10 } };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.setClauses[0]).toContain('"count" = "count" + ?');
        expect(result.setClauses[1]).toContain('"score" = "score" + ?');
        expect(result.params).toEqual([1, 10]);
      });

      it('should handle negative increment', () => {
        const update: UpdateSpec = { $inc: { count: -5 } };
        const result = translateUpdate(update);
        expect(result.params).toEqual([-5]);
      });
    });

    describe('$push operator', () => {
      it('should append to array', () => {
        const update: UpdateSpec = { $push: { tags: 'new-tag' } };
        const result = translateUpdate(update);
        expect(result.setClauses[0]).toContain('CASE');
        expect(result.setClauses[0]).toContain('json_array');
        expect(result.setClauses[0]).toContain('json_insert');
        expect(result.params).toHaveLength(2);
      });

      it('should push object to array', () => {
        const update: UpdateSpec = { $push: { items: { id: '123', name: 'test' } } };
        const result = translateUpdate(update);
        expect(result.setClauses[0]).toContain('CASE');
        expect(result.params).toHaveLength(2);
      });

      it('should handle multiple $push operations', () => {
        const update: UpdateSpec = {
          $push: { tags: 'tag1', items: 'item1' },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
      });
    });

    describe('$pull operator', () => {
      it('should remove from array', () => {
        const update: UpdateSpec = { $pull: { tags: 'tag1' } };
        const result = translateUpdate(update);
        expect(result.setClauses[0]).toContain('json_group_array');
        expect(result.setClauses[0]).toContain('json_each');
        expect(result.params).toEqual(['tag1']);
      });

      it('should pull object from array', () => {
        const update: UpdateSpec = { $pull: { items: { id: '123' } } };
        const result = translateUpdate(update);
        expect(result.setClauses[0]).toContain('json_group_array');
        expect(typeof result.params[0]).toBe('string');
      });
    });

    describe('$addToSet operator', () => {
      it('should add unique value to array', () => {
        const update: UpdateSpec = { $addToSet: { tags: 'unique-tag' } };
        const result = translateUpdate(update);
        expect(result.setClauses[0]).toContain('CASE');
        expect(result.setClauses[0]).toContain('EXISTS');
        expect(result.params).toHaveLength(3);
      });

      it('should handle multiple $addToSet operations', () => {
        const update: UpdateSpec = {
          $addToSet: { tags: 'tag1', categories: 'cat1' },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
      });
    });

    describe('Complex update combinations', () => {
      it('should handle $set and $inc together', () => {
        const update: UpdateSpec = {
          $set: { name: 'test' },
          $inc: { count: 1 },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(2);
        expect(result.params).toEqual(['test', 1]);
      });

      it('should handle $set, $inc, $unset together', () => {
        const update: UpdateSpec = {
          $set: { name: 'test' },
          $inc: { count: 1 },
          $unset: { email: true },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(3);
      });

      it('should handle all array operators together', () => {
        const update: UpdateSpec = {
          $push: { tags: 'new' },
          $pull: { tags: 'old' },
          $addToSet: { categories: 'cat1' },
        };
        const result = translateUpdate(update);
        expect(result.setClauses).toHaveLength(3);
      });
    });
  });

  // ============================================================================
  // Full Query Building Tests
  // ============================================================================

  describe('buildSelectQuery', () => {
    it('should build basic SELECT query', () => {
      const result = buildSelectQuery('users', { name: 'test' });
      expect(result.sql).toContain('SELECT * FROM "users"');
      expect(result.sql).toContain('WHERE "name" = ?');
      expect(result.params).toEqual(['test']);
    });

    it('should include ORDER BY when sort is provided', () => {
      const result = buildSelectQuery(
        'users',
        { status: 'active' },
        { sort: { createdAt: -1 } }
      );
      expect(result.sql).toContain('ORDER BY "createdAt" DESC');
    });

    it('should include LIMIT and OFFSET when pagination is provided', () => {
      const result = buildSelectQuery(
        'users',
        { status: 'active' },
        { limit: 10, skip: 20 }
      );
      expect(result.sql).toContain('LIMIT 10');
      expect(result.sql).toContain('OFFSET 20');
    });

    it('should combine all clauses', () => {
      const result = buildSelectQuery(
        'users',
        { status: 'active' },
        { sort: { createdAt: -1 }, limit: 10, skip: 20 }
      );
      expect(result.sql).toContain('SELECT * FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
      expect(result.sql).toContain('OFFSET');
    });

    it('should handle complex filter with SELECT', () => {
      const result = buildSelectQuery(
        'users',
        {
          $and: [
            { status: 'active' },
            { age: { $gte: 18 } },
          ],
        },
        { sort: { name: 1 } }
      );
      expect(result.sql).toContain('SELECT * FROM "users"');
      expect(result.sql).toContain('AND');
      expect(result.params).toEqual(['active', 18]);
    });
  });

  describe('buildCountQuery', () => {
    it('should build COUNT query', () => {
      const result = buildCountQuery('users', { status: 'active' });
      expect(result.sql).toContain('SELECT COUNT(*) as count FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.params).toEqual(['active']);
    });

    it('should handle empty filter', () => {
      const result = buildCountQuery('users', {});
      expect(result.sql).toContain('SELECT COUNT(*) as count FROM "users"');
      expect(result.sql).toContain('WHERE 1');
    });

    it('should handle complex filter', () => {
      const result = buildCountQuery('users', {
        $or: [{ status: 'active' }, { status: 'pending' }],
      });
      expect(result.sql).toContain('SELECT COUNT(*) as count');
      expect(result.sql).toContain('OR');
      expect(result.params).toEqual(['active', 'pending']);
    });

    it('should not include pagination in COUNT', () => {
      const result = buildCountQuery('users', { status: 'active' });
      expect(result.sql).not.toContain('LIMIT');
      expect(result.sql).not.toContain('OFFSET');
    });
  });

  describe('buildUpdateQuery', () => {
    it('should build UPDATE query', () => {
      const result = buildUpdateQuery(
        'users',
        { id: '123' },
        { $set: { name: 'updated', status: 'inactive' } }
      );
      expect(result.sql).toContain('UPDATE "users"');
      expect(result.sql).toContain('SET');
      expect(result.sql).toContain('WHERE');
      expect(result.params).toEqual(['updated', 'inactive', '123']);
    });

    it('should handle plain object update', () => {
      const result = buildUpdateQuery(
        'users',
        { id: '123' },
        { name: 'updated' }
      );
      expect(result.sql).toContain('UPDATE "users"');
      expect(result.sql).toContain('SET');
      expect(result.params).toEqual(['updated', '123']);
    });

    it('should handle complex filter', () => {
      const result = buildUpdateQuery(
        'users',
        { status: 'active', age: { $gte: 18 } },
        { $set: { verified: true } }
      );
      expect(result.sql).toContain('UPDATE "users"');
      expect(result.sql).toContain('>=');
      // Booleans are converted to 1/0 for SQLite
      expect(result.params).toContain(1);
      expect(result.params).toContain(18);
    });

    it('should throw error if no fields to update', () => {
      expect(() => {
        buildUpdateQuery(
          'users',
          { id: '123' },
          { id: 'new-id' } // id is skipped
        );
      }).toThrow('Update must specify at least one field to update');
    });

    it('should handle $inc operator in UPDATE', () => {
      const result = buildUpdateQuery(
        'users',
        { id: '123' },
        { $inc: { loginCount: 1 } }
      );
      expect(result.sql).toContain('UPDATE "users"');
      expect(result.sql).toContain('loginCount');
      expect(result.params).toContain(1);
    });
  });

  describe('buildDeleteQuery', () => {
    it('should build DELETE query', () => {
      const result = buildDeleteQuery('users', { id: '123' });
      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('WHERE');
      expect(result.params).toEqual(['123']);
    });

    it('should handle empty filter', () => {
      const result = buildDeleteQuery('users', {});
      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('WHERE 1');
      expect(result.params).toEqual([]);
    });

    it('should handle complex filter', () => {
      const result = buildDeleteQuery('users', {
        status: 'deleted',
        createdAt: { $lt: '2025-01-01' },
      });
      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('AND');
      expect(result.params).toEqual(['deleted', '2025-01-01']);
    });

    it('should handle $or filter', () => {
      const result = buildDeleteQuery('users', {
        $or: [
          { status: 'deleted' },
          { banned: true },
        ],
      });
      expect(result.sql).toContain('DELETE FROM "users"');
      expect(result.sql).toContain('OR');
      expect(result.params).toContain('deleted');
      expect(result.params).toContain(true);
    });
  });

  // ============================================================================
  // Edge Cases and Integration Tests
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle special characters in field names', () => {
      const result = translateFilter({ 'user-name': 'test' });
      expect(result.sql).toBe('"user-name" = ?');
      expect(result.params).toEqual(['test']);
    });

    it('should handle special characters in string values', () => {
      const result = translateFilter({ name: "O'Brien" });
      expect(result.sql).toBe('"name" = ?');
      expect(result.params).toEqual(["O'Brien"]);
    });

    it('should handle very large arrays in $in', () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => i);
      const result = translateFilter({ id: { $in: largeArray } });
      expect(result.sql).toContain('IN');
      expect(result.params).toHaveLength(100);
    });

    it('should handle deeply nested logical operators', () => {
      const filter: QueryFilter = {
        $and: [
          {
            $or: [
              { status: 'active' },
              { status: 'pending' },
            ],
          },
          {
            $or: [
              { priority: 'high' },
              { priority: 'urgent' },
            ],
          },
        ],
      };
      const result = translateFilter(filter);
      expect(result.sql).toContain('AND');
      expect(result.sql).toContain('OR');
      expect(result.params).toHaveLength(4);
    });

    it('should handle numeric zero values', () => {
      const result = translateFilter({ count: 0 });
      expect(result.sql).toBe('"count" = ?');
      expect(result.params).toEqual([0]);
    });

    it('should handle empty string values', () => {
      const result = translateFilter({ name: '' });
      expect(result.sql).toBe('"name" = ?');
      expect(result.params).toEqual(['']);
    });

    it('should handle false boolean values', () => {
      const result = translateFilter({ active: false });
      expect(result.sql).toBe('"active" = ?');
      expect(result.params).toEqual([false]);
    });
  });

  describe('Query structure validation', () => {
    it('should maintain correct parameter order', () => {
      const result = translateFilter({
        status: 'active',
        age: { $gte: 18 },
        name: 'test',
      });
      expect(result.params).toContain('active');
      expect(result.params).toContain(18);
      expect(result.params).toContain('test');
    });

    it('should quote table names in full queries', () => {
      const result = buildSelectQuery('user-profiles', {});
      expect(result.sql).toContain('FROM "user-profiles"');
    });

    it('should properly escape field names with quotes', () => {
      const result = translateFilter({ 'first-name': 'John' });
      expect(result.sql).toContain('"first-name"');
    });
  });
});
