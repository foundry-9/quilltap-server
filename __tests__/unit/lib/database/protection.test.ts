/**
 * Unit tests for SQLite database protection module
 *
 * Tests cover:
 * - Integrity check (pass/fail/error scenarios)
 * - Periodic checkpoint lifecycle (start/stop)
 * - Shutdown checkpoint
 * - Backup checkpoint
 * - Error handling for all functions
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

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

// Create mock database
function createMockDb() {
  return {
    pragma: jest.fn(),
    backup: jest.fn(),
  };
}

describe('SQLite Protection Module', () => {
  let protection: typeof import('@/lib/database/backends/sqlite/protection');

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    // Clear globalThis state
    globalThis.__quilltapCheckpointInterval = undefined;

    protection = await import('@/lib/database/backends/sqlite/protection');
  });

  afterEach(() => {
    // Clean up any running intervals
    if (globalThis.__quilltapCheckpointInterval) {
      clearInterval(globalThis.__quilltapCheckpointInterval);
      globalThis.__quilltapCheckpointInterval = undefined;
    }
    jest.useRealTimers();
  });

  describe('runIntegrityCheck', () => {
    it('should return true when integrity check passes', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockReturnValue('ok');

      const result = protection.runIntegrityCheck(db as never);

      expect(result).toBe(true);
      expect(db.pragma).toHaveBeenCalledWith('quick_check', { simple: true });
    });

    it('should return false when integrity check fails', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockReturnValue('*** in database main ***\nPage 3: btreeInitPage() returns error code 11');

      const result = protection.runIntegrityCheck(db as never);

      expect(result).toBe(false);
    });

    it('should return false when pragma throws an error', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockImplementation(() => {
        throw new Error('database disk image is malformed');
      });

      const result = protection.runIntegrityCheck(db as never);

      expect(result).toBe(false);
    });
  });

  describe('startPeriodicCheckpoints / stopPeriodicCheckpoints', () => {
    it('should set a global interval', () => {
      const db = createMockDb();

      protection.startPeriodicCheckpoints(db as never);

      expect(globalThis.__quilltapCheckpointInterval).toBeDefined();
    });

    it('should run checkpoint on interval tick', () => {
      const db = createMockDb();

      protection.startPeriodicCheckpoints(db as never);

      // Advance time by 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(db.pragma).toHaveBeenCalledWith('wal_checkpoint(PASSIVE)');
    });

    it('should clear interval on stop', () => {
      const db = createMockDb();

      protection.startPeriodicCheckpoints(db as never);
      expect(globalThis.__quilltapCheckpointInterval).toBeDefined();

      protection.stopPeriodicCheckpoints();
      expect(globalThis.__quilltapCheckpointInterval).toBeUndefined();
    });

    it('should be safe to call stop when no interval is running', () => {
      expect(() => protection.stopPeriodicCheckpoints()).not.toThrow();
    });

    it('should clear existing interval before starting a new one', () => {
      const db1 = createMockDb();
      const db2 = createMockDb();

      protection.startPeriodicCheckpoints(db1 as never);
      const firstInterval = globalThis.__quilltapCheckpointInterval;

      protection.startPeriodicCheckpoints(db2 as never);
      const secondInterval = globalThis.__quilltapCheckpointInterval;

      expect(firstInterval).not.toBe(secondInterval);

      // Advance and verify only db2 gets the checkpoint call
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(db2.pragma).toHaveBeenCalledWith('wal_checkpoint(PASSIVE)');
    });

    it('should not throw when checkpoint pragma fails during interval', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockImplementation(() => {
        throw new Error('database is locked');
      });

      protection.startPeriodicCheckpoints(db as never);

      // Should not throw
      expect(() => jest.advanceTimersByTime(5 * 60 * 1000)).not.toThrow();
    });
  });

  describe('runShutdownCheckpoint', () => {
    it('should run TRUNCATE checkpoint', () => {
      const db = createMockDb();

      protection.runShutdownCheckpoint(db as never);

      expect(db.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    });

    it('should not throw when pragma fails', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockImplementation(() => {
        throw new Error('database is locked');
      });

      expect(() => protection.runShutdownCheckpoint(db as never)).not.toThrow();
    });
  });

  describe('runBackupCheckpoint', () => {
    it('should run PASSIVE checkpoint', () => {
      const db = createMockDb();

      protection.runBackupCheckpoint(db as never);

      expect(db.pragma).toHaveBeenCalledWith('wal_checkpoint(PASSIVE)');
    });

    it('should not throw when pragma fails', () => {
      const db = createMockDb();
      (db.pragma as jest.Mock).mockImplementation(() => {
        throw new Error('database is locked');
      });

      expect(() => protection.runBackupCheckpoint(db as never)).not.toThrow();
    });
  });
});
