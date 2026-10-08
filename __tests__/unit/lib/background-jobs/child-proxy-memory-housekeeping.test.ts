/**
 * Memory writes across the job-child boundary
 * (memory-recall-and-housekeeping-fixes F1 / F8).
 *
 * In the forked child every repository write is buffered and returns a
 * placeholder (`undefined` for anything but create/upsert). Two consequences
 * this test pins through the real proxy:
 *
 * - F8: `deleteMemoriesWithUnlinkBatch` used to sum `bulkDelete`'s return,
 *   so a child sweep reported NaN (`deleted: null` in the log). It now counts
 *   the ids it resolved, and the buffered batch carries exactly those ids for
 *   the parent to apply.
 * - F1: absorbing a near-duplicate buffers one reinforcement patch and hands
 *   the caller the patched row rather than a false "update failed".
 *
 * - Bug 182: two jobs absorbing the same row from the same snapshot both
 *   count once the parent replays their buffered increments against a real
 *   SQLite row.
 *
 * That the parent then applies the batch (and `SELECT count(*)` matches the
 * logged totalAfter) is the dispatcher's existing apply path; see the manual
 * check in the spec's F8 notes.
 */

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
}));

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}));

// In the child runtime `@/lib/repositories/factory` returns the child proxy.
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () =>
    require('@/lib/background-jobs/child/child-repositories-proxy').getChildRepositoriesProxy(),
}));

jest.mock('@/lib/background-jobs/host/processor-host', () => ({
  sendToChild: jest.fn(() => true),
  notifyChild: jest.fn(),
}));

import { getRepositories as mockedRealRepositories } from '@/lib/database/repositories';
import { rawQuery } from '@/lib/database/manager';
import {
  runWithJobScope,
  flushPendingWrites,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';
import { deleteMemoriesWithUnlinkBatch, absorbNearDuplicate } from '@/lib/memory/memory-gate';
import type { Memory } from '@/lib/schemas/types';
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository';
import { calculateReinforcedImportance } from '@/lib/memory/reinforced-importance';
import path from 'path';

const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as { getRawDatabase: jest.Mock };
// Real binding by absolute root path — a bare require resolves to the mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;
const mockedRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
  process.env.QUILLTAP_JOB_CHILD = '1';
});

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
});

describe('child proxy — memory housekeeping writes', () => {
  it('F8: a buffered batch delete reports the resolved count, never NaN', async () => {
    const realBulkDelete = jest.fn();
    mockedRepoSource.mockReturnValue({
      memories: { bulkDelete: realBulkDelete, updateForCharacter: jest.fn() },
    } as never);
    mockedRawQuery.mockImplementation((async (sql: string) => {
      if (sql.includes('relatedMemoryIds IS NOT NULL')) return [];
      return [
        { id: 'm-1', characterId: 'char-1' },
        { id: 'm-2', characterId: 'char-1' },
      ];
    }) as never);

    let deleted = -1;
    const writes = await runWithJobScope('job-sweep', async () => {
      deleted = await deleteMemoriesWithUnlinkBatch(['m-1', 'm-2', 'already-gone']);
      return flushPendingWrites();
    });

    expect(deleted).toBe(2);
    // The child never touches the real repository — the parent applies it.
    expect(realBulkDelete).not.toHaveBeenCalled();
    const bulk = writes.filter(w => w.method === 'memories.bulkDelete');
    expect(bulk).toHaveLength(1);
    expect(bulk[0].args).toEqual(['char-1', ['m-1', 'm-2']]);
  });

  it('F1 / bug 182: absorbing a near-duplicate buffers one atomic increment and returns the local view', async () => {
    const realUpdate = jest.fn();
    const realIncrement = jest.fn();
    mockedRepoSource.mockReturnValue({
      memories: { updateForCharacter: realUpdate, incrementReinforcement: realIncrement },
    } as never);

    const existing = {
      id: 'm-1',
      characterId: 'char-1',
      content: 'Friday keeps the ledger.',
      summary: 'Ledger',
      importance: 0.5,
      reinforcementCount: 2,
    } as unknown as Memory;

    let absorbed: Memory | null = null;
    const writes = await runWithJobScope('job-extract', async () => {
      absorbed = await absorbNearDuplicate(existing);
      return flushPendingWrites();
    });

    expect(realUpdate).not.toHaveBeenCalled();
    expect(realIncrement).not.toHaveBeenCalled();
    expect(absorbed!.reinforcementCount).toBe(3);
    // The buffered payload says "increment", not "set to 3": the parent counts
    // against the committed row, so two jobs' absorbs both land (bug 182).
    expect(writes.filter(w => w.method === 'memories.updateForCharacter')).toHaveLength(0);
    const increments = writes.filter(w => w.method === 'memories.incrementReinforcement');
    expect(increments).toHaveLength(1);
    expect(increments[0].args[0]).toBe('char-1');
    expect(increments[0].args[1]).toBe('m-1');
    expect(typeof increments[0].args[2]).toBe('string');
    expect(increments[0].args).toHaveLength(3);
  });

  it('bug 182: two jobs absorbing one row from the same snapshot both count after the parent replays them', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE "memories" (
      "id" TEXT PRIMARY KEY, "characterId" TEXT NOT NULL, "importance" REAL DEFAULT 0.5,
      "reinforcementCount" INTEGER DEFAULT 1, "lastReinforcedAt" TEXT DEFAULT NULL,
      "reinforcedImportance" REAL DEFAULT 0.5, "updatedAt" TEXT NOT NULL)`);
    db.prepare(`INSERT INTO "memories" VALUES ('m-1', 'char-1', 0.5, 2, NULL, 0.5, 'x')`).run();
    getRawDatabase.mockReturnValue(db);
    const repo = new MemoriesRepository();
    mockedRepoSource.mockReturnValue({ memories: repo } as never);

    // Both jobs read the same snapshot: count 2.
    const snapshot = {
      id: 'm-1', characterId: 'char-1', content: 'Friday keeps the ledger.',
      summary: 'Ledger', importance: 0.5, reinforcementCount: 2,
    } as unknown as Memory;
    const jobA = await runWithJobScope('job-a', async () => {
      await absorbNearDuplicate(snapshot);
      return flushPendingWrites();
    });
    const jobB = await runWithJobScope('job-b', async () => {
      await absorbNearDuplicate(snapshot);
      return flushPendingWrites();
    });

    // The parent replays each batch by method name on its RW connection.
    delete process.env.QUILLTAP_JOB_CHILD;
    for (const write of [...jobA, ...jobB]) {
      const method = write.method.split('.')[1] as 'incrementReinforcement';
      await (repo[method] as (...a: unknown[]) => Promise<unknown>)(...write.args);
    }

    const row = db.prepare(`SELECT * FROM "memories" WHERE "id" = 'm-1'`).get();
    expect(row.reinforcementCount).toBe(4);
    expect(row.reinforcedImportance).toBeCloseTo(calculateReinforcedImportance(0.5, 4));
    expect(typeof row.lastReinforcedAt).toBe('string');
    db.close();
  });

  it('bug 182: incrementReinforcement refuses a row belonging to another character', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE "memories" (
      "id" TEXT PRIMARY KEY, "characterId" TEXT NOT NULL, "importance" REAL DEFAULT 0.5,
      "reinforcementCount" INTEGER DEFAULT 1, "lastReinforcedAt" TEXT DEFAULT NULL,
      "reinforcedImportance" REAL DEFAULT 0.5, "updatedAt" TEXT NOT NULL)`);
    db.prepare(`INSERT INTO "memories" VALUES ('m-1', 'char-1', 0.5, NULL, NULL, 0.5, 'x')`).run();
    getRawDatabase.mockReturnValue(db);
    delete process.env.QUILLTAP_JOB_CHILD;
    const repo = new MemoriesRepository();

    expect(await repo.incrementReinforcement('char-2', 'm-1', 'now')).toBeNull();
    // A NULL count reads as the schema default of 1.
    expect(await repo.incrementReinforcement('char-1', 'm-1', 'now')).toEqual({
      reinforcementCount: 2,
      reinforcedImportance: calculateReinforcedImportance(0.5, 2),
    });
    db.close();
  });
});
