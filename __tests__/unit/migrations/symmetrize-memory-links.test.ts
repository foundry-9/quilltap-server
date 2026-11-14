/**
 * @jest-environment node
 *
 * symmetrize-memory-links-v1 — gives every one-way link between two of a
 * holder's memories its missing other side (refactor 4.13, A9). Real SQLite.
 */

import path from 'path';

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/database-utils', () => {
  const db = () => (global as Record<string, unknown>).__testMainDb as any;
  const columnExists = (table: string, column: string) =>
    db()
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .some((c: { name: string }) => c.name === column);
  return {
    isSQLiteBackend: jest.fn(() => true),
    getSQLiteDatabase: jest.fn(() => db()),
    sqliteTableExists: jest.fn(
      (table: string) =>
        !!db().prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table),
    ),
    sqliteColumnExists: jest.fn(columnExists),
  };
});

import {
  missingReverseLinks,
  symmetrizeMemoryLinksMigration as migration,
} from '../../../migrations/scripts/symmetrize-memory-links-v1';
import { migrations } from '../../../migrations/scripts';
import { prettify, humanize } from '@/lib/startup/prettify';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

let db: any;

function seed(rows: Array<{ id: string; characterId?: string; links: string[] | string | null }>) {
  const insert = db.prepare(
    `INSERT INTO "memories" ("id","characterId","relatedMemoryIds","updatedAt") VALUES (?,?,?,'2026-01-01T00:00:00.000Z')`,
  );
  for (const r of rows) {
    insert.run(r.id, r.characterId ?? 'c1', Array.isArray(r.links) ? JSON.stringify(r.links) : r.links);
  }
}

const links = (id: string) =>
  JSON.parse((db.prepare(`SELECT "relatedMemoryIds" AS l FROM "memories" WHERE "id" = ?`).get(id) as { l: string }).l ?? '[]');

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE "memories" ("id" TEXT PRIMARY KEY, "characterId" TEXT, "relatedMemoryIds" TEXT, "updatedAt" TEXT)`);
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testMainDb;
});

describe('symmetrize-memory-links-v1', () => {
  it('is registered and labelled for the loading screen', () => {
    expect(migrations).toContain(migration);
    expect(prettify(migration.id)).not.toBe(humanize(migration.id));
  });

  it('adds the missing reverse side and leaves two-way links alone', async () => {
    seed([
      { id: 'digest', links: ['a', 'b'] }, // a links back; b does not
      { id: 'a', links: ['digest'] },
      { id: 'b', links: ['x'] },
      { id: 'x', links: ['b'] },
    ]);
    const result = await migration.run();
    expect(result).toMatchObject({ success: true, itemsAffected: 1 });
    expect(links('b')).toEqual(['x', 'digest']);
    expect(links('a')).toEqual(['digest']);
    expect(links('digest')).toEqual(['a', 'b']);
  });

  it('never crosses holders, never links to a missing row, never removes', async () => {
    seed([
      { id: 'mine', links: ['theirs', 'gone', 'mine'] },
      { id: 'theirs', characterId: 'c2', links: [] },
      { id: 'garbage', links: 'not json' },
      { id: 'empty', links: null },
    ]);
    const result = await migration.run();
    expect(result).toMatchObject({ success: true, itemsAffected: 0 });
    expect(links('theirs')).toEqual([]);
    expect(links('mine')).toEqual(['theirs', 'gone', 'mine']);
  });

  it('is idempotent', async () => {
    seed([
      { id: 'p', links: ['q', 'r'] },
      { id: 'q', links: [] },
      { id: 'r', links: [] },
    ]);
    await migration.run();
    const again = await migration.run();
    expect(again).toMatchObject({ success: true, itemsAffected: 0 });
    expect(links('q')).toEqual(['p']);
    expect(links('r')).toEqual(['p']);
  });

  it('collects every naming row once per target', () => {
    const out = missingReverseLinks([
      { id: 't', characterId: 'c', links: [] },
      { id: 'u', characterId: 'c', links: ['t', 't'] },
      { id: 'v', characterId: 'c', links: ['t'] },
    ]);
    expect(out).toEqual(new Map([['t', ['u', 'v']]]));
  });

  it('does not run without a memories table', async () => {
    db.exec(`DROP TABLE "memories"`);
    await expect(migration.shouldRun()).resolves.toBe(false);
  });
});
