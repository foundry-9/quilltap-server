/**
 * Unit tests for database configuration module
 *
 * Tests cover:
 * - Backend detection logic
 * - SQLite configuration loading
 * - Environment variable parsing
 * - Configuration caching
 * - Validation helpers
 * - Feature capability checks
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';

// Mock the logger before importing the module
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Database Configuration Module', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clean up any cached config by resetting modules
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });

    // Reset modules to clear cache
    jest.resetModules();
  });

  describe('detectBackend', () => {
    it('should return "sqlite" when DATABASE_BACKEND=sqlite', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { detectBackend } = await import('@/lib/database/config');
      expect(detectBackend()).toBe('sqlite');
    });

    it('should be case-insensitive for DATABASE_BACKEND', async () => {
      process.env.DATABASE_BACKEND = 'SQLITE';

      const { detectBackend } = await import('@/lib/database/config');
      expect(detectBackend()).toBe('sqlite');
    });

    it('should return "sqlite" as default when no env vars set', async () => {
      delete process.env.DATABASE_BACKEND;

      const { detectBackend } = await import('@/lib/database/config');
      expect(detectBackend()).toBe('sqlite');
    });

    it('should handle invalid DATABASE_BACKEND values as default to sqlite', async () => {
      process.env.DATABASE_BACKEND = 'invalid';

      const { detectBackend } = await import('@/lib/database/config');
      expect(detectBackend()).toBe('sqlite');
    });
  });

  describe('loadSQLiteConfig', () => {
    it('should use SQLITE_PATH if provided', async () => {
      process.env.SQLITE_PATH = '/tmp/db.sqlite';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.path).toBe('/tmp/db.sqlite');
    });

    it('should fall back to default path when SQLITE_PATH not provided', async () => {
      delete process.env.SQLITE_PATH;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      // Platform-specific paths: Linux uses .quilltap, macOS uses Library/Application Support/Quilltap
      expect(config.path.toLowerCase()).toContain('quilltap');
      expect(config.path).toContain('quilltap.db');
    });

    it('should parse SQLITE_WAL_MODE as true by default', async () => {
      delete process.env.SQLITE_WAL_MODE;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.walMode).toBe(true);
    });

    it('should parse SQLITE_WAL_MODE=false', async () => {
      process.env.SQLITE_WAL_MODE = 'false';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.walMode).toBe(false);
    });

    it('should parse SQLITE_BUSY_TIMEOUT as integer', async () => {
      process.env.SQLITE_BUSY_TIMEOUT = '10000';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.busyTimeout).toBe(10000);
    });

    it('should use default SQLITE_BUSY_TIMEOUT if not provided', async () => {
      delete process.env.SQLITE_BUSY_TIMEOUT;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.busyTimeout).toBe(5000);
    });

    it('should parse SQLITE_FOREIGN_KEYS as true by default', async () => {
      delete process.env.SQLITE_FOREIGN_KEYS;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.foreignKeys).toBe(true);
    });

    it('should parse SQLITE_FOREIGN_KEYS=false', async () => {
      process.env.SQLITE_FOREIGN_KEYS = 'false';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.foreignKeys).toBe(false);
    });

    it('should parse SQLITE_SYNCHRONOUS', async () => {
      process.env.SQLITE_SYNCHRONOUS = 'full';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.synchronous).toBe('full');
    });

    it('should use default SQLITE_SYNCHRONOUS if not provided', async () => {
      delete process.env.SQLITE_SYNCHRONOUS;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.synchronous).toBe('normal');
    });

    it('should parse SQLITE_CACHE_SIZE as integer', async () => {
      process.env.SQLITE_CACHE_SIZE = '-131072';

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.cacheSize).toBe(-131072);
    });

    it('should use default SQLITE_CACHE_SIZE if not provided', async () => {
      delete process.env.SQLITE_CACHE_SIZE;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      expect(config.cacheSize).toBe(-64000);
    });

    it('should have valid journal mode enum value', async () => {
      delete process.env.SQLITE_SYNCHRONOUS;

      const { loadSQLiteConfig } = await import('@/lib/database/config');
      const config = loadSQLiteConfig();

      const validModes = ['delete', 'truncate', 'persist', 'memory', 'off'];
      expect(validModes).toContain(config.journalMode);
    });
  });


  describe('getDatabaseConfig / resetDatabaseConfig / setDatabaseConfig', () => {
    it('should cache config on first call', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { getDatabaseConfig, resetDatabaseConfig } = await import('@/lib/database/config');

      const config1 = getDatabaseConfig();
      const config2 = getDatabaseConfig();

      expect(config1).toBe(config2);

      resetDatabaseConfig();
    });

    it('should return cached config on subsequent calls', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { getDatabaseConfig, resetDatabaseConfig } = await import('@/lib/database/config');

      const config1 = getDatabaseConfig();
      const configResult = getDatabaseConfig();

      expect(configResult).toEqual(config1);

      resetDatabaseConfig();
    });

    it('should resetDatabaseConfig clears cache', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { getDatabaseConfig, resetDatabaseConfig } = await import('@/lib/database/config');

      const config1 = getDatabaseConfig();
      resetDatabaseConfig();
      const config2 = getDatabaseConfig();

      // Different instances but same content
      expect(config1).not.toBe(config2);
      expect(config1.backend).toBe(config2.backend);

      resetDatabaseConfig();
    });

    it('should setDatabaseConfig overrides cache', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';
      process.env.SQLITE_PATH = '/tmp/default.db';

      const { getDatabaseConfig, setDatabaseConfig, resetDatabaseConfig } = await import(
        '@/lib/database/config'
      );

      getDatabaseConfig();

      const customConfig = {
        backend: 'sqlite' as const,
        sqlite: {
          path: '/tmp/custom.db',
          walMode: false,
          busyTimeout: 3000,
          foreignKeys: false,
          journalMode: 'truncate' as const,
          synchronous: 'off' as const,
          cacheSize: -32000,
        },
      };

      setDatabaseConfig(customConfig);
      const retrievedConfig = getDatabaseConfig();

      expect(retrievedConfig.backend).toBe('sqlite');
      expect(retrievedConfig.sqlite?.path).toBe('/tmp/custom.db');

      resetDatabaseConfig();
    });

    it('should loadDatabaseConfig validate complete configuration', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { getDatabaseConfig, resetDatabaseConfig } = await import('@/lib/database/config');

      const config = getDatabaseConfig();

      expect(config.backend).toBe('sqlite');
      expect(config.sqlite).toBeDefined();
      expect(config.sqlite?.path).toBeDefined();

      resetDatabaseConfig();
    });
  });

  describe('validateDatabaseReady', () => {
    it('should return ready:true for valid SQLite config', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { validateDatabaseReady, resetDatabaseConfig } = await import('@/lib/database/config');

      const result = validateDatabaseReady();

      expect(result.ready).toBe(true);
      expect(result.error).toBeUndefined();

      resetDatabaseConfig();
    });
  });

  describe('backendSupports', () => {
    it('should return false for vectorSearch on SQLite', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { backendSupports, resetDatabaseConfig } = await import('@/lib/database/config');

      expect(backendSupports('vectorSearch')).toBe(false);

      resetDatabaseConfig();
    });

    it('should return false for changeStreams on SQLite', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { backendSupports, resetDatabaseConfig } = await import('@/lib/database/config');

      expect(backendSupports('changeStreams')).toBe(false);

      resetDatabaseConfig();
    });

    it('should return false for aggregation on SQLite', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { backendSupports, resetDatabaseConfig } = await import('@/lib/database/config');

      expect(backendSupports('aggregation')).toBe(false);

      resetDatabaseConfig();
    });
  });

  describe('getDefaultDataDirectory', () => {
    it('should return /app/quilltap/data in Docker environment', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getDefaultDataDirectory } = await import('@/lib/database/config');

      expect(getDefaultDataDirectory()).toBe(path.join('/app/quilltap', 'data'));
    });

    it('should return platform-specific data directory in non-Docker environment', async () => {
      delete process.env.DOCKER_CONTAINER;

      const { getDefaultDataDirectory } = await import('@/lib/database/config');

      const result = getDefaultDataDirectory();
      // Platform-specific paths: Linux uses .quilltap, macOS uses Library/Application Support/Quilltap
      expect(result.toLowerCase()).toContain('quilltap');
      expect(result).toContain('data');
    });
  });

  describe('getDefaultSQLitePath', () => {
    it('should return path to quilltap.db in default data directory', async () => {
      const { getDefaultSQLitePath } = await import('@/lib/database/config');

      const result = getDefaultSQLitePath();
      expect(result).toContain('quilltap.db');
      // Platform-specific paths: Linux uses .quilltap, macOS uses Library/Application Support/Quilltap
      expect(result.toLowerCase()).toContain('quilltap');
    });
  });

  describe('Schema Validation', () => {
    it('should validate SQLiteConfig schema properties', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { loadSQLiteConfig } = await import('@/lib/database/config');

      const config = loadSQLiteConfig();

      expect(config.path).toBeDefined();
      expect(typeof config.walMode).toBe('boolean');
      expect(typeof config.busyTimeout).toBe('number');
      expect(config.busyTimeout).toBeGreaterThan(0);
      expect(typeof config.foreignKeys).toBe('boolean');
      expect(['delete', 'truncate', 'persist', 'memory', 'off']).toContain(config.journalMode);
      expect(['off', 'normal', 'full', 'extra']).toContain(config.synchronous);
      expect(typeof config.cacheSize).toBe('number');
    });

    it('should validate DatabaseConfig requires backend-specific config', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { getDatabaseConfig, resetDatabaseConfig } = await import('@/lib/database/config');

      const config = getDatabaseConfig();

      if (config.backend === 'sqlite') {
        expect(config.sqlite).toBeDefined();
        expect(config.mongodb).toBeUndefined();
      }

      resetDatabaseConfig();
    });
  });

  describe('loadDatabaseConfig', () => {
    it('should load complete config for SQLite backend', async () => {
      process.env.DATABASE_BACKEND = 'sqlite';

      const { loadDatabaseConfig } = await import('@/lib/database/config');

      const config = loadDatabaseConfig();

      expect(config.backend).toBe('sqlite');
      expect(config.sqlite).toBeDefined();
      expect(config.sqlite?.path).toBeDefined();
      expect(config.mongodb).toBeUndefined();
    });

    it('should default to SQLite when no backend specified', async () => {
      delete process.env.DATABASE_BACKEND;

      const { loadDatabaseConfig } = await import('@/lib/database/config');

      const config = loadDatabaseConfig();

      expect(config.backend).toBe('sqlite');
      expect(config.sqlite).toBeDefined();
    });
  });

  describe('Integer Parsing', () => {
    it('should handle invalid SQLITE_BUSY_TIMEOUT gracefully', async () => {
      process.env.SQLITE_BUSY_TIMEOUT = 'not-a-number';

      const { loadSQLiteConfig } = await import('@/lib/database/config');

      expect(() => loadSQLiteConfig()).toThrow();
    });

    it('should handle invalid SQLITE_CACHE_SIZE gracefully', async () => {
      process.env.SQLITE_CACHE_SIZE = 'not-a-number';

      const { loadSQLiteConfig } = await import('@/lib/database/config');

      expect(() => loadSQLiteConfig()).toThrow();
    });
  });
});
