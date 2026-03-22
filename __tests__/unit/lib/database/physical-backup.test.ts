/**
 * Unit tests for SQLite physical backup module
 *
 * Tests cover:
 * - Physical backup creation via VACUUM INTO (SQLCipher-compatible)
 * - 24-hour interval check (skip if recent backup exists)
 * - Partial file cleanup on failure
 * - Retention policy (7-day/weekly/monthly/yearly buckets)
 * - Backup filename generation and parsing
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';

// Mock the logger
jest.mock('@/lib/logger', () => ({
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

// Mock fs
const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  readdirSync: jest.fn(),
};

jest.mock('fs', () => mockFs);

// Mock paths
const MOCK_BACKUPS_DIR = '/mock/data/backups';
jest.mock('@/lib/paths', () => ({
  getBackupsDir: () => MOCK_BACKUPS_DIR,
}));

// Create mock database
function createMockDb() {
  return {
    exec: jest.fn(),
    pragma: jest.fn(),
  };
}

describe('SQLite Physical Backup Module', () => {
  let physicalBackup: typeof import('@/lib/database/backends/sqlite/physical-backup');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    // Default fs mocks
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.statSync as jest.Mock).mockReturnValue({ size: 1024000 });
    (mockFs.readdirSync as jest.Mock).mockReturnValue([]);

    physicalBackup = await import('@/lib/database/backends/sqlite/physical-backup');
  });

  describe('createPhysicalBackup', () => {
    it('should call VACUUM INTO with a path in the backups directory', async () => {
      const db = createMockDb();

      const result = await physicalBackup.createPhysicalBackup(db as never);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^\/mock\/data\/backups\/quilltap-\d{4}-\d{2}-\d{2}T\d{6}\.db$/);
      expect(db.exec).toHaveBeenCalledTimes(1);
      expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('VACUUM INTO'));
    });

    it('should create backups directory if it does not exist', async () => {
      const db = createMockDb();
      // First existsSync: shouldCreateBackup checks backupsDir → false (no dir yet)
      // Second existsSync: createPhysicalBackup checks backupsDir → false (still doesn't exist)
      (mockFs.existsSync as jest.Mock)
        .mockReturnValueOnce(false)   // shouldCreateBackup: backupsDir doesn't exist yet
        .mockReturnValueOnce(false);  // createPhysicalBackup: backupsDir still doesn't exist

      await physicalBackup.createPhysicalBackup(db as never);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(MOCK_BACKUPS_DIR, { recursive: true });
    });

    it('should return null on backup failure', async () => {
      const db = createMockDb();
      (db.exec as jest.Mock).mockImplementation(() => { throw new Error('disk full'); });
      // existsSync for cleanup check
      (mockFs.existsSync as jest.Mock)
        .mockReturnValueOnce(true)   // backups dir exists
        .mockReturnValueOnce(true);  // partial file exists

      const result = await physicalBackup.createPhysicalBackup(db as never);

      expect(result).toBeNull();
    });

    it('should skip backup if a recent backup exists (< 24 hours old)', async () => {
      const db = createMockDb();
      const recentBackup = formatBackupFilename(new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2 hours ago
      (mockFs.readdirSync as jest.Mock).mockReturnValue([recentBackup]);

      const result = await physicalBackup.createPhysicalBackup(db as never);

      expect(result).toBeNull();
      expect(db.exec).not.toHaveBeenCalled();
    });

    it('should create backup if most recent backup is older than 24 hours', async () => {
      const db = createMockDb();
      const oldBackup = formatBackupFilename(new Date(Date.now() - 25 * 60 * 60 * 1000)); // 25 hours ago
      (mockFs.readdirSync as jest.Mock).mockReturnValue([oldBackup]);

      const result = await physicalBackup.createPhysicalBackup(db as never);

      expect(result).not.toBeNull();
      expect(db.exec).toHaveBeenCalledTimes(1);
    });

    it('should clean up partial file on backup failure', async () => {
      const db = createMockDb();
      (db.exec as jest.Mock).mockImplementation(() => { throw new Error('disk full'); });
      (mockFs.existsSync as jest.Mock)
        .mockReturnValueOnce(true)   // backups dir exists
        .mockReturnValueOnce(true);  // partial file exists for cleanup

      await physicalBackup.createPhysicalBackup(db as never);

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should keep all backups less than 7 days old', async () => {
      const now = new Date();
      const files = [
        formatBackupFilename(new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)), // 1 day ago
        formatBackupFilename(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)), // 3 days ago
        formatBackupFilename(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)), // 6 days ago
      ];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(files);

      await physicalBackup.applyRetentionPolicy();

      // None should be deleted since all are < 7 days old
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should keep 1 per week for weeks 1-4', async () => {
      const now = new Date();
      const files = [
        // Week 1 (7-14 days ago) - 3 backups, should keep only the newest
        formatBackupFilename(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)),
        formatBackupFilename(new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)),
        formatBackupFilename(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000)),
      ];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(files);

      await physicalBackup.applyRetentionPolicy();

      // Should delete 2 of the 3 (keeping the newest in the week)
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should not throw when backups directory does not exist', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(physicalBackup.applyRetentionPolicy()).resolves.not.toThrow();
    });

    it('should not throw when readdirSync fails', async () => {
      (mockFs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('permission denied');
      });

      await expect(physicalBackup.applyRetentionPolicy()).resolves.not.toThrow();
    });

    it('should handle empty backups directory', async () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([]);

      await physicalBackup.applyRetentionPolicy();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should ignore non-matching filenames', async () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'not-a-backup.txt',
        '.DS_Store',
        'quilltap-bad-format.db',
      ]);

      await physicalBackup.applyRetentionPolicy();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle LLM logs backups separately from main backups', async () => {
      const now = new Date();
      const files = [
        // Main DB backup in week 1
        formatBackupFilename(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)),
        // LLM logs backup in week 1 — should be kept (only one in its bucket)
        formatLLMLogsBackupFilename(new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000)),
      ];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(files);

      await physicalBackup.applyRetentionPolicy();

      // Both should be kept: each is the only one in its week-1 bucket
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should apply retention to LLM logs backups independently', async () => {
      const now = new Date();
      const files = [
        // 3 LLM logs backups in week 1 (7-14 days) — keep newest, delete 2
        formatLLMLogsBackupFilename(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)),
        formatLLMLogsBackupFilename(new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)),
        formatLLMLogsBackupFilename(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000)),
      ];

      (mockFs.readdirSync as jest.Mock).mockReturnValue(files);

      await physicalBackup.applyRetentionPolicy();

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('createLLMLogsPhysicalBackup', () => {
    it('should call VACUUM INTO with LLM logs filename pattern', async () => {
      const db = createMockDb();

      const result = await physicalBackup.createLLMLogsPhysicalBackup(db as never);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^\/mock\/data\/backups\/quilltap-llm-logs-\d{4}-\d{2}-\d{2}T\d{6}\.db$/);
      expect(db.exec).toHaveBeenCalledTimes(1);
      expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('VACUUM INTO'));
    });

    it('should skip if recent LLM logs backup exists', async () => {
      const db = createMockDb();
      const recentBackup = formatLLMLogsBackupFilename(new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2 hours ago
      (mockFs.readdirSync as jest.Mock).mockReturnValue([recentBackup]);

      const result = await physicalBackup.createLLMLogsPhysicalBackup(db as never);

      expect(result).toBeNull();
      expect(db.exec).not.toHaveBeenCalled();
    });

    it('should create backup if last LLM logs backup is old', async () => {
      const db = createMockDb();
      const oldBackup = formatLLMLogsBackupFilename(new Date(Date.now() - 25 * 60 * 60 * 1000)); // 25 hours ago
      (mockFs.readdirSync as jest.Mock).mockReturnValue([oldBackup]);

      const result = await physicalBackup.createLLMLogsPhysicalBackup(db as never);

      expect(result).not.toBeNull();
      expect(db.exec).toHaveBeenCalledTimes(1);
    });

    it('should return null on failure and clean up partial file', async () => {
      const db = createMockDb();
      (db.exec as jest.Mock).mockImplementation(() => { throw new Error('disk full'); });
      (mockFs.existsSync as jest.Mock)
        .mockReturnValueOnce(true)   // backups dir exists
        .mockReturnValueOnce(true);  // partial file exists

      const result = await physicalBackup.createLLMLogsPhysicalBackup(db as never);

      expect(result).toBeNull();
      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Helper to generate a backup filename from a Date
 */
function formatBackupFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = [
    date.getFullYear(),
    '-', pad(date.getMonth() + 1),
    '-', pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `quilltap-${timestamp}.db`;
}

/**
 * Helper to generate an LLM logs backup filename from a Date
 */
function formatLLMLogsBackupFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = [
    date.getFullYear(),
    '-', pad(date.getMonth() + 1),
    '-', pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `quilltap-llm-logs-${timestamp}.db`;
}
