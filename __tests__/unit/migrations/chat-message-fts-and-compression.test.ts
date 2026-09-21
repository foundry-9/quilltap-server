/**
 * @jest-environment node
 *
 * The two migrations that make message search an index probe and the
 * transcript smaller, run in sequence against a real SQLite database.
 *
 * The thing worth proving here is the interaction between them, which is the
 * whole reason the pair is safe: `compress-chat-message-text-v1` rewrites the
 * ENCODING of every row in a table that is watched by FTS triggers, and the
 * update trigger's decoded-text guard is what keeps that from deleting and
 * re-tokenizing the entire index for nothing. If that guard ever regressed,
 * these tests would still pass on correctness and fail here on identity —
 * which is precisely the signal wanted.
 *
 * Guards:
 *   - migrations/scripts/create-chat-message-fts.ts
 *   - migrations/scripts/compress-chat-message-text.ts
 *   - lib/database/backends/sqlite/chat-message-fts.ts
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

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  sqliteTableExists: jest.fn(() => true),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
}));

import { createChatMessageFtsMigration } from '../../../migrations/scripts/create-chat-message-fts';
import { compressChatMessageTextMigration } from '../../../migrations/scripts/compress-chat-message-text';
import { registerTextCodecFunction } from '../../../lib/database/backends/sqlite/text-codec-function';
import { isCompressedTextBlob } from '../../../lib/database/text-compression';
import {
  countIndexedChatMessages,
  missingChatMessageFtsObjects,
} from '../../../lib/database/backends/sqlite/chat-message-fts';

const { reportProgress } = jest.requireMock('../../../migrations/lib/progress') as {
  reportProgress: jest.Mock;
};

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

/** Comfortably over the 512-byte compression floor. */
const LONG = 'The djinn walked to the café in Istanbul and told the estate all about it. '.repeat(
  12,
);

let db: any;

function insert(id: string, i: number, extra: Record<string, unknown> = {}) {
  db.prepare(
    `INSERT INTO "chat_messages"
       ("id","chatId","type","role","content","opaqueContent","description","context","createdAt")
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    'chat-1',
    (extra.type as string) ?? 'message',
    (extra.role as string) ?? 'USER',
    extra.content === undefined ? `${LONG} interchange ${i}` : extra.content,
    (extra.opaqueContent as string) ?? null,
    (extra.description as string) ?? null,
    (extra.context as string) ?? null,
    `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
  );
}

const search = (match: string): string[] =>
  db
    .prepare(
      `SELECT m."id" AS id
         FROM "chat_messages_fts" f
         JOIN "chat_messages_fts_map" x ON x."ftsId" = f.rowid
         JOIN "chat_messages" m         ON m."id" = x."messageId"
        WHERE "chat_messages_fts" MATCH ?`,
    )
    .all(match)
    .map((r: { id: string }) => r.id);

const rawContent = (id: string) =>
  db.prepare('SELECT "content" FROM "chat_messages" WHERE "id" = ?').get(id).content;

beforeEach(() => {
  jest.clearAllMocks();
  db = new Database(':memory:');
  registerTextCodecFunction(db);
  db.exec(`
    CREATE TABLE "chat_messages" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "type" TEXT DEFAULT 'message',
      "role" TEXT,
      "content" TEXT,
      "opaqueContent" TEXT,
      "description" TEXT,
      "context" TEXT,
      "createdAt" TEXT NOT NULL
    );
  `);
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testMainDb;
});

describe('create-chat-message-fts-v1', () => {
  it('runs on a database that has never had the index', async () => {
    insert('msg-01', 1);
    await expect(createChatMessageFtsMigration.shouldRun()).resolves.toBe(true);

    const result = await createChatMessageFtsMigration.run();
    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(1);
    expect(missingChatMessageFtsObjects(db)).toEqual([]);
    expect(search('"istanbul"*')).toEqual(['msg-01']);
  });

  it('indexes only the rows search would ever return', async () => {
    insert('msg-01', 1);
    insert('msg-02', 2, { type: 'system' });
    insert('msg-03', 3, { role: 'SYSTEM' });
    insert('msg-04', 4, { content: null });

    await createChatMessageFtsMigration.run();
    expect(countIndexedChatMessages(db)).toBe(1);
  });

  it('reports progress so the loading screen can describe it', async () => {
    for (let i = 1; i <= 4; i++) insert(`msg-0${i}`, i);
    await createChatMessageFtsMigration.run();
    expect(reportProgress).toHaveBeenCalledWith(4, 4, 'messages');
  });

  it('has nothing to do once it has run', async () => {
    insert('msg-01', 1);
    await createChatMessageFtsMigration.run();
    await expect(createChatMessageFtsMigration.shouldRun()).resolves.toBe(false);
  });
});

describe('compress-chat-message-text-v1', () => {
  beforeEach(async () => {
    insert('msg-01', 1, { opaqueContent: LONG, description: LONG, context: LONG });
    insert('msg-02', 2, { content: 'too short to bother compressing' });
    insert('msg-03', 3);
    await createChatMessageFtsMigration.run();
  });

  it('compresses the long values and leaves the short ones alone', async () => {
    await expect(compressChatMessageTextMigration.shouldRun()).resolves.toBe(true);
    const result = await compressChatMessageTextMigration.run();
    expect(result.success).toBe(true);

    expect(isCompressedTextBlob(rawContent('msg-01'))).toBe(true);
    expect(isCompressedTextBlob(rawContent('msg-03'))).toBe(true);
    expect(rawContent('msg-02')).toBe('too short to bother compressing');

    const row = db.prepare('SELECT * FROM "chat_messages" WHERE "id" = ?').get('msg-01');
    for (const col of ['opaqueContent', 'description', 'context']) {
      expect(isCompressedTextBlob(row[col])).toBe(true);
    }
  });

  it('round-trips the text exactly — encoding changes, meaning does not', async () => {
    const before = db
      .prepare('SELECT "id", qt_text("content") AS t FROM "chat_messages" ORDER BY "id"')
      .all();
    await compressChatMessageTextMigration.run();
    const after = db
      .prepare('SELECT "id", qt_text("content") AS t FROM "chat_messages" ORDER BY "id"')
      .all();
    expect(after).toEqual(before);
  });

  it('leaves the search index untouched — the same entries, not rebuilt ones', async () => {
    const before = db
      .prepare('SELECT "ftsId", "messageId" FROM "chat_messages_fts_map" ORDER BY "messageId"')
      .all();
    expect(search('"istanbul"*').sort()).toEqual(['msg-01', 'msg-03']);

    await compressChatMessageTextMigration.run();

    // Same rowids: the update trigger compared DECODED text and did nothing.
    expect(
      db
        .prepare('SELECT "ftsId", "messageId" FROM "chat_messages_fts_map" ORDER BY "messageId"')
        .all(),
    ).toEqual(before);
    expect(search('"istanbul"*').sort()).toEqual(['msg-01', 'msg-03']);
  });

  it('is idempotent and resumable — a second pass rewrites nothing', async () => {
    const first = await compressChatMessageTextMigration.run();
    expect(first.itemsAffected).toBeGreaterThan(0);

    await expect(compressChatMessageTextMigration.shouldRun()).resolves.toBe(false);

    const second = await compressChatMessageTextMigration.run();
    expect(second.itemsAffected).toBe(0);
  });

  it('still indexes a NEW message written after the table was compressed', async () => {
    await compressChatMessageTextMigration.run();
    insert('msg-04', 4, { content: `${LONG} a fresh remark about zebras` });
    expect(search('"zebra"*')).toEqual(['msg-04']);
  });

  it('reports progress so the loading screen can describe it', async () => {
    await compressChatMessageTextMigration.run();
    expect(reportProgress).toHaveBeenCalledWith(3, 3, 'messages');
  });

  it('declares the FTS migration as a dependency, so the order cannot slip', () => {
    expect(compressChatMessageTextMigration.dependsOn).toContain('create-chat-message-fts-v1');
  });
});
