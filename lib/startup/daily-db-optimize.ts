/**
 * Daily database optimization (startup)
 *
 * Once per local calendar day, before migrations or anything else touches the
 * data, each of the three SQLite databases gets the same treatment the CLI's
 * `quilltap db optimize` gives it (`packages/quilltap/lib/db-commands.js`,
 * `optimizeOneDb`): VACUUM, ANALYZE, `PRAGMA optimize`. Keep the two step
 * lists in step.
 *
 * Each database is backed up first through the ordinary physical-backup
 * functions, which take a backup only when the last one is more than 24 hours
 * old — so the daily backup still happens at most once a day, it simply lands
 * before the optimize (and before migrations) on the day's first launch, and
 * the backend's own startup backup then finds it and skips.
 *
 * The gate is a small JSON file in the data directory recording, per
 * database, the local date of the last successful optimize. A database whose
 * optimize fails is not stamped and is tried again on the next launch.
 * Nothing here is fatal: a failure is logged and startup carries on.
 */

import fs from 'fs';
import path from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { getDataDir } from '@/lib/paths';
import { startupProgress } from '@/lib/startup/progress';

const moduleLogger = logger.child({ module: 'startup:daily-db-optimize' });

export type OptimizeTargetKey = 'main' | 'llm-logs' | 'mount-points';

export const OPTIMIZE_TARGET_KEYS: readonly OptimizeTargetKey[] = ['main', 'llm-logs', 'mount-points'];

/** Name of the gate file, under the data directory. */
export const OPTIMIZE_STATE_FILENAME = 'db-optimize-state.json';

export type OptimizeState = Partial<Record<OptimizeTargetKey, string>>;

export interface OptimizeStepResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/** The local calendar date as `YYYY-MM-DD`. */
export function localDateStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getOptimizeStatePath(): string {
  return path.join(getDataDir(), OPTIMIZE_STATE_FILENAME);
}

/** Read the gate file; a missing or unreadable file reads as "never optimized". */
export function readOptimizeState(statePath: string = getOptimizeStatePath()): OptimizeState {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const state: OptimizeState = {};
    for (const key of OPTIMIZE_TARGET_KEYS) {
      if (typeof parsed[key] === 'string') state[key] = parsed[key];
    }
    return state;
  } catch (error) {
    moduleLogger.warn('Could not read database optimize state; treating every database as due', {
      statePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export function writeOptimizeState(state: OptimizeState, statePath: string = getOptimizeStatePath()): void {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (error) {
    moduleLogger.warn('Could not write database optimize state; optimize will repeat on next launch', {
      statePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isOptimizeDue(state: OptimizeState, key: OptimizeTargetKey, today: string): boolean {
  return state[key] !== today;
}

/**
 * Run the CLI's optimize steps against an open connection. Stops at the first
 * failing step. Returns the per-step timings.
 */
export function optimizeDatabase(db: DatabaseType, label: string): { ok: boolean; steps: OptimizeStepResult[] } {
  const steps: OptimizeStepResult[] = [];
  const run = (name: string, fn: () => void): boolean => {
    const t0 = Date.now();
    try {
      fn();
      const ms = Date.now() - t0;
      steps.push({ name, ok: true, ms });
      moduleLogger.debug('Optimize step complete', { database: label, step: name, ms });
      return true;
    } catch (error) {
      const ms = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ name, ok: false, ms, error: message });
      moduleLogger.error('Optimize step failed', { database: label, step: name, ms, error: message });
      return false;
    }
  };

  const ok =
    run('VACUUM', () => { db.exec('VACUUM'); }) &&
    run('ANALYZE', () => { db.exec('ANALYZE'); }) &&
    run('PRAGMA optimize', () => { db.pragma('optimize'); });
  return { ok, steps };
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

interface TargetSpec {
  key: OptimizeTargetKey;
  label: string;
  /** Open the database, or null when its file does not exist yet. */
  open: () => DatabaseType | null;
  /** Whether this module owns the connection (and so closes it). */
  owned: boolean;
  backup: (db: DatabaseType) => Promise<string | null>;
  dbPath: () => string;
}

/**
 * Run the daily backup + optimize pass. Call after the version guard has
 * cleared the database and before migrations.
 */
export async function runDailyDbOptimize(now: Date = new Date()): Promise<void> {
  const today = localDateStamp(now);
  const statePath = getOptimizeStatePath();
  const state = readOptimizeState(statePath);
  const due = OPTIMIZE_TARGET_KEYS.filter((key) => isOptimizeDue(state, key, today));

  if (due.length === 0) {
    moduleLogger.debug('Databases already optimized today; skipping', { today, state });
    return;
  }

  const {
    isSQLiteBackend,
    getSQLiteDatabase,
    getSQLitePath,
    getLlmLogsDbPath,
    openLlmLogsDbIfPresent,
    openMountIndexDbIfPresent,
  } = await import('@/migrations/lib/database-utils');
  const {
    createPhysicalBackup,
    createLLMLogsPhysicalBackup,
    createMountIndexPhysicalBackup,
  } = await import('@/lib/database/backends/sqlite/physical-backup');
  const { getMountIndexDatabasePath } = await import('@/lib/paths');

  if (!isSQLiteBackend()) {
    moduleLogger.debug('Not a SQLite backend; nothing to optimize');
    return;
  }

  const specs: TargetSpec[] = [
    {
      key: 'main',
      label: 'main',
      // The migration layer's cached, lock-holding handle — the version guard
      // has already opened it, and migrations reuse it next.
      open: () => getSQLiteDatabase(),
      owned: false,
      backup: createPhysicalBackup,
      dbPath: getSQLitePath,
    },
    {
      key: 'llm-logs',
      label: 'llm-logs',
      open: () => openLlmLogsDbIfPresent(),
      owned: true,
      backup: createLLMLogsPhysicalBackup,
      dbPath: getLlmLogsDbPath,
    },
    {
      key: 'mount-points',
      label: 'mount-points',
      open: () => openMountIndexDbIfPresent(),
      owned: true,
      backup: createMountIndexPhysicalBackup,
      dbPath: getMountIndexDatabasePath,
    },
  ];
  const work = specs.filter((s) => due.includes(s.key));

  startupProgress.setCurrent('subsystem:db-optimize:start');
  moduleLogger.info('Daily database optimize starting', {
    today,
    databases: work.map((s) => s.label),
  });

  const t0 = Date.now();
  let totalReclaimed = 0;
  let optimized = 0;

  for (let i = 0; i < work.length; i++) {
    const spec = work[i];
    startupProgress.setSubProgress([{ current: i + 1, total: work.length, unit: 'databases' }]);

    let db: DatabaseType | null = null;
    try {
      db = spec.open();
      if (!db) {
        moduleLogger.debug('Database file not present; nothing to optimize', { database: spec.label });
        state[spec.key] = today;
        continue;
      }

      try {
        const backupPath = await spec.backup(db);
        moduleLogger.debug('Pre-optimize backup step done', {
          database: spec.label,
          backupPath: backupPath ?? '(skipped — a recent backup exists, or the backup failed; see above)',
        });
      } catch (error) {
        moduleLogger.warn('Pre-optimize backup threw; optimizing anyway (VACUUM is transactional)', {
          database: spec.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const dbPath = spec.dbPath();
      const sizeBefore = fileSize(dbPath);
      const { ok, steps } = optimizeDatabase(db, spec.label);
      if (!spec.owned) {
        // An owned connection checkpoints on close; the shared main handle
        // stays open, so fold the VACUUM's WAL back in by hand.
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (error) {
          moduleLogger.warn('Post-optimize WAL checkpoint failed', {
            database: spec.label,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const sizeAfter = fileSize(dbPath);

      if (ok) {
        state[spec.key] = today;
        optimized++;
        totalReclaimed += Math.max(0, sizeBefore - sizeAfter);
      }
      moduleLogger.info('Database optimize finished', {
        database: spec.label,
        ok,
        sizeBefore,
        sizeAfter,
        steps,
      });
    } catch (error) {
      moduleLogger.error('Database optimize failed; will retry on next launch', {
        database: spec.label,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (db && spec.owned) {
        try {
          db.close();
        } catch (error) {
          moduleLogger.warn('Error closing database after optimize', {
            database: spec.label,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  writeOptimizeState(state, statePath);

  const elapsedMs = Date.now() - t0;
  moduleLogger.info('Daily database optimize complete', {
    optimized,
    attempted: work.length,
    reclaimedBytes: totalReclaimed,
    elapsedMs,
  });
  startupProgress.publish({
    rawLabel: 'subsystem:db-optimize:complete',
    detail: `${optimized} of ${work.length} databases optimized in ${(elapsedMs / 1000).toFixed(1)} s`,
  });
}
