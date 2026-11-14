/**
 * The Salon avatar timeline against a real SQLite connection: `record`'s
 * first-time baseline (from the prior per-chat avatar, or none), the no-op on
 * an unchanged image, removal rows, and the read order.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

import path from 'path'
import { ChatAvatarTimelineRepository } from '@/lib/database/repositories/chat-avatar-timeline.repository'
import { CHAT_AVATAR_TIMELINE_DDL } from '@/lib/database/backends/sqlite/chat-avatar-timeline-ddl'
import { AVATAR_TIMELINE_BASELINE_AT } from '@/lib/schemas/chat-avatar-timeline.types'

const { rawQuery } = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }
const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as { getRawDatabase: jest.Mock }
const { publishRealtime } = jest.requireMock('@/lib/realtime/bus') as { publishRealtime: jest.Mock }

// Real binding by absolute root path — a bare require resolves to the mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAT = '33333333-3333-4333-8333-333333333333'
const CHAR_A = '11111111-1111-4111-8111-111111111111'
const CHAR_B = '22222222-2222-4222-8222-222222222222'

describe('ChatAvatarTimelineRepository', () => {
  let db: any
  let repo: ChatAvatarTimelineRepository

  const rows = (characterId = CHAR_A) =>
    db.prepare('SELECT * FROM "chat_avatar_timeline" WHERE "characterId" = ? ORDER BY "effectiveAt", "createdAt"').all(characterId)

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    db.exec('CREATE TABLE "chats" ("id" TEXT PRIMARY KEY)')
    db.prepare('INSERT INTO "chats" VALUES (?)').run(CHAT)
    for (const statement of CHAT_AVATAR_TIMELINE_DDL) db.exec(statement)
    rawQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const stmt = db.prepare(sql)
      return stmt.reader ? stmt.all(...params) : stmt.run(...params)
    })
    getRawDatabase.mockReturnValue(db)
    repo = new ChatAvatarTimelineRepository()
  })

  afterEach(() => db.close())

  it('writes a baseline holding the prior per-chat avatar before the first change', async () => {
    const outcome = await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-new', source: 'generated', priorImageId: 'img-old' })

    expect(outcome).toEqual({ kind: 'appended', baseline: true })
    const all = rows()
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ imageId: 'img-old', source: 'baseline', effectiveAt: AVATAR_TIMELINE_BASELINE_AT })
    expect(all[1]).toMatchObject({ imageId: 'img-new', source: 'generated' })
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT)
  })

  it('writes a NULL baseline (the character\'s own avatar) when the chat had no per-chat avatar', async () => {
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-new', source: 'operator', priorImageId: null })
    const all = rows()
    expect(all[0]).toMatchObject({ imageId: null, source: 'baseline' })
    expect(all[1]).toMatchObject({ imageId: 'img-new', source: 'operator' })
  })

  it('writes only the baseline when the first change binds the image already shown', async () => {
    const outcome = await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-same', source: 'cache', priorImageId: 'img-same' })
    expect(outcome).toEqual({ kind: 'appended', baseline: true })
    expect(rows()).toHaveLength(1)
  })

  it('records nothing when the image equals the latest entry', async () => {
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-1', source: 'generated', priorImageId: null })
    publishRealtime.mockClear()
    const outcome = await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-1', source: 'cache', priorImageId: 'img-1' })
    expect(outcome).toEqual({ kind: 'unchanged' })
    expect(rows()).toHaveLength(2)
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('ignores priorImageId once a timeline exists', async () => {
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-1', source: 'generated', priorImageId: null })
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-2', source: 'generated', priorImageId: 'stale' })
    expect(rows().map((r: any) => r.imageId)).toEqual([null, 'img-1', 'img-2'])
  })

  it('records a removal as a NULL row', async () => {
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-1', source: 'operator', priorImageId: null })
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: null, source: 'operator-removed', priorImageId: 'img-1' })
    expect(rows().map((r: any) => [r.imageId, r.source])).toEqual([[null, 'baseline'], ['img-1', 'operator'], [null, 'operator-removed']])
  })

  it('keeps each character\'s timeline separate and reads a chat by character then time', async () => {
    await repo.record({ chatId: CHAT, characterId: CHAR_B, imageId: 'b-1', source: 'generated', priorImageId: null })
    await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'a-1', source: 'generated', priorImageId: 'a-0' })
    const all = await repo.findByChatId(CHAT)
    expect(all.map(r => [r.characterId, r.imageId])).toEqual([
      [CHAR_A, 'a-0'], [CHAR_A, 'a-1'], [CHAR_B, null], [CHAR_B, 'b-1'],
    ])
  })

  it('never throws: a database failure is reported as skipped', async () => {
    getRawDatabase.mockReturnValue(null)
    const outcome = await repo.record({ chatId: CHAT, characterId: CHAR_A, imageId: 'img-1', source: 'generated', priorImageId: null })
    expect(outcome).toEqual({ kind: 'skipped', reason: 'error' })
  })
})
