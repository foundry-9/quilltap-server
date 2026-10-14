/**
 * The chat-message FTS5 index, against a real SQLite connection.
 *
 * What matters here is the PLUMBING the triggers do, which no amount of mock
 * can stand in for: that an insert indexes, a delete retires, a genuine edit
 * retokenizes, a RE-ENCODE (the compression backfill) does not, and that the
 * eligibility filter keeps the index to the rows search will ever return.
 *
 * The DDL strings are snapshotted so a drift is loud.
 *
 * @jest-environment node
 */

import path from 'path'
import {
  CHAT_MESSAGE_FTS_SCHEMA_STATEMENTS,
  chatMessageFtsEligibilitySql,
  chatMessageFtsObjectNames,
  countEligibleChatMessages,
  countIndexedChatMessages,
  ensureChatMessageFtsSchema,
  missingChatMessageFtsObjects,
  rebuildChatMessageFtsIndex,
} from '@/lib/database/backends/sqlite/chat-message-fts'
import { registerTextCodecFunction } from '@/lib/database/backends/sqlite/text-codec-function'
import { textToBlob } from '@/lib/database/text-compression'

// Real binding by absolute root path — a bare or nested require resolves to
// the jest mock, which returns empty result sets.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

/** Long enough that `textToBlob` actually compresses it. */
const LONG = 'The djinn walked to the café in Istanbul, and said so at length. '.repeat(20)

const CREATE_CHAT_MESSAGES = `
  CREATE TABLE "chat_messages" (
    "id" TEXT PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "type" TEXT DEFAULT 'message',
    "role" TEXT,
    "content" TEXT,
    "createdAt" TEXT NOT NULL
  )
`

describe('chat message FTS', () => {
  let db: any

  const insert = (
    id: string,
    content: unknown,
    overrides: { type?: string; role?: string | null; chatId?: string } = {},
  ) =>
    db
      .prepare(
        'INSERT INTO "chat_messages" ("id","chatId","type","role","content","createdAt") VALUES (?,?,?,?,?,?)',
      )
      .run(
        id,
        overrides.chatId ?? 'chat-1',
        overrides.type ?? 'message',
        overrides.role === undefined ? 'USER' : overrides.role,
        content,
        `2026-01-01T00:00:${id.slice(-2).padStart(2, '0')}.000Z`,
      )

  const search = (match: string): string[] =>
    db
      .prepare(
        `SELECT m."id" AS id
           FROM "chat_messages_fts" f
           JOIN "chat_messages_fts_map" x ON x."ftsId" = f.rowid
           JOIN "chat_messages" m         ON m."id" = x."messageId"
          WHERE "chat_messages_fts" MATCH ?
          ORDER BY m."createdAt" DESC`,
      )
      .all(match)
      .map((r: { id: string }) => r.id)

  beforeEach(() => {
    db = new Database(':memory:')
    registerTextCodecFunction(db)
    db.exec(CREATE_CHAT_MESSAGES)
    ensureChatMessageFtsSchema(db)
  })

  afterEach(() => db?.close())

  it('is a no-op when replayed on a healthy database', () => {
    expect(missingChatMessageFtsObjects(db)).toEqual([])
    ensureChatMessageFtsSchema(db)
    expect(missingChatMessageFtsObjects(db)).toEqual([])
  })

  it('reports exactly which objects are missing', () => {
    db.exec('DROP TRIGGER "chat_messages_fts_au"')
    expect(missingChatMessageFtsObjects(db)).toEqual(['chat_messages_fts_au'])
    ensureChatMessageFtsSchema(db)
    expect(missingChatMessageFtsObjects(db)).toEqual([])
  })

  it('indexes an eligible message on insert', () => {
    insert('msg-01', 'The djinn walked to the estate')
    expect(countIndexedChatMessages(db)).toBe(1)
    expect(search('"djinn"*')).toEqual(['msg-01'])
  })

  it('matches word prefixes, which is what replaces LIKE substring matching', () => {
    insert('msg-01', 'she was walking home')
    expect(search('"walk"*')).toEqual(['msg-01'])
  })

  it('folds diacritics, so café and cafe find each other', () => {
    insert('msg-01', 'a café in Istanbul')
    expect(search('"cafe"*')).toEqual(['msg-01'])
    insert('msg-02', 'a cafe in Ankara')
    expect(search('"café"*').sort()).toEqual(['msg-01', 'msg-02'])
  })

  it('skips ineligible rows — events, other roles and null content', () => {
    insert('msg-01', 'eligible prose')
    insert('msg-02', 'a system event', { type: 'system' })
    insert('msg-03', 'a staff aside', { role: 'SYSTEM' })
    insert('msg-04', null)

    expect(countEligibleChatMessages(db)).toBe(1)
    expect(countIndexedChatMessages(db)).toBe(1)
    expect(search('"prose"*')).toEqual(['msg-01'])
    expect(search('"event"*')).toEqual([])
    expect(search('"aside"*')).toEqual([])
  })

  it('retires the old terms when the text genuinely changes', () => {
    insert('msg-01', 'about zebras')
    db.prepare('UPDATE "chat_messages" SET "content" = ? WHERE "id" = ?').run('about llamas', 'msg-01')
    expect(search('"zebra"*')).toEqual([])
    expect(search('"llama"*')).toEqual(['msg-01'])
  })

  it('leaves the index alone when only the ENCODING changes', () => {
    insert('msg-01', LONG)
    const before = db
      .prepare('SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = ?')
      .get('msg-01')

    const blob = textToBlob(LONG)
    expect(Buffer.isBuffer(blob)).toBe(true)
    db.prepare('UPDATE "chat_messages" SET "content" = ? WHERE "id" = ?').run(blob, 'msg-01')

    // Same index entry, still findable, and the stored value is now a BLOB.
    expect(
      db.prepare('SELECT "ftsId" FROM "chat_messages_fts_map" WHERE "messageId" = ?').get('msg-01'),
    ).toEqual(before)
    expect(search('"cafe"*')).toEqual(['msg-01'])
    expect(
      Buffer.isBuffer(db.prepare('SELECT "content" FROM "chat_messages" WHERE "id" = ?').get('msg-01').content),
    ).toBe(true)
  })

  it('indexes a message written straight in as a compressed BLOB', () => {
    insert('msg-01', textToBlob(LONG))
    expect(search('"istanbul"*')).toEqual(['msg-01'])
  })

  it('retires the entry and the map row on delete', () => {
    insert('msg-01', 'about zebras')
    db.prepare('DELETE FROM "chat_messages" WHERE "id" = ?').run('msg-01')
    expect(search('"zebra"*')).toEqual([])
    expect(countIndexedChatMessages(db)).toBe(0)
  })

  it('survives a message id being reused after its row was deleted', () => {
    insert('msg-01', 'about zebras')
    db.prepare('DELETE FROM "chat_messages" WHERE "id" = ?').run('msg-01')
    insert('msg-01', 'about llamas')
    expect(search('"zebra"*')).toEqual([])
    expect(search('"llama"*')).toEqual(['msg-01'])
  })

  it('keeps the map in step with a restore-shaped run of plain inserts', () => {
    // Backup restore writes every message through the repository, which is a
    // plain INSERT — the same path this trigger watches. After it, the map must
    // hold exactly the eligible rows.
    for (let i = 1; i <= 25; i++) {
      const id = `msg-${String(i).padStart(2, '0')}`
      if (i % 5 === 0) insert(id, 'a system event', { type: 'system' })
      else insert(id, `interchange number ${i} concerning the estate`)
    }
    expect(countEligibleChatMessages(db)).toBe(20)
    expect(countIndexedChatMessages(db)).toBe(20)
    expect(search('"estate"*')).toHaveLength(20)
  })

  describe('rebuildChatMessageFtsIndex', () => {
    it('repopulates the index from the base table', () => {
      insert('msg-01', 'the first interchange')
      insert('msg-02', textToBlob(LONG))
      insert('msg-03', 'a system event', { type: 'system' })

      // Simulate the damage a table rebuild does: the index is left behind.
      db.exec('DELETE FROM "chat_messages_fts"')
      db.exec('DELETE FROM "chat_messages_fts_map"')
      expect(search('"interchange"*')).toEqual([])

      const result = rebuildChatMessageFtsIndex(db)
      expect(result).toMatchObject({ scanned: 2, indexed: 2, total: 2 })
      expect(search('"interchange"*')).toEqual(['msg-01'])
      expect(search('"istanbul"*')).toEqual(['msg-02'])
      expect(countIndexedChatMessages(db)).toBe(2)
    })

    it('reports progress per batch', () => {
      for (let i = 1; i <= 8; i++) insert(`msg-${String(i).padStart(2, '0')}`, `line ${i}`)
      const onProgress = jest.fn()
      rebuildChatMessageFtsIndex(db, onProgress)
      expect(onProgress).toHaveBeenCalledWith(8, 8)
    })

    it('is idempotent — a second rebuild leaves the same index', () => {
      for (let i = 1; i <= 5; i++) insert(`msg-${String(i).padStart(2, '0')}`, `estate ${i}`)
      rebuildChatMessageFtsIndex(db)
      const first = search('"estate"*')
      rebuildChatMessageFtsIndex(db)
      expect(search('"estate"*')).toEqual(first)
      expect(countIndexedChatMessages(db)).toBe(5)
    })
  })

  it('fails the write LOUDLY on a connection that never registered qt_text', () => {
    // The desired failure mode: a connection missing the codec cannot write to
    // chat_messages at all, rather than quietly letting the index drift.
    const bare = new Database(':memory:')
    try {
      bare.exec(CREATE_CHAT_MESSAGES)
      ensureChatMessageFtsSchema(bare)
      expect(() =>
        bare
          .prepare(
            'INSERT INTO "chat_messages" ("id","chatId","type","role","content","createdAt") VALUES (?,?,?,?,?,?)',
          )
          .run('msg-01', 'chat-1', 'message', 'USER', 'prose', '2026-01-01T00:00:00.000Z'),
      ).toThrow(/no such function: qt_text/)
    } finally {
      bare.close()
    }
  })
})

describe('DDL is single-sourced', () => {
  it('names every object it creates', () => {
    expect(chatMessageFtsObjectNames()).toEqual([
      'chat_messages_fts_map',
      'chat_messages_fts',
      'chat_messages_fts_ai',
      'chat_messages_fts_ad',
      'chat_messages_fts_au',
    ])
  })

  it('applies the same eligibility filter everywhere', () => {
    expect(chatMessageFtsEligibilitySql()).toBe(
      `"type" = 'message' AND "role" IN ('USER','ASSISTANT') AND "content" IS NOT NULL`,
    )
    expect(chatMessageFtsEligibilitySql('m')).toBe(
      `m."type" = 'message' AND m."role" IN ('USER','ASSISTANT') AND m."content" IS NOT NULL`,
    )
  })

  it('matches its snapshot', () => {
    expect(CHAT_MESSAGE_FTS_SCHEMA_STATEMENTS).toMatchSnapshot()
  })
})
