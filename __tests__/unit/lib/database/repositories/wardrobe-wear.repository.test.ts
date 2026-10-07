/**
 * The wardrobe wear ledger against a real SQLite connection: the atomic
 * upsert-and-increment, the COALESCE unique index, the fold a character's
 * deletion performs, and the `commitEquippedOutfit` chokepoint's diff.
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

import path from 'path'
import {
  WardrobeWearRepository,
  diffEquippedOutfit,
  type EquippedOutfitStore,
} from '@/lib/database/repositories/wardrobe-wear.repository'
import { WARDROBE_WEAR_STATS_DDL } from '@/lib/database/backends/sqlite/wardrobe-wear-stats-ddl'
import { makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'

const { rawQuery } = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }

// Real binding by absolute root path — a bare require resolves to the mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAR_A = '11111111-1111-4111-8111-111111111111'
const CHAR_B = '22222222-2222-4222-8222-222222222222'
const CHAT_1 = '33333333-3333-4333-8333-333333333333'
const CHAT_2 = '44444444-4444-4444-8444-444444444444'

function slots(partial: Partial<EquippedSlots>): EquippedSlots {
  return { ...makeEmptyEquippedSlots(), ...partial }
}

/** An in-memory equipped-outfit store standing in for the chats repository. */
function fakeChats(): EquippedOutfitStore & { state: Map<string, EquippedSlots>; writes: number } {
  const state = new Map<string, EquippedSlots>()
  const store = {
    state,
    writes: 0,
    async getEquippedOutfitForCharacter(chatId: string, characterId: string) {
      return state.get(`${chatId}:${characterId}`) ?? null
    },
    async setEquippedOutfit(chatId: string, characterId: string, next: EquippedSlots) {
      store.writes += 1
      state.set(`${chatId}:${characterId}`, next)
      return next
    },
  }
  return store
}

describe('WardrobeWearRepository', () => {
  let db: any
  let chats: ReturnType<typeof fakeChats>
  let repo: WardrobeWearRepository

  const rows = () =>
    db.prepare('SELECT * FROM "wardrobe_wear_stats" ORDER BY "itemId", "wearerCharacterId"').all()

  beforeEach(() => {
    jest.clearAllMocks()
    db = new Database(':memory:')
    for (const statement of WARDROBE_WEAR_STATS_DDL) db.exec(statement)
    rawQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const stmt = db.prepare(sql)
      return stmt.reader ? stmt.all(...params) : stmt.run(...params)
    })
    chats = fakeChats()
    repo = new WardrobeWearRepository(chats)
  })

  afterEach(() => db.close())

  describe('incrementWears', () => {
    it('inserts at one, then increments and moves last-worn forward', async () => {
      await repo.incrementWears([{ itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' }])
      await repo.incrementWears([{ itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_2, at: '2026-02-01T00:00:00.000Z' }])

      const [row] = rows()
      expect(row.wearCount).toBe(2)
      expect(row.firstWornAt).toBe('2026-01-01T00:00:00.000Z')
      expect(row.lastWornAt).toBe('2026-02-01T00:00:00.000Z')
      expect(row.lastWornChatId).toBe(CHAT_2)
    })

    it('never rewinds last-worn when an earlier wear lands late', async () => {
      await repo.incrementWears([{ itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_2, at: '2026-02-01T00:00:00.000Z' }])
      await repo.incrementWears([{ itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' }])

      const [row] = rows()
      expect(row.wearCount).toBe(2)
      expect(row.firstWornAt).toBe('2026-01-01T00:00:00.000Z')
      expect(row.lastWornAt).toBe('2026-02-01T00:00:00.000Z')
      expect(row.lastWornChatId).toBe(CHAT_2)
    })

    it('keeps one row per wearer', async () => {
      await repo.incrementWears([
        { itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
        { itemId: 'coat', wearerCharacterId: CHAR_B, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
      ])
      expect(rows()).toHaveLength(2)
    })
  })

  it('the COALESCE unique index admits one unattributed row per item', async () => {
    const insert = (id: string) =>
      db.prepare(
        `INSERT INTO "wardrobe_wear_stats" VALUES (?, 'coat', NULL, 1, 'x', 'x', NULL, 'x', 'x')
         ON CONFLICT ("itemId", COALESCE("wearerCharacterId", '')) DO UPDATE SET "wearCount" = "wearCount" + 1`,
      ).run(id)
    insert('a')
    insert('b')
    const all = rows()
    expect(all).toHaveLength(1)
    expect(all[0].wearCount).toBe(2)
  })

  it('foldWearerIntoUnattributed sums counts and takes min first / max last', async () => {
    await repo.upsertRows([
      {
        id: 'u1', itemId: 'coat', wearerCharacterId: null, wearCount: 2,
        firstWornAt: '2026-01-05T00:00:00.000Z', lastWornAt: '2026-01-10T00:00:00.000Z', lastWornChatId: CHAT_1,
        createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z',
      },
      {
        id: 'a1', itemId: 'coat', wearerCharacterId: CHAR_A, wearCount: 3,
        firstWornAt: '2026-01-01T00:00:00.000Z', lastWornAt: '2026-03-01T00:00:00.000Z', lastWornChatId: CHAT_2,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'a2', itemId: 'hat', wearerCharacterId: CHAR_A, wearCount: 1,
        firstWornAt: '2026-01-01T00:00:00.000Z', lastWornAt: '2026-01-01T00:00:00.000Z', lastWornChatId: CHAT_1,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'b1', itemId: 'coat', wearerCharacterId: CHAR_B, wearCount: 1,
        firstWornAt: '2026-01-01T00:00:00.000Z', lastWornAt: '2026-01-01T00:00:00.000Z', lastWornChatId: CHAT_1,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await repo.foldWearerIntoUnattributed(CHAR_A)

    const all = rows()
    expect(all.filter((r: any) => r.wearerCharacterId === CHAR_A)).toHaveLength(0)
    const coat = all.find((r: any) => r.itemId === 'coat' && r.wearerCharacterId === null)
    expect(coat).toMatchObject({
      wearCount: 5,
      firstWornAt: '2026-01-01T00:00:00.000Z',
      lastWornAt: '2026-03-01T00:00:00.000Z',
      lastWornChatId: CHAT_2,
    })
    const hat = all.find((r: any) => r.itemId === 'hat')
    expect(hat).toMatchObject({ wearerCharacterId: null, wearCount: 1 })
    // Other wearers are untouched.
    expect(all.find((r: any) => r.wearerCharacterId === CHAR_B)).toMatchObject({ wearCount: 1 })
  })

  it('findSummaries totals across wearers and returns the zero summary for unknown ids', async () => {
    await repo.incrementWears([
      { itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
      { itemId: 'coat', wearerCharacterId: CHAR_B, chatId: CHAT_2, at: '2026-02-01T00:00:00.000Z' },
    ])
    const summaries = await repo.findSummaries(['coat', 'never'])
    expect(summaries.get('coat')).toEqual({
      wearCount: 2,
      firstWornAt: '2026-01-01T00:00:00.000Z',
      lastWornAt: '2026-02-01T00:00:00.000Z',
      lastWornChatId: CHAT_2,
    })
    expect(summaries.get('never')).toEqual({ wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null })
  })

  it('findHistory lists wearers most recent first', async () => {
    await repo.incrementWears([
      { itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
      { itemId: 'coat', wearerCharacterId: CHAR_B, chatId: CHAT_2, at: '2026-02-01T00:00:00.000Z' },
    ])
    const history = await repo.findHistory('coat')
    expect(history.wearCount).toBe(2)
    expect(history.wearers.map((w) => w.characterId)).toEqual([CHAR_B, CHAR_A])
    expect((await repo.findHistory('never')).wearers).toEqual([])
  })

  it('deleteByItemIds drops only those items', async () => {
    await repo.incrementWears([
      { itemId: 'coat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
      { itemId: 'hat', wearerCharacterId: CHAR_A, chatId: CHAT_1, at: '2026-01-01T00:00:00.000Z' },
    ])
    await repo.deleteByItemIds(['coat'])
    expect(rows().map((r: any) => r.itemId)).toEqual(['hat'])
  })

  describe('commitEquippedOutfit', () => {
    const counts = () =>
      Object.fromEntries(rows().map((r: any) => [`${r.itemId}:${r.wearerCharacterId}`, r.wearCount]))

    it('credits a newly worn leaf, and nothing for one already on', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      const result = await repo.commitEquippedOutfit({
        chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'], bottom: ['slacks'] }), source: 'ui',
      })
      expect(result.newlyWornLeafIds).toEqual(['slacks'])
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 1, [`slacks:${CHAR_A}`]: 1 })
    })

    it('a removal credits nothing; putting it back on later is a second wear', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({}), source: 'take-off' })
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 1 })
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'tool' })
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 2 })
    })

    it('two characters in one chat each earn a wear of a shared garment', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['coat'] }), source: 'chat-start' })
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_B, nextSlots: slots({ top: ['coat'] }), source: 'chat-start' })
      expect(counts()).toEqual({ [`coat:${CHAR_A}`]: 1, [`coat:${CHAR_B}`]: 1 })
    })

    it('credits a bundle once when at least one of its leaves transitioned', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      const result = await repo.commitEquippedOutfit({
        chatId: CHAT_1,
        characterId: CHAR_A,
        nextSlots: slots({ top: ['shirt'], bottom: ['slacks'] }),
        wornBundles: [{ id: 'suit', leafIds: ['shirt', 'slacks'] }],
        source: 'ui',
      })
      expect(result.creditedBundleIds).toEqual(['suit'])
      // The already-worn shirt is not re-credited.
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 1, [`slacks:${CHAR_A}`]: 1, [`suit:${CHAR_A}`]: 1 })
    })

    it('a bundle whose leaves were all already on earns nothing', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'], bottom: ['slacks'] }), source: 'ui' })
      const result = await repo.commitEquippedOutfit({
        chatId: CHAT_1,
        characterId: CHAR_A,
        nextSlots: slots({ top: ['shirt'], bottom: ['slacks'] }),
        wornBundles: [{ id: 'suit', leafIds: ['shirt', 'slacks'] }],
        source: 'ui',
      })
      expect(result.creditedBundleIds).toEqual([])
      expect(result.changed).toBe(false)
      expect(counts()[`suit:${CHAR_A}`]).toBeUndefined()
    })

    it("'merge' writes the slots but credits nothing", async () => {
      const result = await repo.commitEquippedOutfit({
        chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'merge',
      })
      expect(result.newlyWornLeafIds).toEqual(['shirt'])
      expect(chats.state.get(`${CHAT_1}:${CHAR_A}`)).toEqual(slots({ top: ['shirt'] }))
      expect(rows()).toHaveLength(0)
    })

    it('equal slots report unchanged but are still written', async () => {
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      const before = chats.writes
      const result = await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      expect(result.changed).toBe(false)
      expect(chats.writes).toBe(before + 1)
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 1 })
    })

    it('a failed slot write credits nothing', async () => {
      chats.setEquippedOutfit = async () => null
      await repo.commitEquippedOutfit({ chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'ui' })
      expect(rows()).toHaveLength(0)
    })

    it('replaying two buffered ops credits each against the true prior state', async () => {
      // The job child computed both ops from the same stale (empty) snapshot;
      // replayed in order, the second diff sees the first's write.
      const buffered = [
        { chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'] }), source: 'tool' as const },
        { chatId: CHAT_1, characterId: CHAR_A, nextSlots: slots({ top: ['shirt'], bottom: ['slacks'] }), source: 'tool' as const },
      ]
      for (const op of JSON.parse(JSON.stringify(buffered))) {
        await repo.commitEquippedOutfit(op)
      }
      expect(counts()).toEqual({ [`shirt:${CHAR_A}`]: 1, [`slacks:${CHAR_A}`]: 1 })
    })
  })
})

describe('diffEquippedOutfit', () => {
  it('treats a legacy whole-composite id as a plain id', () => {
    const result = diffEquippedOutfit(null, slots({ top: ['old-bundle'] }))
    expect(result.newlyWornLeafIds).toEqual(['old-bundle'])
    expect(result.changed).toBe(true)
  })

  it('reports no change for an empty write over nothing', () => {
    expect(diffEquippedOutfit(null, slots({})).changed).toBe(false)
  })
})
