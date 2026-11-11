/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import { SQLiteCollection } from './backend';
import { translateFilter } from './query-translator';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'lib', 'index.js')) as typeof import('better-sqlite3');

interface LLMLogFixture {
  id: string;
  userId: string;
  messageId: string | null;
  chatId: string | null;
  characterId: string | null;
}

describe('SQLite query translator null comparisons', () => {
  it('translates $eq null to IS NULL without a bound NULL parameter', () => {
    expect(translateFilter({ messageId: { $eq: null } })).toEqual({
      sql: '"messageId" IS NULL',
      params: [],
    });
  });

  it('translates $ne null to IS NOT NULL without a bound NULL parameter', () => {
    expect(translateFilter({ messageId: { $ne: null } })).toEqual({
      sql: '"messageId" IS NOT NULL',
      params: [],
    });
  });

  it('finds standalone records through the real SQLite collection path', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE "llm_logs" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "messageId" TEXT,
        "chatId" TEXT,
        "characterId" TEXT
      )
    `);

    const collection = new SQLiteCollection<LLMLogFixture>(db, 'llm_logs');
    expect(db.prepare('INSERT INTO "llm_logs" VALUES (?, ?, ?, ?, ?)').run(
      'standalone', 'user-1', null, null, null,
    ).changes).toBe(1);
    expect(db.prepare('INSERT INTO "llm_logs" VALUES (?, ?, ?, ?, ?)').run(
      'attached', 'user-1', 'message-1', null, null,
    ).changes).toBe(1);
    expect(db.prepare('INSERT INTO "llm_logs" VALUES (?, ?, ?, ?, ?)').run(
      'other-user', 'user-2', null, null, null,
    ).changes).toBe(1);

    expect(db.prepare('SELECT * FROM "llm_logs" WHERE "messageId" IS NULL').all()).toHaveLength(2);
    expect(translateFilter({
      userId: 'user-1',
      messageId: { $eq: null },
      chatId: { $eq: null },
      characterId: { $eq: null },
    })).toEqual({
      sql: '"userId" = ? AND "messageId" IS NULL AND "chatId" IS NULL AND "characterId" IS NULL',
      params: ['user-1'],
    });

    await expect(collection.find({
      userId: 'user-1',
      messageId: { $eq: null },
      chatId: { $eq: null },
      characterId: { $eq: null },
    })).resolves.toEqual([
      { id: 'standalone', userId: 'user-1', messageId: undefined, chatId: undefined, characterId: undefined },
    ]);

    db.close();
  });
});
