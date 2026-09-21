/**
 * `searchMessagesGlobal` against a real SQLite connection.
 *
 * The unit tests for the translator (`fts-query.test.ts`) prove which plan a
 * query gets; these prove the SQL those plans produce actually parses, binds
 * and returns the right rows in the right order — including the exact-scan
 * fallback, which is the path a `C++` search takes and the one the old
 * regex→LIKE conversion got wrong.
 *
 * Uses the global `jest` (no `@jest/globals` import) and bare mock factories,
 * per repo test conventions.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

import path from 'path'
import { ChatSearchReplaceOps } from '@/lib/database/repositories/chats-search.ops'
import {
  ensureChatMessageFtsSchema,
} from '@/lib/database/backends/sqlite/chat-message-fts'
import { registerTextCodecFunction } from '@/lib/database/backends/sqlite/text-codec-function'
import { textToBlob } from '@/lib/database/text-compression'

const { rawQuery } = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }
const { logger } = jest.requireMock('@/lib/logger') as { logger: Record<string, jest.Mock> }

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

describe('searchMessagesGlobal', () => {
  let db: any
  let ops: ChatSearchReplaceOps

  const insert = (
    id: string,
    content: unknown,
    createdAt: string,
    overrides: { chatId?: string; type?: string; role?: string } = {},
  ) =>
    db
      .prepare(
        'INSERT INTO "chat_messages" ("id","chatId","type","role","content","createdAt") VALUES (?,?,?,?,?,?)',
      )
      .run(
        id,
        overrides.chatId ?? 'chat-1',
        overrides.type ?? 'message',
        overrides.role ?? 'USER',
        content,
        createdAt,
      )

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    registerTextCodecFunction(db)
    db.exec(CREATE_CHAT_MESSAGES)
    ensureChatMessageFtsSchema(db)

    rawQuery.mockImplementation(async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params),
    )

    ops = new ChatSearchReplaceOps(
      {
        isSQLiteBackend: () => true,
        findById: jest.fn(),
        update: jest.fn(),
        getCollection: jest.fn(),
        getMessagesCollection: jest.fn(),
        generateId: jest.fn(),
        getCurrentTimestamp: jest.fn(),
      } as any,
      {} as any,
    )
  })

  afterEach(() => db?.close())

  it('finds word prefixes through the index, newest first', async () => {
    insert('m1', 'she was walking home', '2026-01-01T00:00:01.000Z')
    insert('m2', 'he walked out', '2026-01-01T00:00:02.000Z')
    insert('m3', 'nothing relevant', '2026-01-01T00:00:03.000Z')

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'walk')
    expect(hits.map(h => h.messageId)).toEqual(['m2', 'm1'])
    expect(hits[0]).toMatchObject({ chatId: 'chat-1', role: 'USER' })
  })

  it('honours the limit in SQL rather than after the fact', async () => {
    for (let i = 1; i <= 10; i++) {
      insert(`m${i}`, `the estate, entry ${i}`, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`)
    }
    const hits = await ops.searchMessagesGlobal(['chat-1'], 'estate', 3)
    expect(hits).toHaveLength(3)
    expect(hits.map(h => h.messageId)).toEqual(['m10', 'm9', 'm8'])
  })

  it('restricts to the chats it was given', async () => {
    insert('m1', 'the estate', '2026-01-01T00:00:01.000Z', { chatId: 'chat-1' })
    insert('m2', 'the estate', '2026-01-01T00:00:02.000Z', { chatId: 'chat-2' })

    const hits = await ops.searchMessagesGlobal(['chat-2'], 'estate')
    expect(hits.map(h => h.messageId)).toEqual(['m2'])
  })

  it('decodes a compressed row on the way out', async () => {
    const long = 'a lengthy remark about the estate, repeated at length. '.repeat(20)
    insert('m1', textToBlob(long), '2026-01-01T00:00:01.000Z')

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'estate')
    expect(hits).toHaveLength(1)
    expect(hits[0].content).toBe(long)
  })

  it('falls back to an exact scan for a query FTS cannot answer', async () => {
    insert('m1', 'I write C++ for a living', '2026-01-01T00:00:01.000Z')
    insert('m2', 'a café is not C plus plus', '2026-01-01T00:00:02.000Z')

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'C++')
    expect(hits.map(h => h.messageId)).toEqual(['m1'])
  })

  it('finds a query containing a dot, which the old regex→LIKE path could not', async () => {
    insert('m1', 'Mr. Smith arrived', '2026-01-01T00:00:01.000Z')
    insert('m2', 'Mrs Smith arrived', '2026-01-01T00:00:02.000Z')

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'Mr. Smith')
    expect(hits.map(h => h.messageId)).toEqual(['m1'])
  })

  it('treats a user-typed % or _ as a literal on the fallback path', async () => {
    insert('m1', 'a 5% discount', '2026-01-01T00:00:01.000Z')
    insert('m2', 'no discount at all', '2026-01-01T00:00:02.000Z')

    const hits = await ops.searchMessagesGlobal(['chat-1'], '%')
    expect(hits.map(h => h.messageId)).toEqual(['m1'])
  })

  it('skips system events and non-conversational roles', async () => {
    insert('m1', 'the estate', '2026-01-01T00:00:01.000Z')
    insert('m2', 'the estate', '2026-01-01T00:00:02.000Z', { type: 'system' })
    insert('m3', 'the estate', '2026-01-01T00:00:03.000Z', { role: 'SYSTEM' })

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'estate')
    expect(hits.map(h => h.messageId)).toEqual(['m1'])
  })

  it('decodes the message text only AFTER the limit', async () => {
    // SQLite puts the output columns in the sorter, so a qt_text() in the outer
    // SELECT list would decompress every match before the limit applied — 1.2 s
    // instead of 86 ms for a common word across 142k rows. The decode must sit
    // outside the subquery that does the ORDER BY / LIMIT.
    insert('m1', 'the estate', '2026-01-01T00:00:01.000Z')
    await ops.searchMessagesGlobal(['chat-1'], 'estate')

    const sql = (rawQuery.mock.calls[0][0] as string).replace(/\s+/g, ' ')
    const inner = sql.slice(sql.indexOf('FROM (') + 'FROM ('.length, sql.lastIndexOf(') s'))
    expect(inner).toContain('LIMIT ?')
    expect(inner).not.toContain('qt_text')
    expect(sql).toContain('qt_text')
  })

  it('returns nothing when given no chats', async () => {
    await expect(ops.searchMessagesGlobal([], 'estate')).resolves.toEqual([])
    expect(rawQuery).not.toHaveBeenCalled()
  })

  it('falls back to the exact scan when the index is missing entirely', async () => {
    insert('m1', 'the estate', '2026-01-01T00:00:01.000Z')
    db.exec('DROP TABLE "chat_messages_fts"')

    const hits = await ops.searchMessagesGlobal(['chat-1'], 'estate')
    expect(hits.map(h => h.messageId)).toEqual(['m1'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back'),
      expect.any(Object),
    )
  })
})
