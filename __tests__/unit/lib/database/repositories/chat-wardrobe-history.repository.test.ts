/**
 * The outfit history against a real SQLite connection: the `settle`
 * chokepoint's append and cursor intents, the first-touch seed, the no-op on
 * an unchanged outfit, and the two invariants (contiguous indices, exactly one
 * current row) the unique indexes back.
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
import {
  ChatWardrobeHistoryRepository,
  type LiveOutfitReader,
} from '@/lib/database/repositories/chat-wardrobe-history.repository'
import { CHAT_WARDROBE_HISTORY_DDL } from '@/lib/database/backends/sqlite/chat-wardrobe-history-ddl'
import { makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash'

const { rawQuery } = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }
const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as { getRawDatabase: jest.Mock }
const { publishRealtime } = jest.requireMock('@/lib/realtime/bus') as { publishRealtime: jest.Mock }

// Real binding by absolute root path — a bare require resolves to the mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAT = '33333333-3333-4333-8333-333333333333'
const CHAR_A = '11111111-1111-4111-8111-111111111111'
const CHAR_B = '22222222-2222-4222-8222-222222222222'
const DRESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOOTS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SCARF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function slots(partial: Partial<EquippedSlots>): EquippedSlots {
  return { ...makeEmptyEquippedSlots(), ...partial }
}

function fakeChats(): LiveOutfitReader & { set(characterId: string, s: EquippedSlots | null): void } {
  const state = new Map<string, EquippedSlots | null>()
  return {
    set(characterId, s) {
      state.set(characterId, s)
    },
    async getEquippedOutfitForCharacter(_chatId: string, characterId: string) {
      return state.get(characterId) ?? null
    },
  }
}

describe('ChatWardrobeHistoryRepository', () => {
  let db: any
  let chats: ReturnType<typeof fakeChats>
  let repo: ChatWardrobeHistoryRepository

  const rows = (characterId = CHAR_A) =>
    db.prepare('SELECT * FROM "chat_wardrobe_history" WHERE "characterId" = ? ORDER BY "entryIndex"').all(characterId)

  const assertInvariants = (characterId = CHAR_A) => {
    const all = rows(characterId)
    if (all.length === 0) return
    expect(all.map((r: any) => r.entryIndex)).toEqual(all.map((_: unknown, i: number) => i))
    expect(all.filter((r: any) => r.isCurrent === 1)).toHaveLength(1)
    for (const r of all) expect(r.slotsHash).toBe(hashEquippedSlots(JSON.parse(r.slots)))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    db.exec('CREATE TABLE "chats" ("id" TEXT PRIMARY KEY)')
    db.prepare('INSERT INTO "chats" VALUES (?)').run(CHAT)
    for (const statement of CHAT_WARDROBE_HISTORY_DDL) db.exec(statement)
    rawQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const stmt = db.prepare(sql)
      return stmt.reader ? stmt.all(...params) : stmt.run(...params)
    })
    getRawDatabase.mockReturnValue(db)
    chats = fakeChats()
    repo = new ChatWardrobeHistoryRepository(chats)
  })

  afterEach(() => db.close())

  describe('append on an empty history', () => {
    it('records an arrival outfit as entry 0 with its own source', async () => {
      chats.set(CHAR_A, slots({ top: [DRESS] }))
      const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })

      expect(outcome).toEqual({ kind: 'appended', entryIndex: 0, seeded: false })
      const [row] = rows()
      expect(row.source).toBe('chat-start')
      expect(row.isCurrent).toBe(1)
      expect(JSON.parse(row.slots).top).toEqual([DRESS])
      expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT)
    })

    it('records a naked arrival as entry 0', async () => {
      const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
      expect(outcome).toEqual({ kind: 'appended', entryIndex: 0, seeded: false })
      expect(rows()).toHaveLength(1)
    })

    it('seeds an empty 0 alone when a pre-history seat is still undressed', async () => {
      const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
      expect(outcome).toEqual({ kind: 'appended', entryIndex: 0, seeded: true })
      const [row] = rows()
      expect(row.source).toBe('seeded')
      expect(row.isCurrent).toBe(1)
    })

    it('seeds an empty 0 then records the change as 1 when a pre-history seat gets dressed', async () => {
      chats.set(CHAR_A, slots({ top: [DRESS] }))
      const outcome = await repo.settle(CHAT, CHAR_A, {
        kind: 'append',
        provenance: { source: 'character', actorCharacterId: CHAR_A },
      })

      expect(outcome).toEqual({ kind: 'appended', entryIndex: 1, seeded: true })
      const [zero, one] = rows()
      expect(zero.source).toBe('seeded')
      expect(JSON.parse(zero.slots).top).toEqual([])
      expect(zero.isCurrent).toBe(0)
      expect(one.source).toBe('character')
      expect(one.actorCharacterId).toBe(CHAR_A)
      expect(one.isCurrent).toBe(1)
      assertInvariants()
    })
  })

  it('records the custom tool behind a Pascal change, and no tool for anyone else', async () => {
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, {
      kind: 'append',
      provenance: { source: 'pascal', actorCharacterId: CHAR_A, toolName: 'dress_for_dinner' },
    })
    chats.set(CHAR_A, slots({}))
    await repo.settle(CHAT, CHAR_A, {
      kind: 'append',
      provenance: { source: 'operator', actorCharacterId: CHAR_B, toolName: 'ignored' },
    })

    const [zero, one, two] = rows()
    expect(zero.actorToolName).toBeNull()
    expect(one.source).toBe('pascal')
    expect(one.actorToolName).toBe('dress_for_dinner')
    expect(two.source).toBe('operator')
    expect(two.actorCharacterId).toBe(CHAR_B)
    expect(two.actorToolName).toBeNull()
    const [, readBack] = await repo.findEntries(CHAT, CHAR_A)
    expect(readBack.actorToolName).toBe('dress_for_dinner')
    assertInvariants()
  })

  it('is a no-op when the live outfit equals the current entry', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    publishRealtime.mockClear()

    const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    expect(outcome).toEqual({ kind: 'unchanged', entryIndex: 0 })
    expect(rows()).toHaveLength(1)
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('appends max + 1 after a rollback, moving the cursor there', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    chats.set(CHAR_A, slots({ top: [DRESS], footwear: [BOOTS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    chats.set(CHAR_A, slots({ footwear: [BOOTS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })

    // Roll back to 0.
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    expect(await repo.settle(CHAT, CHAR_A, { kind: 'cursor', index: 0 })).toEqual({ kind: 'cursor-moved', entryIndex: 0 })
    expect(rows().map((r: any) => r.isCurrent)).toEqual([1, 0, 0])

    // Wear a scarf on top: lands at 3, not 1.
    chats.set(CHAR_A, slots({ top: [DRESS], accessories: [SCARF] }))
    const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    expect(outcome).toEqual({ kind: 'appended', entryIndex: 3, seeded: false })
    expect(rows().map((r: any) => r.isCurrent)).toEqual([0, 0, 0, 1])
    assertInvariants()
  })

  it('appends even when the live outfit matches an older, non-current entry', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    chats.set(CHAR_A, slots({ footwear: [BOOTS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    expect(outcome).toEqual({ kind: 'appended', entryIndex: 2, seeded: false })
    assertInvariants()
  })

  it('moves the cursor without appending, forwards as well as back', async () => {
    for (const s of [slots({ top: [DRESS] }), slots({ footwear: [BOOTS] }), slots({ accessories: [SCARF] })]) {
      chats.set(CHAR_A, s)
      await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
    }
    // Entries 0 (seeded empty), 1, 2, 3.
    await repo.settle(CHAT, CHAR_A, { kind: 'cursor', index: 1 })
    expect((await repo.findCurrent(CHAT, CHAR_A))?.entryIndex).toBe(1)
    await repo.settle(CHAT, CHAR_A, { kind: 'cursor', index: 2 })
    expect((await repo.findCurrent(CHAT, CHAR_A))?.entryIndex).toBe(2)
    expect(rows()).toHaveLength(4)
    assertInvariants()
  })

  it('leaves the cursor alone for a missing index, without throwing', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    const outcome = await repo.settle(CHAT, CHAR_A, { kind: 'cursor', index: 7 })
    expect(outcome).toEqual({ kind: 'skipped', reason: 'missing-index' })
    expect((await repo.findCurrent(CHAT, CHAR_A))?.entryIndex).toBe(0)
  })

  it('never throws: a database failure is logged and swallowed', async () => {
    getRawDatabase.mockReturnValue(null)
    await expect(repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } }))
      .resolves.toEqual({ kind: 'skipped', reason: 'error' })
  })

  it('keeps each character on their own timeline', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    chats.set(CHAR_B, slots({ footwear: [BOOTS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    await repo.settle(CHAT, CHAR_B, { kind: 'append', provenance: { source: 'chat-start' } })
    expect(rows(CHAR_A)).toHaveLength(1)
    expect(rows(CHAR_B)).toHaveLength(1)
    assertInvariants(CHAR_A)
    assertInvariants(CHAR_B)
  })

  describe('upsertRows', () => {
    it('round-trips rows whole, and skips one that would make a second current row', async () => {
      chats.set(CHAR_A, slots({ top: [DRESS] }))
      await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
      chats.set(CHAR_A, slots({ footwear: [BOOTS] }))
      await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'operator' } })
      const exported = await repo.findByChatId(CHAT)
      db.exec('DELETE FROM "chat_wardrobe_history"')

      const bogus = { ...exported[0], id: '99999999-9999-4999-8999-999999999999', entryIndex: 5, isCurrent: true }
      const written = await repo.upsertRows([...exported, bogus])

      expect(written).toBe(2)
      expect(await repo.findByChatId(CHAT)).toEqual(exported)
      assertInvariants()
    })
  })

  it('deleteByCharacter drops only that character', async () => {
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    chats.set(CHAR_B, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    await repo.settle(CHAT, CHAR_B, { kind: 'append', provenance: { source: 'chat-start' } })
    await repo.deleteByCharacter(CHAR_A)
    expect(rows(CHAR_A)).toHaveLength(0)
    expect(rows(CHAR_B)).toHaveLength(1)
  })

  it('cascades with the chat', async () => {
    db.pragma('foreign_keys = ON')
    chats.set(CHAR_A, slots({ top: [DRESS] }))
    await repo.settle(CHAT, CHAR_A, { kind: 'append', provenance: { source: 'chat-start' } })
    db.prepare('DELETE FROM "chats" WHERE "id" = ?').run(CHAT)
    expect(rows()).toHaveLength(0)
  })
})
