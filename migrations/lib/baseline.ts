/**
 * The migration baseline — when a skipped migration is settled for good.
 *
 * The runner asks every unrecorded migration's `shouldRun` at every boot, and
 * a `false` writes nothing, so the question is asked again next time. That is
 * right for a migration waiting on legacy data that is still to arrive, and
 * wrong for one whose legacy data can never exist. On a database created this
 * boot the migrations run before the app creates its tables and seeds its
 * rows, so every historical data pass answers "nothing to do" and stays armed;
 * the next boot finds rows written by current code and converts them as if
 * they were legacy (found in a fresh-instance dogfood run: the photo-to-vault pass read the seeded avatars'
 * vault link ids as missing `files.id`s and nulled them, garbage-collected
 * the gallery's `files` rows, and the about-character backfill re-attributed
 * the seeded memories).
 *
 * The rule: a migration whose `shouldRun` answered false is written to the
 * ledger as settled when the database cannot hold the data it converts —
 *
 *   - **a fresh database** (no ledger rows and no tables when the run began):
 *     everything after this boot is written by current code;
 *   - **a migration introduced before the database was born** (strictly older
 *     than the release that ran `sqlite-initial-schema-v1`, pre-release tags
 *     ignored, so a migration from the birth release itself stays armed).
 *
 * Never baselined: a migration that opts out with `skipMeansNotYet` (its
 * false means "wait for a later startup task"), one with an unsettled
 * dependency, one whose `shouldRun` threw, and one deferred this boot.
 *
 * @module migrations/lib/baseline
 */

import { compareVersions, parseVersion } from '@/lib/utils/semver';
import type { Migration, MigrationState } from '../types';

/** The migration that creates a database's tables; its ledger row dates the birth. */
export const INITIAL_SCHEMA_MIGRATION_ID = 'sqlite-initial-schema-v1';

export interface BaselineContext {
  /** The run began with an empty ledger and no tables. */
  freshDatabase: boolean;
  /** The release that created this database's tables, or null when unknown. */
  bornVersion: string | null;
  /** Whether a dependency is in the ledger or was baselined earlier this run. */
  isSettled: (migrationId: string) => boolean;
}

/** The release recorded on the initial-schema ledger row, or null. */
export function bornVersionOf(state: MigrationState): string | null {
  const record = state.completedMigrations.find((r) => r.id === INITIAL_SCHEMA_MIGRATION_ID);
  return record?.quilltapVersion ?? null;
}

/**
 * Why a migration whose `shouldRun` just answered false may be settled
 * without running, or null when it must be asked again next boot.
 */
export function baselineReason(migration: Migration, context: BaselineContext): string | null {
  if (migration.skipMeansNotYet) return null;
  if (migration.dependsOn?.some((dep) => !context.isSettled(dep))) return null;

  if (context.freshDatabase) {
    return 'the database was created this boot, so it holds no data from before this release';
  }

  const born = context.bornVersion;
  if (!born || !parseVersion(born) || !parseVersion(migration.introducedInVersion)) return null;
  if (compareVersions(migration.introducedInVersion, born) < 0) {
    return `introduced in ${migration.introducedInVersion}, before this database was created (${born})`;
  }
  return null;
}
