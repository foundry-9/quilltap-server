/**
 * @jest-environment node
 *
 * Bug 210: the housekeeping cap counts demotable rows only — hot AUTO rows.
 * `MemoriesRepository.countCapBreakdown` runs its real SQL against a real
 * in-memory SQLite database here, so the tier/source split the watermark, the
 * `character-memory-counts` action and the settings card all rely on is the
 * database's answer rather than a double's.
 *
 * Guards: lib/database/repositories/memories.repository.ts (countCapBreakdown)
 */

import path from 'path';

import { MemoriesRepository } from '@/lib/database/repositories/memories.repository';

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

let db: any;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE memories (id TEXT PRIMARY KEY, characterId TEXT NOT NULL, source TEXT NOT NULL, tier TEXT)`);
  const insert = db.prepare('INSERT INTO memories (id, characterId, source, tier) VALUES (?, ?, ?, ?)');
  const rows: Array<[string, string, string, string | null]> = [
    ['a1', 'char-1', 'AUTO', 'hot'],
    ['a2', 'char-1', 'AUTO', null], // legacy NULL tier reads as hot
    ['a3', 'char-1', 'AUTO', 'cold'],
    ['m1', 'char-1', 'MANUAL', 'hot'],
    ['d1', 'char-1', 'CONSOLIDATED', 'hot'],
    ['d2', 'char-1', 'CONSOLIDATED', 'cold'],
    ['x1', 'char-2', 'AUTO', 'hot'],
  ];
  for (const r of rows) insert.run(...r);
});

/** Route the repository's `rawQuery` to the real database (set per test: the config resets mocks). */
function wireRawQuery(): void {
  const manager = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock };
  manager.rawQuery.mockImplementation(async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params));
}

afterEach(() => {
  db.close();
});

describe('MemoriesRepository.countCapBreakdown (bug 210)', () => {
  it('counts hot AUTO rows as demotable and hot MANUAL rows and digests as protected', async () => {
    wireRawQuery();
    const repo = new MemoriesRepository();
    await expect(repo.countCapBreakdown('char-1')).resolves.toEqual({
      hotTotal: 4,
      demotable: 2,
      protected: 2,
      cold: 2,
    });
  });

  it('reports zeros for a character with no rows', async () => {
    wireRawQuery();
    const repo = new MemoriesRepository();
    await expect(repo.countCapBreakdown('char-none')).resolves.toEqual({
      hotTotal: 0,
      demotable: 0,
      protected: 0,
      cold: 0,
    });
  });
});
