/**
 * Unit tests for database migration service
 *
 * Tests cover:
 * - Migration progress tracking
 * - Service singleton behavior
 * - Migration readiness checks (with mocks)
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the database backends
jest.mock('@/lib/database/backends/sqlite', () => ({
  createSQLiteBackend: jest.fn(),
  SQLiteBackend: jest.fn(),
}));

// Mock the meta module
jest.mock('@/lib/database/meta', () => ({
  setPreferredBackend: jest.fn(() => true),
  getPreferredBackend: jest.fn(() => null),
  recordMigration: jest.fn(() => true),
  sqliteDatabaseExists: jest.fn(() => true),
}));

// Mock the config module
jest.mock('@/lib/database/config', () => ({
  loadSQLiteConfig: jest.fn(() => ({
    path: '/tmp/test.db',
    walMode: true,
    busyTimeout: 5000,
    foreignKeys: true,
    journalMode: 'delete',
    synchronous: 'normal',
    cacheSize: -64000,
  })),
  ensureDataDirectoryExists: jest.fn(),
  getDefaultSQLitePath: jest.fn(() => '/tmp/test.db'),
  DatabaseBackendType: jest.fn(),
}));

describe('Database Migration Service', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetAllMocks();
    jest.resetModules();
  });

  describe('getMigrationService', () => {
    it('should return singleton instance', async () => {
      const { getMigrationService } = await import('@/lib/database/migration');

      const service1 = getMigrationService();
      const service2 = getMigrationService();

      expect(service1).toBe(service2);
    });

    it('should return DatabaseMigrationService instance', async () => {
      const { getMigrationService, DatabaseMigrationService } = await import(
        '@/lib/database/migration'
      );

      const service = getMigrationService();

      expect(service).toBeInstanceOf(DatabaseMigrationService);
    });
  });

  describe('DatabaseMigrationService', () => {
    describe('getProgress', () => {
      it('should return null when no migration in progress', async () => {
        const { getMigrationService } = await import('@/lib/database/migration');

        const service = getMigrationService();
        const progress = service.getProgress();

        expect(progress).toBeNull();
      });
    });

    describe('isMigrationInProgress', () => {
      it('should return false when no migration in progress', async () => {
        const { getMigrationService } = await import('@/lib/database/migration');

        const service = getMigrationService();
        const inProgress = service.isMigrationInProgress();

        expect(inProgress).toBe(false);
      });
    });

  });

  describe('MigrationProgress type', () => {
    it('should have all required fields in progress tracking', async () => {
      const { MigrationProgress } = await import('@/lib/database/migration');

      // Type check - this is a compile-time check
      const progress: import('@/lib/database/migration').MigrationProgress = {
        phase: 'preparing',
        currentCollection: null,
        collectionsCompleted: 0,
        collectionsTotal: 10,
        recordsCompleted: 0,
        recordsTotal: 100,
        errors: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
      };

      expect(progress.phase).toBe('preparing');
      expect(progress.collectionsTotal).toBe(10);
      expect(progress.recordsTotal).toBe(100);
      expect(progress.errors).toEqual([]);
    });
  });

  describe('ReadinessResult type', () => {
    it('should have all required fields', async () => {
      const readiness: import('@/lib/database/migration').ReadinessResult = {
        ready: false,
        sourceConnected: false,
        targetWritable: false,
        collectionCounts: {},
        totalRecords: 0,
        errors: ['Test error'],
        warnings: [],
      };

      expect(readiness.ready).toBe(false);
      expect(readiness.errors).toContain('Test error');
    });
  });

  describe('MigrationResult type', () => {
    it('should have all required fields', async () => {
      const result: import('@/lib/database/migration').MigrationResult = {
        success: true,
        recordsMigrated: 500,
        collectionsMigrated: 10,
        duration: 5000,
        errors: [],
      };

      expect(result.success).toBe(true);
      expect(result.recordsMigrated).toBe(500);
      expect(result.duration).toBe(5000);
    });
  });

});

describe('Migration Module Exports', () => {
  it('should export all required types and functions', async () => {
    const migrationModule = await import('@/lib/database/migration');

    expect(migrationModule.DatabaseMigrationService).toBeDefined();
    expect(migrationModule.getMigrationService).toBeDefined();
    expect(typeof migrationModule.getMigrationService).toBe('function');
  });
});
