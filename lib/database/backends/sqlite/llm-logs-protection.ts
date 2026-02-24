/**
 * LLM Logs Database Protection Module
 *
 * Mirrors the protection.ts module for the dedicated LLM logs database.
 * Provides integrity checking, periodic WAL checkpoints, and shutdown
 * checkpoint for quilltap-llm-logs.db.
 *
 * If the integrity check fails, the degraded flag is set instead of
 * blocking startup — the main database is never affected.
 *
 * @module lib/database/backends/sqlite/llm-logs-protection
 */

import { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'database:llm-logs-protection' });

// ============================================================================
// HMR-Safe Global State
// ============================================================================

declare global {
  var __quilltapLLMLogsCheckpointInterval: ReturnType<typeof setInterval> | undefined;
}

/** Periodic checkpoint interval: 5 minutes */
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// Integrity Check
// ============================================================================

/**
 * Run a quick integrity check on the LLM logs database.
 *
 * If the check fails, sets the degraded flag on globalThis so the
 * repository layer knows to stop writing. Returns true on pass, false
 * on failure or error.
 *
 * @param db - The better-sqlite3 database instance for LLM logs
 * @returns true if integrity check passes, false otherwise
 */
export function runLLMLogsIntegrityCheck(db: DatabaseType): boolean {
  try {
    const result = db.pragma('quick_check', { simple: true }) as string;
    const passed = result === 'ok';

    if (passed) {
      moduleLogger.info('LLM logs database integrity check passed');
    } else {
      moduleLogger.error('LLM logs database integrity check FAILED — entering degraded mode', {
        result,
      });
      globalThis.__quilltapLLMLogsDegraded = true;
    }

    return passed;
  } catch (error) {
    moduleLogger.error('LLM logs database integrity check threw an error — entering degraded mode', {
      error: error instanceof Error ? error.message : String(error),
    });
    globalThis.__quilltapLLMLogsDegraded = true;
    return false;
  }
}

// ============================================================================
// Periodic WAL Checkpoints
// ============================================================================

/**
 * Start periodic PASSIVE WAL checkpoints on the LLM logs database.
 *
 * @param db - The better-sqlite3 database instance for LLM logs
 */
export function startLLMLogsPeriodicCheckpoints(db: DatabaseType): void {
  stopLLMLogsPeriodicCheckpoints();

  moduleLogger.info('Starting LLM logs periodic WAL checkpoints', {
    intervalMs: CHECKPOINT_INTERVAL_MS,
  });

  const interval = setInterval(() => {
    try {
      moduleLogger.debug('Running LLM logs periodic WAL checkpoint (PASSIVE)');
      const result = db.pragma('wal_checkpoint(PASSIVE)');
      moduleLogger.debug('LLM logs periodic WAL checkpoint completed', { result });
    } catch (error) {
      moduleLogger.error('LLM logs periodic WAL checkpoint failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, CHECKPOINT_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  globalThis.__quilltapLLMLogsCheckpointInterval = interval;
}

/**
 * Stop periodic WAL checkpoints for the LLM logs database.
 */
export function stopLLMLogsPeriodicCheckpoints(): void {
  if (globalThis.__quilltapLLMLogsCheckpointInterval) {
    clearInterval(globalThis.__quilltapLLMLogsCheckpointInterval);
    globalThis.__quilltapLLMLogsCheckpointInterval = undefined;
    moduleLogger.debug('Stopped LLM logs periodic WAL checkpoints');
  }
}

// ============================================================================
// Shutdown Checkpoint
// ============================================================================

/**
 * Run a TRUNCATE WAL checkpoint on the LLM logs database for clean shutdown.
 *
 * Never throws — errors are logged and swallowed.
 *
 * @param db - The better-sqlite3 database instance for LLM logs
 */
export function runLLMLogsShutdownCheckpoint(db: DatabaseType): void {
  try {
    moduleLogger.info('Running LLM logs shutdown WAL checkpoint (TRUNCATE)');
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    moduleLogger.info('LLM logs shutdown WAL checkpoint completed', { result });
  } catch (error) {
    moduleLogger.error('LLM logs shutdown WAL checkpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — shutdown must proceed
  }
}

// ============================================================================
// Backup Checkpoint
// ============================================================================

/**
 * Run a PASSIVE WAL checkpoint on the LLM logs database before backups.
 *
 * Never throws — errors are logged and swallowed.
 *
 * @param db - The better-sqlite3 database instance for LLM logs
 */
export function runLLMLogsBackupCheckpoint(db: DatabaseType): void {
  try {
    moduleLogger.info('Running LLM logs pre-backup WAL checkpoint (PASSIVE)');
    const result = db.pragma('wal_checkpoint(PASSIVE)');
    moduleLogger.info('LLM logs pre-backup WAL checkpoint completed', { result });
  } catch (error) {
    moduleLogger.error('LLM logs pre-backup WAL checkpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — backup should proceed regardless
  }
}
