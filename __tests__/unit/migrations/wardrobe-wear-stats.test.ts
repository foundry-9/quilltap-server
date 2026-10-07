/**
 * @jest-environment node
 *
 * The wear ledger's two migrations against a real SQLite database: the table
 * (with its COALESCE unique index) and the one-time seed from every chat's
 * current equipped outfits.
 *
 * Guards:
 *   - migrations/scripts/add-wardrobe-wear-stats-table-v1.ts
 *   - migrations/scripts/seed-wardrobe-wear-stats-v1.ts
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

import { addWardrobeWearStatsTableMigration } from '../../../migrations/scripts/add-wardrobe-wear-stats-table-v1';
import {
  seedWardrobeWearStatsMigration,
  wearsFromEquippedOutfit,
} from '../../../migrations/scripts/seed-wardrobe-wear-stats-v1';

const { reportProgress } = jest.requireMock('../../../migrations/lib/progress') as { reportProgress: jest.Mock };

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const CHAR_A = '11111111-1111-4111-8111-111111111111';
const CHAR_B = '22222222-2222-4222-8222-222222222222';

describe('wardrobe wear ledger migrations', () => {
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

  it('creates the table once, with a unique index that folds NULL wearers together', async () => {
    expect(await addWardrobeWearStatsTableMigration.shouldRun()).toBe(true);
    const result = await addWardrobeWearStatsTableMigration.run();
    expect(result.success).toBe(true);
    expect(await addWardrobeWearStatsTableMigration.shouldRun()).toBe(false);

    const insert = db.prepare(
      `INSERT INTO "wardrobe_wear_stats" VALUES (?, 'coat', NULL, 1, 'x', 'x', NULL, 'x', 'x')`,
    );
    insert.run('a');
    expect(() => insert.run('b')).toThrow(/UNIQUE/);
  });

  it('seeds one wear per (chat × character × item), dated by the chat', async () => {
    await addWardrobeWearStatsTableMigration.run();

    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run(
      'chat-1',
      '2026-01-01T00:00:00.000Z',
      JSON.stringify({
        [CHAR_A]: { top: ['coat', 'shirt'], bottom: ['slacks'], footwear: [], accessories: [] },
        [CHAR_B]: { top: ['coat'] },
      }),
    );
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run(
      'chat-2',
      '2026-03-01T00:00:00.000Z',
      JSON.stringify({ [CHAR_A]: { top: ['coat'], accessories: ['coat'] } }),
    );
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run('chat-3', '2026-04-01T00:00:00.000Z', null);
    db.prepare(`INSERT INTO "chats" VALUES (?, ?, ?)`).run('chat-4', '2026-04-01T00:00:00.000Z', 'not json');

    expect(await seedWardrobeWearStatsMigration.shouldRun()).toBe(true);
    const result = await seedWardrobeWearStatsMigration.run();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(5);

    const rows = db
      .prepare(`SELECT "itemId", "wearerCharacterId", "wearCount", "firstWornAt", "lastWornAt", "lastWornChatId" FROM "wardrobe_wear_stats"`)
      .all();
    const coatA = rows.find((r: any) => r.itemId === 'coat' && r.wearerCharacterId === CHAR_A);
    // Two chats share the coat: incremented, last worn moved to the later chat.
    // The same id in two slots of one chat is one wear.
    expect(coatA).toEqual({
      itemId: 'coat',
      wearerCharacterId: CHAR_A,
      wearCount: 2,
      firstWornAt: '2026-01-01T00:00:00.000Z',
      lastWornAt: '2026-03-01T00:00:00.000Z',
      lastWornChatId: 'chat-2',
    });
    expect(rows.find((r: any) => r.itemId === 'coat' && r.wearerCharacterId === CHAR_B)).toMatchObject({ wearCount: 1 });
    expect(rows).toHaveLength(4);
    expect(reportProgress).toHaveBeenLastCalledWith(3, 3, 'chats');
  });

  it('reads legacy rows that lack slots', () => {
    expect(wearsFromEquippedOutfit(JSON.stringify({ [CHAR_A]: { top: ['x'] } }))).toEqual([
      { characterId: CHAR_A, itemId: 'x' },
    ]);
    expect(wearsFromEquippedOutfit(null)).toEqual([]);
    expect(wearsFromEquippedOutfit('[]')).toEqual([]);
  });
});
