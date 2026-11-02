/**
 * @jest-environment node
 *
 * reindex-chat-message-fts-character-only-v1 (#121), against a real SQLite
 * database. The pre-fix instance is reproduced by swapping the insert trigger
 * for the old rule (any USER / ASSISTANT message), so Staff whispers and
 * announcement bubbles land in the index exactly as they did before; the
 * migration must replace the trigger and drop them, leaving characters' lines.
 *
 * Guards:
 *   - migrations/scripts/reindex-chat-message-fts-character-only.ts
 *   - lib/database/backends/sqlite/chat-message-fts.ts (eligibility rule)
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

import { reindexChatMessageFtsCharacterOnlyMigration as migration } from '../../../migrations/scripts/reindex-chat-message-fts-character-only';
import { migrations } from '../../../migrations/scripts';
import { prettify, humanize } from '@/lib/startup/prettify';
import { registerTextCodecFunction } from '../../../lib/database/backends/sqlite/text-codec-function';
import {
  countIndexedChatMessages,
  ensureChatMessageFtsSchema,
  staleChatMessageFtsTriggers,
} from '../../../lib/database/backends/sqlite/chat-message-fts';

const { reportProgress } = jest.requireMock('../../../migrations/lib/progress') as {
  reportProgress: jest.Mock;
};

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

/** The insert trigger as `create-chat-message-fts-v1` first wrote it. */
const PRE_FIX_INSERT_TRIGGER = `CREATE TRIGGER "chat_messages_fts_ai" AFTER INSERT ON "chat_messages"
  WHEN new."type" = 'message' AND new."role" IN ('USER','ASSISTANT') AND new."content" IS NOT NULL
BEGIN
  INSERT INTO "chat_messages_fts_map"("messageId") VALUES (new."id");
  INSERT INTO "chat_messages_fts"(rowid, content)
    VALUES ((SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = new."id"),
            qt_text(new."content"));
END`;

let db: any;
let seq = 0;

function insert(id: string, content: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  db.prepare(
    `INSERT INTO "chat_messages"
       ("id","chatId","type","role","content","systemSender","customAnnouncer","createdAt")
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    'chat-1',
    'message',
    (extra.role as string) ?? 'ASSISTANT',
    content,
    (extra.systemSender as string) ?? null,
    (extra.customAnnouncer as string) ?? null,
    `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  );
}

const search = (match: string): string[] =>
  db
    .prepare(
      `SELECT x."messageId" AS id
         FROM "chat_messages_fts" f
         JOIN "chat_messages_fts_map" x ON x."ftsId" = f.rowid
        WHERE "chat_messages_fts" MATCH ?
        ORDER BY x."messageId"`,
    )
    .all(match)
    .map((r: { id: string }) => r.id);

/** An instance as it stood before #121: Staff rows indexed by the old trigger. */
function seedPreFixInstance() {
  ensureChatMessageFtsSchema(db);
  db.exec('DROP TRIGGER "chat_messages_fts_ai"');
  db.exec(PRE_FIX_INSERT_TRIGGER);

  insert('char-1', 'The lighthouse keeper polished the brass lamp', { role: 'ASSISTANT' });
  insert('user-1', 'Tell me about the lighthouse', { role: 'USER' });
  insert('staff-1', 'Recalled: the lighthouse burned in the storm', {
    systemSender: 'commonplaceBook',
  });
  insert('staff-2', 'The Host announces the lighthouse scene', { systemSender: 'host' });
  insert('bubble-1', 'A herald cries of the lighthouse', { customAnnouncer: 'Herald' });
}

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  db = new Database(':memory:');
  registerTextCodecFunction(db);
  db.exec(`
    CREATE TABLE "chat_messages" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "type" TEXT DEFAULT 'message',
      "role" TEXT,
      "content" TEXT,
      "systemSender" TEXT DEFAULT NULL,
      "customAnnouncer" TEXT DEFAULT NULL,
      "createdAt" TEXT NOT NULL
    );
  `);
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => {
  db?.close();
  delete (global as Record<string, unknown>).__testMainDb;
});

describe('reindex-chat-message-fts-character-only-v1', () => {
  it('is registered and labelled for the loading screen', () => {
    expect(migrations).toContain(migration);
    expect(prettify(migration.id)).not.toBe(humanize(migration.id));
  });

  it('reproduces the bug: the pre-fix index returns Staff rows', () => {
    seedPreFixInstance();
    expect(search('lighthouse')).toEqual(['bubble-1', 'char-1', 'staff-1', 'staff-2', 'user-1']);
  });

  it('runs on a pre-fix instance and drops Staff and announcement rows from search', async () => {
    seedPreFixInstance();
    expect(staleChatMessageFtsTriggers(db)).toContain('chat_messages_fts_ai');
    await expect(migration.shouldRun()).resolves.toBe(true);

    const result = await migration.run();

    expect(result).toMatchObject({ success: true, itemsAffected: 3 });
    expect(search('lighthouse')).toEqual(['char-1', 'user-1']);
    expect(countIndexedChatMessages(db)).toBe(2);
    expect(staleChatMessageFtsTriggers(db)).toEqual([]);
    expect(reportProgress).toHaveBeenCalledWith(2, 2, 'messages');
  });

  it('leaves the replaced trigger keeping new Staff rows out', async () => {
    seedPreFixInstance();
    await migration.run();

    insert('staff-3', 'Prospero notes the lighthouse tool', { systemSender: 'prospero' });
    insert('char-2', 'The lighthouse beam swept the bay');

    expect(search('lighthouse')).toEqual(['char-1', 'char-2', 'user-1']);
  });

  it('has nothing to do once it has run', async () => {
    seedPreFixInstance();
    await migration.run();
    await expect(migration.shouldRun()).resolves.toBe(false);
  });

  it('does not run on an instance already indexed under the new rule', async () => {
    ensureChatMessageFtsSchema(db);
    insert('char-1', 'Only a character speaks here');
    insert('staff-1', 'A whisper', { systemSender: 'commonplaceBook' });
    await expect(migration.shouldRun()).resolves.toBe(false);
  });
});
