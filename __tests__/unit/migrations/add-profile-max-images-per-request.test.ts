/**
 * @jest-environment node
 *
 * add-profile-max-images-per-request-v1 — adds
 * `connection_profiles.maxImagesPerRequest` and backfills existing rows to the
 * documented default of 4, idempotently. Real SQLite, so the backfill UPDATE
 * is exercised rather than mocked.
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
    addColumnIfMissing: jest.fn((table: string, column: string, def: string) => {
      if (columnExists(table, column)) return false;
      db().exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${def}`);
      return true;
    }),
  };
});

import { addProfileMaxImagesPerRequestMigration as migration } from '../../../migrations/scripts/add-profile-max-images-per-request-v1';
import { migrations } from '../../../migrations/scripts';
import { prettify, humanize } from '@/lib/startup/prettify';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

let db: any;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE "connection_profiles" ("id" TEXT PRIMARY KEY, "name" TEXT)`);
  db.prepare(`INSERT INTO "connection_profiles" ("id","name") VALUES (?,?), (?,?)`).run(
    'p1',
    'Vision',
    'p2',
    'Text',
  );
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testMainDb;
});

const caps = () =>
  db
    .prepare(`SELECT "id", "maxImagesPerRequest" AS cap FROM "connection_profiles" ORDER BY "id"`)
    .all();

describe('add-profile-max-images-per-request-v1', () => {
  it('is registered and labelled for the loading screen', () => {
    expect(migrations).toContain(migration);
    expect(prettify(migration.id)).not.toBe(humanize(migration.id));
  });

  it('adds the column and backfills every existing profile to 4', async () => {
    await expect(migration.shouldRun()).resolves.toBe(true);
    const result = await migration.run();

    expect(result.success).toBe(true);
    expect(caps()).toEqual([
      { id: 'p1', cap: 4 },
      { id: 'p2', cap: 4 },
    ]);
  });

  it('gives a profile inserted afterwards the default of 4', async () => {
    await migration.run();
    db.prepare(`INSERT INTO "connection_profiles" ("id","name") VALUES ('p3','New')`).run();
    expect(caps()).toContainEqual({ id: 'p3', cap: 4 });
  });

  it('has nothing to do once it has run, and a rerun keeps chosen caps', async () => {
    await migration.run();
    await expect(migration.shouldRun()).resolves.toBe(false);

    db.prepare(`UPDATE "connection_profiles" SET "maxImagesPerRequest" = 10 WHERE "id" = 'p1'`).run();
    const again = await migration.run();
    expect(again).toMatchObject({ success: true, itemsAffected: 0 });
    expect(caps()).toContainEqual({ id: 'p1', cap: 10 });
  });

  it('does not run without a connection_profiles table', async () => {
    db.exec(`DROP TABLE "connection_profiles"`);
    await expect(migration.shouldRun()).resolves.toBe(false);
  });
});
