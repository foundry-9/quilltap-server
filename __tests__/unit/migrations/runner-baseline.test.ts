/**
 * @jest-environment node
 *
 * The migration baseline. A migration whose `shouldRun` answers false writes
 * no ledger row, so it is asked again at every boot. On a database created
 * this boot that left every historical data pass armed: the migrations run
 * before the app creates its tables and seeds its rows, so each answered
 * "nothing to do", and the next boot converted rows written by current code
 * as if they were legacy (the photo-to-vault pass nulled the seeded avatars;
 * the about-character backfill re-attributed the seeded memories).
 *
 * Guards:
 *   - migrations/lib/baseline.ts (`baselineReason`, `bornVersionOf`)
 *   - migrations/index.ts (the fresh-database probe and the baseline write)
 *   - migrations/types.ts (`Migration.skipMeansNotYet`)
 */

import type { Migration, MigrationRecord, MigrationResult, MigrationState } from '../../../migrations/types';

jest.mock('../../../migrations/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../migrations/lib/progress', () => ({
  beginMigration: jest.fn(),
  endMigration: jest.fn(),
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  closeDatabase: jest.fn(),
  waitForDatabaseReady: jest.fn(async () => true),
  detectDatabaseBackend: jest.fn(() => 'sqlite'),
  isMainDatabaseEmpty: jest.fn(() => true),
}));

jest.mock('../../../migrations/state', () => ({
  loadMigrationState: jest.fn(),
  isMigrationCompleted: jest.fn((state: MigrationState, id: string) =>
    state.completedMigrations.some((r) => r.id === id)
  ),
  recordCompletedMigration: jest.fn(async (state: MigrationState, result: MigrationResult) => ({
    ...state,
    completedMigrations: [
      ...state.completedMigrations,
      { id: result.id, completedAt: '', quilltapVersion: 'now', itemsAffected: 0, message: '' },
    ],
  })),
  recordBaselinedMigrations: jest.fn(async (state: MigrationState) => state),
}));

jest.mock('../../../migrations/scripts', () => ({
  migrations: [] as unknown[],
}));

import { MigrationRunner } from '../../../migrations';
import { baselineReason, bornVersionOf } from '../../../migrations/lib/baseline';
import { isMainDatabaseEmpty } from '../../../migrations/lib/database-utils';
import { loadMigrationState, recordBaselinedMigrations } from '../../../migrations/state';
import { migrations as registry } from '../../../migrations/scripts';

function result(id: string): MigrationResult {
  return {
    id,
    success: true,
    itemsAffected: 1,
    message: 'ok',
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };
}

function migration(id: string, overrides: Partial<Migration> = {}): Migration & { run: jest.Mock } {
  return {
    id,
    description: id,
    introducedInVersion: '1.0.0',
    shouldRun: async () => false,
    run: jest.fn(async () => result(id)),
    ...overrides,
  } as Migration & { run: jest.Mock };
}

function record(id: string, quilltapVersion: string): MigrationRecord {
  return { id, completedAt: '', quilltapVersion, itemsAffected: 0, message: '' };
}

function setRegistry(list: Migration[]): void {
  const arr = registry as Migration[];
  arr.length = 0;
  arr.push(...list);
}

function setLedger(records: MigrationRecord[]): void {
  (loadMigrationState as jest.Mock).mockResolvedValue({
    completedMigrations: records,
    lastChecked: '',
    quilltapVersion: 'test',
  });
}

function baselinedIds(): string[] {
  const calls = (recordBaselinedMigrations as jest.Mock).mock.calls;
  if (calls.length === 0) return [];
  return (calls[0][1] as Array<{ id: string }>).map((b) => b.id);
}

describe('MigrationRunner baseline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isMainDatabaseEmpty as jest.Mock).mockReturnValue(true);
  });

  describe('on a database created this boot', () => {
    beforeEach(() => setLedger([]));

    it('settles every skipped migration, and runs the ones with work', async () => {
      const schema = migration('sqlite-initial-schema-v1', { shouldRun: async () => true });
      const backfill = migration('legacy-backfill', { introducedInVersion: '4.4.0', dependsOn: ['sqlite-initial-schema-v1'] });
      const photos = migration('legacy-photos', { introducedInVersion: '4.5.0' });
      setRegistry([schema, backfill, photos]);

      const outcome = await new MigrationRunner().runMigrations();

      expect(outcome.success).toBe(true);
      expect(schema.run).toHaveBeenCalledTimes(1);
      expect(backfill.run).not.toHaveBeenCalled();
      expect(photos.run).not.toHaveBeenCalled();
      expect(baselinedIds()).toEqual(['legacy-backfill', 'legacy-photos']);
      expect(outcome.baselined).toEqual(['legacy-backfill', 'legacy-photos']);
      // One save for the lot
      expect(recordBaselinedMigrations).toHaveBeenCalledTimes(1);
    });

    it('leaves a "not yet" migration armed', async () => {
      setRegistry([
        migration('drop-legacy-table', { skipMeansNotYet: true }),
        migration('legacy-backfill'),
      ]);

      await new MigrationRunner().runMigrations();

      expect(baselinedIds()).toEqual(['legacy-backfill']);
    });

    it('leaves a migration whose shouldRun threw armed, and anything depending on it', async () => {
      setRegistry([
        migration('unreadable', {
          shouldRun: async () => {
            throw new Error('planted shouldRun failure');
          },
        }),
        migration('dependant', { dependsOn: ['unreadable'] }),
        migration('independent'),
      ]);

      await new MigrationRunner().runMigrations();

      expect(baselinedIds()).toEqual(['independent']);
    });

    it('treats a dependency missing from the registry as settled', async () => {
      setRegistry([migration('orphan-dependant', { dependsOn: ['long-retired-v1'] })]);

      await new MigrationRunner().runMigrations();

      expect(baselinedIds()).toEqual(['orphan-dependant']);
    });

    it('is not fooled by an empty ledger over a database that already has tables', async () => {
      (isMainDatabaseEmpty as jest.Mock).mockReturnValue(false);
      setRegistry([migration('legacy-backfill', { introducedInVersion: '2.0.0' })]);

      const outcome = await new MigrationRunner().runMigrations();

      expect(recordBaselinedMigrations).not.toHaveBeenCalled();
      expect(outcome.baselined).toBeUndefined();
    });
  });

  describe('on an existing database', () => {
    it('settles only skipped migrations introduced before the release that created it', async () => {
      setLedger([record('sqlite-initial-schema-v1', '4.10.0-dev.3')]);
      setRegistry([
        migration('older', { introducedInVersion: '4.9.2' }),
        migration('same-release', { introducedInVersion: '4.10.0' }),
        migration('newer', { introducedInVersion: '4.11.0' }),
        migration('older-with-work', { introducedInVersion: '4.2.0', shouldRun: async () => true }),
      ]);

      const outcome = await new MigrationRunner().runMigrations();

      expect(isMainDatabaseEmpty).not.toHaveBeenCalled();
      expect(baselinedIds()).toEqual(['older']);
      expect(outcome.migrationsRun).toBe(1);
    });

    it('settles nothing when the ledger does not record its birth', async () => {
      setLedger([record('some-other-migration-v1', '4.0.0')]);
      setRegistry([migration('older', { introducedInVersion: '1.0.0' })]);

      await new MigrationRunner().runMigrations();

      expect(recordBaselinedMigrations).not.toHaveBeenCalled();
    });
  });

  it('marks the wardrobe-table drop, which waits on startup tasks, as "not yet"', () => {
    const { dropWardrobeItemsTableMigration } = jest.requireActual(
      '../../../migrations/scripts/drop-wardrobe-items-table-v1'
    );
    expect(dropWardrobeItemsTableMigration.skipMeansNotYet).toBe(true);
  });
});

describe('baselineReason', () => {
  const settled = () => true;

  it('ignores pre-release tags on the birth release', () => {
    const m = migration('m', { introducedInVersion: '4.14.0' });
    expect(baselineReason(m, { freshDatabase: false, bornVersion: '4.14.0-dev.85', isSettled: settled })).toBeNull();
    expect(baselineReason(m, { freshDatabase: false, bornVersion: '4.15.0-dev.1', isSettled: settled })).toMatch(/4\.14\.0/);
  });

  it('refuses an unparseable version rather than guessing', () => {
    const m = migration('m', { introducedInVersion: 'someday' });
    expect(baselineReason(m, { freshDatabase: false, bornVersion: '9.0.0', isSettled: settled })).toBeNull();
  });

  it('reads the birth release from the initial-schema ledger row', () => {
    const state: MigrationState = {
      completedMigrations: [record('other', '1.0.0'), record('sqlite-initial-schema-v1', '3.2.1')],
      lastChecked: '',
      quilltapVersion: '4.0.0',
    };
    expect(bornVersionOf(state)).toBe('3.2.1');
    expect(bornVersionOf({ ...state, completedMigrations: [] })).toBeNull();
  });
});
