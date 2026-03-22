/**
 * Unit tests for create-instance-settings-table migration
 *
 * Tests cover:
 * - shouldRun() logic (SQLite backend check, table existence)
 * - run() table creation and result structure
 * - Migration metadata (id, dependsOn, introducedInVersion)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

let mockIsSQLiteBackend = jest.fn<() => boolean>();
let mockGetSQLiteDatabase = jest.fn();
let mockSqliteTableExists = jest.fn<(name: string) => boolean>();

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => mockIsSQLiteBackend(),
  getSQLiteDatabase: () => mockGetSQLiteDatabase(),
  sqliteTableExists: (name: string) => mockSqliteTableExists(name),
}));

// ============================================================================
// Tests
// ============================================================================

describe('create-instance-settings-table migration', () => {
  let migration: typeof import('@/migrations/scripts/create-instance-settings-table');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    mockIsSQLiteBackend = jest.fn<() => boolean>().mockReturnValue(true);
    mockSqliteTableExists = jest.fn<(name: string) => boolean>().mockReturnValue(false);
    mockGetSQLiteDatabase = jest.fn();

    migration = await import('@/migrations/scripts/create-instance-settings-table');
  });

  describe('metadata', () => {
    it('should have correct id', () => {
      expect(migration.createInstanceSettingsTableMigration.id).toBe(
        'create-instance-settings-table-v1'
      );
    });

    it('should depend on sqlite-initial-schema-v1', () => {
      expect(migration.createInstanceSettingsTableMigration.dependsOn).toContain(
        'sqlite-initial-schema-v1'
      );
    });

    it('should have correct introducedInVersion', () => {
      expect(migration.createInstanceSettingsTableMigration.introducedInVersion).toBe('3.3.0');
    });

    it('should have a description', () => {
      expect(migration.createInstanceSettingsTableMigration.description).toBeTruthy();
    });
  });

  describe('shouldRun', () => {
    it('should return false when not SQLite backend', async () => {
      mockIsSQLiteBackend.mockReturnValue(false);

      const result = await migration.createInstanceSettingsTableMigration.shouldRun();
      expect(result).toBe(false);
    });

    it('should return false when table already exists', async () => {
      mockSqliteTableExists.mockReturnValue(true);

      const result = await migration.createInstanceSettingsTableMigration.shouldRun();
      expect(result).toBe(false);
    });

    it('should return true when SQLite backend and table does not exist', async () => {
      mockIsSQLiteBackend.mockReturnValue(true);
      mockSqliteTableExists.mockReturnValue(false);

      const result = await migration.createInstanceSettingsTableMigration.shouldRun();
      expect(result).toBe(true);
    });
  });

  describe('run', () => {
    it('should create table and return success result', async () => {
      const mockExec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({ exec: mockExec });

      const result = await migration.createInstanceSettingsTableMigration.run();

      expect(result.success).toBe(true);
      expect(result.id).toBe('create-instance-settings-table-v1');
      expect(result.itemsAffected).toBe(1);
      expect(result.message).toContain('instance_settings');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS')
      );
    });

    it('should return failure result when exec throws', async () => {
      const mockExec = jest.fn().mockImplementation(() => {
        throw new Error('table creation failed');
      });
      mockGetSQLiteDatabase.mockReturnValue({ exec: mockExec });

      const result = await migration.createInstanceSettingsTableMigration.run();

      expect(result.success).toBe(false);
      expect(result.id).toBe('create-instance-settings-table-v1');
      expect(result.itemsAffected).toBe(0);
      expect(result.error).toContain('table creation failed');
    });

    it('should include durationMs and timestamp in result', async () => {
      mockGetSQLiteDatabase.mockReturnValue({ exec: jest.fn() });

      const result = await migration.createInstanceSettingsTableMigration.run();

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });
  });
});
