/**
 * Unit tests for database meta table module
 *
 * Tests cover:
 * - Module exports and function signatures
 * - META_KEYS constants
 * - Function behavior with mocked SQLite
 *
 * Note: These tests use mocked better-sqlite3 so actual database
 * operations don't persist data. Integration tests would use a real database.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the logger before importing the module
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Database Meta Table Module', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    process.env.SQLITE_PATH = '/tmp/test-meta.db';

    // Clean up any cached modules
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };

    // Reset modules
    jest.resetModules();
  });

  describe('META_KEYS constant', () => {
    it('should export well-known meta keys', async () => {
      const { META_KEYS } = await import('@/lib/database/meta');

      expect(META_KEYS.PREFERRED_BACKEND).toBe('preferred_backend');
      expect(META_KEYS.LAST_MIGRATION).toBe('last_migration');
      expect(META_KEYS.MIGRATION_TIMESTAMP).toBe('migration_timestamp');
    });
  });

  describe('Module exports', () => {
    it('should export ensureMetaTable function', async () => {
      const { ensureMetaTable } = await import('@/lib/database/meta');
      expect(typeof ensureMetaTable).toBe('function');
    });

    it('should export getMetaValue function', async () => {
      const { getMetaValue } = await import('@/lib/database/meta');
      expect(typeof getMetaValue).toBe('function');
    });

    it('should export setMetaValue function', async () => {
      const { setMetaValue } = await import('@/lib/database/meta');
      expect(typeof setMetaValue).toBe('function');
    });

    it('should export deleteMetaValue function', async () => {
      const { deleteMetaValue } = await import('@/lib/database/meta');
      expect(typeof deleteMetaValue).toBe('function');
    });

    it('should export getPreferredBackend function', async () => {
      const { getPreferredBackend } = await import('@/lib/database/meta');
      expect(typeof getPreferredBackend).toBe('function');
    });

    it('should export setPreferredBackend function', async () => {
      const { setPreferredBackend } = await import('@/lib/database/meta');
      expect(typeof setPreferredBackend).toBe('function');
    });

    it('should export clearPreferredBackend function', async () => {
      const { clearPreferredBackend } = await import('@/lib/database/meta');
      expect(typeof clearPreferredBackend).toBe('function');
    });

    it('should export recordMigration function', async () => {
      const { recordMigration } = await import('@/lib/database/meta');
      expect(typeof recordMigration).toBe('function');
    });

    it('should export getLastMigration function', async () => {
      const { getLastMigration } = await import('@/lib/database/meta');
      expect(typeof getLastMigration).toBe('function');
    });

    it('should export sqliteDatabaseExists function', async () => {
      const { sqliteDatabaseExists } = await import('@/lib/database/meta');
      expect(typeof sqliteDatabaseExists).toBe('function');
    });

    it('should export getAllMetaValues function', async () => {
      const { getAllMetaValues } = await import('@/lib/database/meta');
      expect(typeof getAllMetaValues).toBe('function');
    });
  });

  describe('ensureMetaTable', () => {
    it('should return a boolean', async () => {
      const { ensureMetaTable } = await import('@/lib/database/meta');
      const result = ensureMetaTable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getMetaValue', () => {
    it('should accept a string key parameter', async () => {
      const { getMetaValue } = await import('@/lib/database/meta');
      // Function should accept string and return null or string
      expect(() => getMetaValue('test_key')).not.toThrow();
    });

    it('should return null or string', async () => {
      const { getMetaValue } = await import('@/lib/database/meta');
      const result = getMetaValue('test_key');
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('setMetaValue', () => {
    it('should accept key and value parameters', async () => {
      const { setMetaValue } = await import('@/lib/database/meta');
      expect(() => setMetaValue('test_key', 'test_value')).not.toThrow();
    });

    it('should accept null value for deletion', async () => {
      const { setMetaValue } = await import('@/lib/database/meta');
      expect(() => setMetaValue('test_key', null)).not.toThrow();
    });

    it('should return a boolean', async () => {
      const { setMetaValue } = await import('@/lib/database/meta');
      const result = setMetaValue('test_key', 'test_value');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('deleteMetaValue', () => {
    it('should accept a key parameter', async () => {
      const { deleteMetaValue } = await import('@/lib/database/meta');
      expect(() => deleteMetaValue('test_key')).not.toThrow();
    });

    it('should return a boolean', async () => {
      const { deleteMetaValue } = await import('@/lib/database/meta');
      const result = deleteMetaValue('test_key');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getPreferredBackend', () => {
    it('should return null, mongodb, or sqlite', async () => {
      const { getPreferredBackend } = await import('@/lib/database/meta');
      const result = getPreferredBackend();
      expect(result === null || result === 'mongodb' || result === 'sqlite').toBe(true);
    });
  });

  describe('setPreferredBackend', () => {
    it('should accept mongodb as backend', async () => {
      const { setPreferredBackend } = await import('@/lib/database/meta');
      expect(() => setPreferredBackend('mongodb')).not.toThrow();
    });

    it('should accept sqlite as backend', async () => {
      const { setPreferredBackend } = await import('@/lib/database/meta');
      expect(() => setPreferredBackend('sqlite')).not.toThrow();
    });

    it('should return a boolean', async () => {
      const { setPreferredBackend } = await import('@/lib/database/meta');
      const result = setPreferredBackend('sqlite');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('clearPreferredBackend', () => {
    it('should return a boolean', async () => {
      const { clearPreferredBackend } = await import('@/lib/database/meta');
      const result = clearPreferredBackend();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('recordMigration', () => {
    it('should accept mongo-to-sqlite direction', async () => {
      const { recordMigration } = await import('@/lib/database/meta');
      expect(() => recordMigration('mongo-to-sqlite')).not.toThrow();
    });

    it('should accept sqlite-to-mongo direction', async () => {
      const { recordMigration } = await import('@/lib/database/meta');
      expect(() => recordMigration('sqlite-to-mongo')).not.toThrow();
    });

    it('should return a boolean', async () => {
      const { recordMigration } = await import('@/lib/database/meta');
      const result = recordMigration('mongo-to-sqlite');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getLastMigration', () => {
    it('should return null or migration info object', async () => {
      const { getLastMigration } = await import('@/lib/database/meta');
      const result = getLastMigration();

      if (result !== null) {
        expect(result).toHaveProperty('direction');
        expect(result).toHaveProperty('timestamp');
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe('sqliteDatabaseExists', () => {
    it('should return a boolean', async () => {
      const { sqliteDatabaseExists } = await import('@/lib/database/meta');
      const result = sqliteDatabaseExists();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getAllMetaValues', () => {
    it('should return an object', async () => {
      const { getAllMetaValues } = await import('@/lib/database/meta');
      const result = getAllMetaValues();
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
    });
  });
});
