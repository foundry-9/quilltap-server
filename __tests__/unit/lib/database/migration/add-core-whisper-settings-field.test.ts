/**
 * Unit tests for the add-core-whisper-settings-field-v1 migration.
 *
 * Regression context: the original `add-core-whisper-fields-v1` migration added
 * the per-chat and per-character override columns but never added the
 * global-default `coreWhisper` column on `chat_settings`. Because the
 * `ChatSettings` repository writes that column on every chat-settings UPDATE,
 * every write failed with `no such column: coreWhisper` (a 500, surfaced in the
 * UI as "Failed to update agent mode max turns"). This companion migration adds
 * the missing column. These tests pin:
 *
 * - shouldRun() only fires on a SQLite backend where chat_settings exists but
 *   lacks the column (and is a no-op once the column is present — idempotency),
 * - run() issues exactly the ALTER TABLE that adds `coreWhisper` with the
 *   correct default JSON, and is a no-op when the column already exists,
 * - the default JSON carries the shape the repository/schema expect.
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

type Column = { name: string; type: string; notnull: boolean; dflt_value: unknown; pk: boolean };

let mockIsSQLiteBackend = jest.fn<() => boolean>();
let mockGetSQLiteDatabase = jest.fn<() => { exec: (sql: string) => void }>();
let mockSqliteTableExists = jest.fn<(name: string) => boolean>();
let mockGetSQLiteTableColumns = jest.fn<(name: string) => Column[]>();

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => mockIsSQLiteBackend(),
  getSQLiteDatabase: () => mockGetSQLiteDatabase(),
  sqliteTableExists: (name: string) => mockSqliteTableExists(name),
  getSQLiteTableColumns: (name: string) => mockGetSQLiteTableColumns(name),
}));

// Helper: build PRAGMA-shaped column rows from a list of names.
const cols = (...names: string[]): Column[] =>
  names.map((name) => ({ name, type: 'TEXT', notnull: false, dflt_value: null, pk: false }));

// ============================================================================
// Tests
// ============================================================================

describe('add-core-whisper-settings-field migration', () => {
  let migration: typeof import('@/migrations/scripts/add-core-whisper-settings-field');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    mockIsSQLiteBackend = jest.fn<() => boolean>().mockReturnValue(true);
    mockSqliteTableExists = jest.fn<(name: string) => boolean>().mockReturnValue(true);
    // Default: chat_settings exists but has no coreWhisper column (the broken state).
    mockGetSQLiteTableColumns = jest
      .fn<(name: string) => Column[]>()
      .mockReturnValue(cols('id', 'userId', 'autonomousRoomSettings'));
    mockGetSQLiteDatabase = jest
      .fn<() => { exec: (sql: string) => void }>()
      .mockReturnValue({ exec: jest.fn() });

    migration = await import('@/migrations/scripts/add-core-whisper-settings-field');
  });

  describe('metadata', () => {
    it('has the correct id', () => {
      expect(migration.addCoreWhisperSettingsFieldMigration.id).toBe(
        'add-core-whisper-settings-field-v1'
      );
    });

    it('depends on sqlite-initial-schema-v1', () => {
      expect(migration.addCoreWhisperSettingsFieldMigration.dependsOn).toContain(
        'sqlite-initial-schema-v1'
      );
    });

    it('records the introducing version', () => {
      expect(migration.addCoreWhisperSettingsFieldMigration.introducedInVersion).toBe('4.6.0');
    });

    it('has a description', () => {
      expect(migration.addCoreWhisperSettingsFieldMigration.description).toBeTruthy();
    });
  });

  describe('shouldRun', () => {
    it('returns false when not a SQLite backend', async () => {
      mockIsSQLiteBackend.mockReturnValue(false);
      expect(await migration.addCoreWhisperSettingsFieldMigration.shouldRun()).toBe(false);
    });

    it('returns false when chat_settings does not exist', async () => {
      mockSqliteTableExists.mockReturnValue(false);
      expect(await migration.addCoreWhisperSettingsFieldMigration.shouldRun()).toBe(false);
    });

    it('returns false when the coreWhisper column already exists (idempotent)', async () => {
      mockGetSQLiteTableColumns.mockReturnValue(cols('id', 'userId', 'coreWhisper'));
      expect(await migration.addCoreWhisperSettingsFieldMigration.shouldRun()).toBe(false);
    });

    it('returns true on SQLite when chat_settings lacks coreWhisper (the regression state)', async () => {
      expect(await migration.addCoreWhisperSettingsFieldMigration.shouldRun()).toBe(true);
    });

    it('checks the chat_settings table specifically', async () => {
      await migration.addCoreWhisperSettingsFieldMigration.shouldRun();
      expect(mockSqliteTableExists).toHaveBeenCalledWith('chat_settings');
      expect(mockGetSQLiteTableColumns).toHaveBeenCalledWith('chat_settings');
    });
  });

  describe('run', () => {
    it('adds the coreWhisper column when missing and reports success', async () => {
      const exec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({ exec });

      const result = await migration.addCoreWhisperSettingsFieldMigration.run();

      expect(result.success).toBe(true);
      expect(result.id).toBe('add-core-whisper-settings-field-v1');
      expect(result.itemsAffected).toBe(1);
      expect(result.message).toMatch(/coreWhisper/);
      expect(exec).toHaveBeenCalledTimes(1);

      const sql = exec.mock.calls[0][0] as string;
      // Targets the right table/column with the right type.
      expect(sql).toMatch(/ALTER TABLE "chat_settings"/);
      expect(sql).toMatch(/ADD COLUMN "coreWhisper" TEXT/);
    });

    it('writes the expected default JSON shape (regression: schema/repository expectations)', async () => {
      const exec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({ exec });

      await migration.addCoreWhisperSettingsFieldMigration.run();

      const sql = exec.mock.calls[0][0] as string;
      // Extract the DEFAULT '...' JSON literal and parse it back out.
      const match = sql.match(/DEFAULT '(.+)'/);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed).toEqual({
        enabled: true,
        interval: 12,
        silenceThreshold: 3,
        packetTokenBudget: 4096,
        fireOnContextTransition: true,
      });
    });

    it('is a no-op when the column already exists (does not double-add)', async () => {
      const exec = jest.fn();
      mockGetSQLiteDatabase.mockReturnValue({ exec });
      mockGetSQLiteTableColumns.mockReturnValue(cols('id', 'userId', 'coreWhisper'));

      const result = await migration.addCoreWhisperSettingsFieldMigration.run();

      expect(exec).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.itemsAffected).toBe(0);
    });

    it('returns a failure result when the ALTER throws', async () => {
      const exec = jest.fn(() => {
        throw new Error('disk is on fire');
      });
      mockGetSQLiteDatabase.mockReturnValue({ exec });

      const result = await migration.addCoreWhisperSettingsFieldMigration.run();

      expect(result.success).toBe(false);
      expect(result.id).toBe('add-core-whisper-settings-field-v1');
      expect(result.itemsAffected).toBe(0);
      expect(result.error).toContain('disk is on fire');
    });

    it('includes durationMs and timestamp in the result', async () => {
      const result = await migration.addCoreWhisperSettingsFieldMigration.run();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeTruthy();
    });
  });
});
