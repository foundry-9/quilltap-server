/**
 * @jest-environment node
 *
 * The migration runner's failure rules (bug 175). An ordinary migration that
 * fails stops the run, and `instrumentation.ts` exits on a failed run. A
 * migration marked `resumable` is logged, written to no ledger, deferred to
 * the next boot, and the run carries on; anything that depends on it waits
 * with it.
 *
 * Guards:
 *   - migrations/index.ts (`deferResumable`, the deferred-dependency skip)
 *   - migrations/types.ts (`Migration.resumable`, `MigrationRunResult.deferred`)
 */

import type { Migration, MigrationResult } from '../../../migrations/types';

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
}));

jest.mock('../../../migrations/state', () => ({
  loadMigrationState: jest.fn(async () => ({
    completedMigrations: [],
    lastChecked: '',
    quilltapVersion: 'test',
  })),
  isMigrationCompleted: jest.fn(() => false),
  recordCompletedMigration: jest.fn(async (state: unknown) => state),
}));

jest.mock('../../../migrations/scripts', () => ({
  migrations: [] as unknown[],
}));

import { MigrationRunner } from '../../../migrations';
import { recordCompletedMigration } from '../../../migrations/state';
import { migrations as registry } from '../../../migrations/scripts';

function result(id: string, success: boolean): MigrationResult {
  return {
    id,
    success,
    itemsAffected: 0,
    message: success ? 'ok' : 'failed',
    error: success ? undefined : 'planted failure',
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };
}

function migration(id: string, overrides: Partial<Migration> = {}): Migration & { run: jest.Mock } {
  return {
    id,
    description: id,
    introducedInVersion: '0.0.0',
    shouldRun: async () => true,
    run: jest.fn(async () => result(id, true)),
    ...overrides,
  } as Migration & { run: jest.Mock };
}

function setRegistry(list: Migration[]): void {
  const arr = registry as Migration[];
  arr.length = 0;
  arr.push(...list);
}

describe('MigrationRunner failure rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops the run when an ordinary migration fails', async () => {
    const after = migration('after');
    setRegistry([
      migration('fails', { run: jest.fn(async () => result('fails', false)) }),
      after,
    ]);

    const outcome = await new MigrationRunner().runMigrations();

    expect(outcome.success).toBe(false);
    expect(outcome.failed).toEqual(['fails']);
    expect(after.run).not.toHaveBeenCalled();
  });

  it('defers a failed resumable migration and carries on', async () => {
    const after = migration('after');
    setRegistry([
      migration('collapse', { resumable: true, run: jest.fn(async () => result('collapse', false)) }),
      after,
    ]);

    const outcome = await new MigrationRunner().runMigrations();

    expect(outcome.success).toBe(true);
    expect(outcome.failed).toBeUndefined();
    expect(outcome.deferred).toEqual(['collapse']);
    expect(after.run).toHaveBeenCalledTimes(1);
    // Only the migration that succeeded is written to the ledger
    expect(recordCompletedMigration).toHaveBeenCalledTimes(1);
    expect((recordCompletedMigration as jest.Mock).mock.calls[0][1].id).toBe('after');
  });

  it('defers a resumable migration that throws', async () => {
    setRegistry([
      migration('collapse', {
        resumable: true,
        run: jest.fn(async () => {
          throw new Error('planted collapse failure');
        }),
      }),
    ]);

    const outcome = await new MigrationRunner().runMigrations();

    expect(outcome.success).toBe(true);
    expect(outcome.deferred).toEqual(['collapse']);
    expect(recordCompletedMigration).not.toHaveBeenCalled();
  });

  it('defers a migration that depends on a deferred one, without running it', async () => {
    const dependant = migration('dependant', { dependsOn: ['collapse'] });
    const unrelated = migration('unrelated');
    setRegistry([
      migration('collapse', { resumable: true, run: jest.fn(async () => result('collapse', false)) }),
      dependant,
      unrelated,
    ]);

    const outcome = await new MigrationRunner().runMigrations();

    expect(outcome.success).toBe(true);
    expect(outcome.deferred).toEqual(['collapse', 'dependant']);
    expect(dependant.run).not.toHaveBeenCalled();
    expect(unrelated.run).toHaveBeenCalledTimes(1);
  });

  it('marks the avatar-roll collapse resumable', async () => {
    const { collapseDuplicateAvatarRollsMigration } = jest.requireActual(
      '../../../migrations/scripts/collapse-duplicate-avatar-rolls-v1'
    );
    expect(collapseDuplicateAvatarRollsMigration.resumable).toBe(true);
  });
});
