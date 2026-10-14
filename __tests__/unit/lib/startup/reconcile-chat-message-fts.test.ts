/**
 * The startup guard for the chat-message search index.
 *
 * A table rebuild of `chat_messages` drops the triggers silently, which is the
 * one failure mode in the design that raises no error. These tests drive the
 * guard against a REAL SQLite connection so that "the triggers came back and
 * the index was refilled" is an observed fact rather than a mocked one.
 *
 * Uses the global `jest` (no `@jest/globals` import) and requires the subject
 * after the mocks are registered, per repo test conventions.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}))

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}))

import path from 'path'
import {
  countIndexedChatMessages,
  ensureChatMessageFtsSchema,
  missingChatMessageFtsObjects,
} from '@/lib/database/backends/sqlite/chat-message-fts'
import { registerTextCodecFunction } from '@/lib/database/backends/sqlite/text-codec-function'
import { reconcileChatMessageFts } from '@/lib/startup/reconcile-chat-message-fts'

const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as {
  getRawDatabase: jest.Mock
}

// Real binding by absolute root path — a bare require resolves to the mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

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

describe('reconcileChatMessageFts', () => {
  let db: any

  const insert = (id: string, content: string) =>
    db
      .prepare(
        'INSERT INTO "chat_messages" ("id","chatId","type","role","content","createdAt") VALUES (?,?,?,?,?,?)',
      )
      .run(id, 'chat-1', 'message', 'USER', content, '2026-01-01T00:00:00.000Z')

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    registerTextCodecFunction(db)
    db.exec(CREATE_CHAT_MESSAGES)
    ensureChatMessageFtsSchema(db)
    getRawDatabase.mockReturnValue(db)
  })

  afterEach(() => db?.close())

  it('does nothing when there is no SQLite database', async () => {
    getRawDatabase.mockReturnValue(null)
    await expect(reconcileChatMessageFts()).resolves.toEqual({
      restored: [],
      eligible: 0,
      indexed: 0,
      rebuilt: false,
    })
  })

  it('is a no-op on a healthy instance', async () => {
    for (let i = 1; i <= 4; i++) insert(`msg-${i}`, `interchange ${i}`)
    const result = await reconcileChatMessageFts()
    expect(result).toEqual({ restored: [], eligible: 4, indexed: 4, rebuilt: false })
  })

  it('restores triggers a table rebuild dropped, and refills what they missed', async () => {
    insert('msg-1', 'the first interchange')

    // Exactly what a CREATE-new/INSERT-SELECT/DROP/RENAME rebuild leaves:
    // the triggers are gone, and writes after that are never indexed.
    for (const t of ['chat_messages_fts_ai', 'chat_messages_fts_ad', 'chat_messages_fts_au']) {
      db.exec(`DROP TRIGGER "${t}"`)
    }
    insert('msg-2', 'an unindexed interchange')
    expect(countIndexedChatMessages(db)).toBe(1)

    const result = await reconcileChatMessageFts()

    expect(result.restored).toEqual([
      'chat_messages_fts_ai',
      'chat_messages_fts_ad',
      'chat_messages_fts_au',
    ])
    expect(result.rebuilt).toBe(true)
    expect(missingChatMessageFtsObjects(db)).toEqual([])
    expect(countIndexedChatMessages(db)).toBe(2)
  })

  it('creates the whole schema when it is absent entirely', async () => {
    const fresh = new Database(':memory:')
    try {
      registerTextCodecFunction(fresh)
      fresh.exec(CREATE_CHAT_MESSAGES)
      getRawDatabase.mockReturnValue(fresh)

      const result = await reconcileChatMessageFts()
      expect(result.restored).toHaveLength(5)
      expect(missingChatMessageFtsObjects(fresh)).toEqual([])
    } finally {
      fresh.close()
    }
  })

  it('rebuilds when the index is short of the transcript', async () => {
    for (let i = 1; i <= 3; i++) insert(`msg-${i}`, `estate ${i}`)
    // Damage the index without touching the base table.
    db.exec('DELETE FROM "chat_messages_fts"')
    db.exec('DELETE FROM "chat_messages_fts_map"')

    const result = await reconcileChatMessageFts()
    expect(result).toMatchObject({ eligible: 3, indexed: 0, rebuilt: true })
    expect(countIndexedChatMessages(db)).toBe(3)
  })

  it('swallows a broken database rather than blocking startup', async () => {
    db.exec('DROP TABLE "chat_messages"')
    await expect(reconcileChatMessageFts()).resolves.toMatchObject({ rebuilt: false })
  })
})
