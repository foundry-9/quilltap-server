/**
 * Unit tests for the drop-wardrobe-items-table-v1 migration.
 *
 * The migration retires the legacy `wardrobe_items` DB mirror once wardrobe
 * lives solely in the document store. Because dropping the table is
 * destructive, it is gated behind two `instance_settings` flags set by the
 * one-time startup population tasks (`refresh-vault-wardrobe` and
 * `move-shared-wardrobe-to-general`). These tests pin:
 *
 * - shouldRun() only fires on SQLite when the table exists AND BOTH population
 *   flags are 'true' (the two-startup safety interlock),
 * - run() snapshots the rows to a JSON backup before dropping, then drops the
 *   index and the table.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

type FakeDb = {
  prepare: (sql: string) => { all: () => Array<Record<string, unknown>> };
  exec: (sql: string) => void;
};

let mockIsSQLiteBackend = jest.fn<() => boolean>();
let mockGetSQLiteDatabase = jest.fn<() => FakeDb>();
let mockSqliteTableExists = jest.fn<(name: string) => boolean>();
let mockQuerySQLite = jest.fn<(sql: string, params?: unknown[]) => Array<{ value: string }>>();

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => mockIsSQLiteBackend(),
  getSQLiteDatabase: () => mockGetSQLiteDatabase(),
  sqliteTableExists: (name: string) => mockSqliteTableExists(name),
  querySQLite: (sql: string, params?: unknown[]) => mockQuerySQLite(sql, params),
}));

let mockBaseDataDir = '';
jest.mock('../../../../../lib/paths', () => ({
  getBaseDataDir: () => mockBaseDataDir,
}));

// Flag state the querySQLite mock reads from (mutated per-test).
let flagWardrobeFolder = 'true';
let flagSharedMoved = 'true';

describe('drop-wardrobe-items-table-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/drop-wardrobe-items-table-v1');
  let tmpDir: string;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    flagWardrobeFolder = 'true';
    flagSharedMoved = 'true';

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-wardrobe-test-'));
    mockBaseDataDir = tmpDir;

    mockIsSQLiteBackend = jest.fn<() => boolean>().mockReturnValue(true);
    mockSqliteTableExists = jest.fn<(name: string) => boolean>().mockReturnValue(true);
    mockQuerySQLite = jest
      .fn<(sql: string, params?: unknown[]) => Array<{ value: string }>>()
      .mockImplementation((_sql, params) => {
        const key = params?.[0];
        if (key === 'wardrobe_folder_migrated_v1') return [{ value: flagWardrobeFolder }];
        if (key === 'shared_wardrobe_moved_to_general_v1') return [{ value: flagSharedMoved }];
        return [];
      });
    mockGetSQLiteDatabase = jest
      .fn<() => FakeDb>()
      .mockReturnValue({ prepare: () => ({ all: () => [] }), exec: jest.fn() });

    migration = await import('@/migrations/scripts/drop-wardrobe-items-table-v1');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('has the correct id', () => {
      expect(migration.dropWardrobeItemsTableMigration.id).toBe('drop-wardrobe-items-table-v1');
    });

    it('depends on the newest wardrobe-population migration', () => {
      expect(migration.dropWardrobeItemsTableMigration.dependsOn).toContain(
        'migrate-outfit-presets-to-composites-v1',
      );
    });

    it('records the introducing version', () => {
      expect(migration.dropWardrobeItemsTableMigration.introducedInVersion).toBe('4.7.0');
    });
  });

  describe('shouldRun (dual-flag safety interlock)', () => {
    it('returns false when not a SQLite backend', async () => {
      mockIsSQLiteBackend.mockReturnValue(false);
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(false);
    });

    it('returns false when wardrobe_items does not exist', async () => {
      mockSqliteTableExists.mockImplementation((name) => name !== 'wardrobe_items');
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(false);
    });

    it('returns false when instance_settings does not exist (defensive)', async () => {
      mockSqliteTableExists.mockImplementation((name) => name !== 'instance_settings');
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(false);
    });

    it('returns false when the wardrobe-folder flag is unset', async () => {
      flagWardrobeFolder = 'false';
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(false);
    });

    it('returns false when the shared-moved flag is unset', async () => {
      flagSharedMoved = 'false';
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(false);
    });

    it('returns true only when both population flags are set and the table exists', async () => {
      expect(await migration.dropWardrobeItemsTableMigration.shouldRun()).toBe(true);
    });
  });

  describe('run', () => {
    it('snapshots rows to a JSON backup, then drops the index and table', async () => {
      const rows = [
        { id: 'w1', characterId: 'c1', title: 'Linen Jacket' },
        { id: 'w2', characterId: null, title: 'Shared Hat' },
      ];
      const exec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({
        prepare: () => ({ all: () => rows }),
        exec,
      });

      const result = await migration.dropWardrobeItemsTableMigration.run();

      expect(result.success).toBe(true);
      expect(result.id).toBe('drop-wardrobe-items-table-v1');
      expect(result.itemsAffected).toBe(2);

      // Snapshot file written with the rows.
      const backupPath = path.join(tmpDir, 'backup', 'pre-drop-wardrobe-items.json');
      expect(fs.existsSync(backupPath)).toBe(true);
      const payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      expect(payload.rowCount).toBe(2);
      expect(payload.rows).toEqual(rows);

      // Index dropped before the table.
      const execSql = (exec as jest.Mock).mock.calls.map((c) => c[0] as string);
      expect(execSql.some((s) => /DROP INDEX IF EXISTS "idx_wardrobe_items_character"/.test(s))).toBe(
        true,
      );
      expect(execSql.some((s) => /DROP TABLE IF EXISTS "wardrobe_items"/.test(s))).toBe(true);
    });

    it('writes a zero-row snapshot when the table is empty', async () => {
      const result = await migration.dropWardrobeItemsTableMigration.run();
      expect(result.success).toBe(true);
      const backupPath = path.join(tmpDir, 'backup', 'pre-drop-wardrobe-items.json');
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(backupPath, 'utf8')).rowCount).toBe(0);
    });

    it('is a no-op when the table is already absent', async () => {
      mockSqliteTableExists.mockImplementation((name) => name !== 'wardrobe_items');
      const exec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({
        prepare: () => ({ all: () => [] }),
        exec,
      });

      const result = await migration.dropWardrobeItemsTableMigration.run();

      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
      expect(exec).not.toHaveBeenCalled();
    });

    it('returns a failure result when the drop throws', async () => {
      const exec = jest.fn(() => {
        throw new Error('disk is on fire');
      });
      mockGetSQLiteDatabase.mockReturnValue({
        prepare: () => ({ all: () => [] }),
        exec,
      });

      const result = await migration.dropWardrobeItemsTableMigration.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain('disk is on fire');
    });
  });
});
