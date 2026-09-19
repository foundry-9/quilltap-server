/**
 * @jest-environment node
 *
 * End-to-end exercise of the `add-chat-informs-table-v1` migration against a
 * real SQLite database.
 *
 * What is worth proving here is cheap to check and expensive to discover in the
 * field: that the table carries every column the repository writes (the schema
 * drives the INSERT column list, so one missing column fails every post), that
 * the three indexes the read paths rely on exist, and that a second pass over
 * an already-migrated instance is a no-op rather than an error.
 *
 * Guards:
 *   - migrations/scripts/add-chat-informs-table.ts
 */

import path from 'path';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  sqliteTableExists: jest.fn((table: string) => {
    const db = (global as Record<string, unknown>).__testMainDb as any;
    if (!db) return false;
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    return !!row;
  }),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
}));

// The root package.json aliases better-sqlite3-multiple-ciphers as
// better-sqlite3, and the jest moduleNameMapper replaces both bare names with a
// no-op mock. Hand the migration the real binding by absolute path (which the
// mapper's `^name$` patterns don't match).
jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { addChatInformsTableMigration } from '../../../migrations/scripts/add-chat-informs-table';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

/** Every column the repository's INSERT will name, from ChatInformSchema. */
const EXPECTED_COLUMNS = [
  'id',
  'chatId',
  'batchId',
  'participantId',
  'contentMarkdown',
  'recordMessageId',
  'createdAt',
  'updatedAt',
  'consumedAt',
  'consumedByMessageId',
];

let db: any;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE "chats" ("id" TEXT PRIMARY KEY)`);
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testMainDb;
});

describe('add-chat-informs-table-v1', () => {
  it('runs on an instance without the table and skips one that has it', async () => {
    expect(await addChatInformsTableMigration.shouldRun()).toBe(true);

    await addChatInformsTableMigration.run();

    expect(await addChatInformsTableMigration.shouldRun()).toBe(false);
  });

  it('creates every column the repository writes', async () => {
    const result = await addChatInformsTableMigration.run();
    expect(result.success).toBe(true);

    const columns = db
      .prepare(`PRAGMA table_info("chat_informs")`)
      .all()
      .map((c: { name: string }) => c.name);

    for (const column of EXPECTED_COLUMNS) {
      expect(columns).toContain(column);
    }
  });

  it('creates the three indexes the read paths lean on', async () => {
    await addChatInformsTableMigration.run();

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_informs'`)
      .all()
      .map((r: { name: string }) => r.name);

    expect(indexes).toContain('idx_chat_informs_pending');
    expect(indexes).toContain('idx_chat_informs_batch');
    expect(indexes).toContain('idx_chat_informs_consumedBy');
  });

  it('is idempotent — a second pass neither throws nor duplicates anything', async () => {
    await addChatInformsTableMigration.run();
    const second = await addChatInformsTableMigration.run();

    expect(second.success).toBe(true);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_informs'`)
      .all();
    expect(tables).toHaveLength(1);
  });

  it('cascades rows away with their chat', async () => {
    await addChatInformsTableMigration.run();
    db.pragma('foreign_keys = ON');

    db.prepare(`INSERT INTO "chats" ("id") VALUES ('chat-1')`).run();
    db.prepare(
      `INSERT INTO "chat_informs"
        ("id","chatId","batchId","participantId","contentMarkdown","recordMessageId","createdAt","updatedAt","consumedAt","consumedByMessageId")
       VALUES ('row-1','chat-1','batch-1','p-1','You notice the clock has stopped.',NULL,'t','t',NULL,NULL)`
    ).run();

    db.prepare(`DELETE FROM "chats" WHERE "id" = 'chat-1'`).run();

    expect(db.prepare(`SELECT COUNT(*) AS n FROM "chat_informs"`).get().n).toBe(0);
  });
});
