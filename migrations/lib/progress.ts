/**
 * Migration Progress Reporter
 *
 * Thin helper that migrations call inside their iteration loops to report
 * `x/total` progress. Forwards to:
 *
 *  1. the migration logger (`combined.log` gets throttled "Migration progress"
 *     lines), and
 *  2. the global `startupProgress` publisher, so the loading screen shows
 *     live sub-progress under the current migration's pretty label.
 *
 * Throttled to one emit per 250 ms (plus the final tick), so calling this
 * inside a hot loop is safe.
 *
 * Usage:
 *   import { reportProgress } from '../lib/progress';
 *
 *   // single tier:
 *   reportProgress(i + 1, items.length, 'items');
 *
 *   // nested tiers (outer to inner):
 *   reportProgress([
 *     { current: p + 1, total: projects.length, unit: 'projects' },
 *     { current: f + 1, total: files.length, unit: 'files' },
 *   ]);
 */

import { logger } from './logger';
import { startupProgress, type ProgressTier } from '@/lib/startup/progress';

const THROTTLE_MS = 250;

interface RunnerState {
  currentMigrationId: string | null;
  lastEmitTs: number;
}

const state: RunnerState = {
  currentMigrationId: null,
  lastEmitTs: 0,
};

/**
 * Called by `MigrationRunner` before invoking `migration.run()`. Resets the
 * throttle state and tells the loading screen which migration is now the
 * headline.
 */
export function beginMigration(id: string): void {
  state.currentMigrationId = id;
  state.lastEmitTs = 0;
  try {
    startupProgress.setCurrent(id);
  } catch {
    // best-effort — never let progress wiring break a migration boot
  }
}

/**
 * Called by `MigrationRunner` after `migration.run()` returns or throws.
 * Clears the loading-screen sub-progress so the next phase starts clean.
 */
export function endMigration(): void {
  state.currentMigrationId = null;
  state.lastEmitTs = 0;
  try {
    startupProgress.setSubProgress(null);
  } catch {
    // best-effort — never let progress hygiene break a migration teardown
  }
}

/**
 * Report progress for the currently running migration.
 *
 * Two call shapes:
 *   reportProgress(current, total, unit)
 *   reportProgress([{ current, total, unit }, ...])  // nested tiers, outer first
 *
 * Safe to call every iteration; the helper throttles internally.
 */
export function reportProgress(tiers: ProgressTier[]): void;
export function reportProgress(current: number, total: number, unit: string): void;
export function reportProgress(
  tiersOrCurrent: ProgressTier[] | number,
  total?: number,
  unit?: string
): void {
  if (!state.currentMigrationId) return;

  const tiers: ProgressTier[] = Array.isArray(tiersOrCurrent)
    ? tiersOrCurrent
    : [{ current: tiersOrCurrent, total: total ?? 0, unit: unit ?? 'items' }];

  if (tiers.length === 0) return;

  const now = Date.now();
  const isFinal = tiers.every(t => t.total > 0 && t.current >= t.total);

  if (!isFinal && now - state.lastEmitTs < THROTTLE_MS) return;

  state.lastEmitTs = now;

  const summary = tiers
    .map(t => `${t.current}/${t.total} ${t.unit}`)
    .join(', ');

  logger.info('Migration progress', {
    context: `migration.${state.currentMigrationId}`,
    migrationId: state.currentMigrationId,
    progress: tiers,
    summary,
  });

  try {
    startupProgress.setSubProgress(tiers);
  } catch {
    // best-effort — never let progress publishing break a migration
  }
}
