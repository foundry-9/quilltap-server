/**
 * @jest-environment node
 *
 * The outfit history's two migrations against a real SQLite database: the
 * table (with its two unique indexes) and the one-time seed of a current
 * entry 0 per (chat, character) from every chat's equipped outfits.
 *
 * Guards:
 *   - migrations/scripts/add-chat-wardrobe-history-table-v1.ts
 *   - migrations/scripts/seed-chat-wardrobe-history-v1.ts
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
  sqliteTableExists: jest.fn((table: string) => {
    const db = (global as Record<string, unknown>).__testMainDb as any;
    if (!db) return false;
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  }),
  getSQLiteTableColumns: jest.fn((table: string) => {
    const db = (global as Record<string, unknown>).__testMainDb as any;
    return db.prepare(`PRAGMA table_info("${table}")`).all();
  }),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
}));

jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { addChatWardrobeHistoryTableMigration } from '../../../migrations/scripts/add-chat-wardrobe-history-table-v1';
import {
  seedChatWardrobeHistoryMigration,
  outfitsFromEquippedOutfit,
} from '../../../migrations/scripts/seed-chat-wardrobe-history-v1';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';

const { reportProgress } = jest.requireMock('../../../migrations/lib/progress') as { reportProgress: jest.Mock };

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const CHAR_A = '11111111-1111-4111-8111-111111111111';
const CHAR_B = '22222222-2222-4222-8222-222222222222';

describe('chat wardrobe history migrations', () => {
  let db: any;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new Database(':memory:');
    (global as Record<string, unknown>).__testMainDb = db;
    db.exec(`CREATE TABLE "chats" ("id" TEXT PRIMARY KEY, "updatedAt" TEXT NOT NULL, "equippedOutfit" TEXT)`);
  });

  afterEach(() => {
    db.close();
    delete (global as Record<string, unknown>).__testMainDb;
  });

  it('creates the table once, with unique indices and one cursor per timeline', async () => {
    expect(await addChatWardrobeHistoryTableMigration.shouldRun()).toBe(true);
    const result = await addChatWardrobeHistoryTableMigration.run();
    expect(result.success).toBe(true);
    expect(await addChatWardrobeHistoryTableMigration.shouldRun()).toBe(false);

    db.prepare(`INSERT INTO "chats" VALUES ('chat-1', 'x', NULL)`).run();
    const insert = db.prepare(
      `INSERT INTO "chat_wardrobe_history" VALUES (?, 'chat-1', 'char', ?, '{}', 'h', 'seeded', NULL, ?, 'x')`,
    );
    insert.run('a', 0, 1);
    expect(() => insert.run('b', 0, 0)).toThrow(/UNIQUE/);
    expect(() => insert.run('c', 1, 1)).toThrow(/UNIQUE/);
    insert.run('d', 1, 0);
  });

  it('seeds one current entry 0 per (chat, character), dated by the chat', async () => {
    await addChatWardrobeHistoryTableMigration.run();

    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run(
      'chat-1',
      '2026-01-01T00:00:00.000Z',
      JSON.stringify({
        [CHAR_A]: { top: ['coat', 'shirt'], bottom: ['slacks'], footwear: [], accessories: [] },
        [CHAR_B]: {},
      }),
    );
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run(
      'chat-2',
      '2026-03-01T00:00:00.000Z',
      JSON.stringify({ [CHAR_A]: { top: ['coat'] } }),
    );
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run('chat-3', '2026-04-01T00:00:00.000Z', null);
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run('chat-4', '2026-04-01T00:00:00.000Z', 'not json');

    expect(await seedChatWardrobeHistoryMigration.shouldRun()).toBe(true);
    const result = await seedChatWardrobeHistoryMigration.run();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(3);

    const rows = db.prepare(`SELECT * FROM "chat_wardrobe_history" ORDER BY "chatId", "characterId"`).all();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.entryIndex).toBe(0);
      expect(row.isCurrent).toBe(1);
      expect(row.source).toBe('seeded');
      expect(row.actorCharacterId).toBeNull();
      expect(row.slotsHash).toBe(hashEquippedSlots(JSON.parse(row.slots)));
    }
    const a1 = rows.find((r: any) => r.chatId === 'chat-1' && r.characterId === CHAR_A);
    expect(JSON.parse(a1.slots)).toEqual({ top: ['coat', 'shirt'], bottom: ['slacks'], footwear: [], accessories: [], hair: [] });
    expect(a1.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(reportProgress).toHaveBeenLastCalledWith(3, 3, 'chats');
  });

  it('skips a pair that already has rows', async () => {
    await addChatWardrobeHistoryTableMigration.run();
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run('chat-1', 'x', JSON.stringify({ [CHAR_A]: { top: ['coat'] } }));
    await seedChatWardrobeHistoryMigration.run();
    const again = await seedChatWardrobeHistoryMigration.run();
    expect(again.itemsAffected).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "chat_wardrobe_history"`).get().n).toBe(1);
  });

  it('reads legacy and malformed outfit maps', () => {
    expect(outfitsFromEquippedOutfit(JSON.stringify({ [CHAR_A]: { top: ['x'] } }))).toEqual([
      { characterId: CHAR_A, slots: { top: ['x'], bottom: [], footwear: [], accessories: [], hair: [] } },
    ]);
    expect(outfitsFromEquippedOutfit(null)).toEqual([]);
    expect(outfitsFromEquippedOutfit('[]')).toEqual([]);
    expect(outfitsFromEquippedOutfit('nope')).toEqual([]);
  });
});
