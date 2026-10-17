/**
 * rollbackWardrobe (lib/wardrobe/history/rollback.ts): target resolution and
 * its refusals, the stale-item filter (archived skipped unless worn in that
 * slot, missing skipped), one set_all-shaped commit, and a cursor intent
 * handed to the effects instead of an append.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({
  notifyWardrobeChanged: jest.fn(),
}))

import { rollbackWardrobe, filterStaleItems } from '@/lib/wardrobe/history/rollback'
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects'
import { makeEmptyEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { ChatWardrobeHistoryRow } from '@/lib/schemas/chat-wardrobe-history.types'
import type { WearablePool } from '@/lib/wardrobe/pool'

const mockNotify = notifyWardrobeChanged as jest.Mock

const CHAT = 'chat-1'
const CHAR = 'char-1'

function slots(partial: Partial<EquippedSlots>): EquippedSlots {
  return { ...makeEmptyEquippedSlots(), ...partial }
}

function pool(items: Array<{ id: string; title: string; archivedAt?: string | null }>): WearablePool {
  const byId = new Map(items.map((i) => [i.id, { ...i, types: ['top'], origin: 'character' }]))
  return {
    characterId: CHAR,
    byId,
    get: (id: string) => byId.get(id),
  } as unknown as WearablePool
}

function row(entryIndex: number, s: EquippedSlots, isCurrent = false): ChatWardrobeHistoryRow {
  return {
    id: `row-${entryIndex}`,
    chatId: CHAT,
    characterId: CHAR,
    entryIndex,
    slots: s,
    slotsHash: 'x'.repeat(16),
    source: 'operator',
    actorCharacterId: null,
    isCurrent,
    createdAt: '2026-10-16T00:00:00.000Z',
  }
}

function makeRepos(entries: ChatWardrobeHistoryRow[], live: EquippedSlots | null = null) {
  return {
    wardrobeHistory: { findEntries: jest.fn().mockResolvedValue(entries) },
    wardrobeWear: { commitEquippedOutfit: jest.fn().mockResolvedValue({}) },
    chats: { getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(live) },
    characters: { findByIdRaw: jest.fn().mockResolvedValue({ name: 'Bertie' }) },
  }
}

const POOL = pool([
  { id: 'dress', title: 'Green Dress' },
  { id: 'boots', title: 'Riding Boots' },
  { id: 'coat', title: 'Greatcoat', archivedAt: '2026-10-01T00:00:00.000Z' },
])

const CONTEXT = { userId: 'u1', chatId: CHAT, characterId: CHAR, provenance: { source: 'operator' as const } }

function run(repos: ReturnType<typeof makeRepos>, index?: number) {
  return rollbackWardrobe(repos as never, { chatId: CHAT, pool: POOL, index, context: CONTEXT, source: 'ui' })
}

describe('rollbackWardrobe', () => {
  beforeEach(() => jest.clearAllMocks())

  it('steps back one by default, commits once with no bundles, and hands the effects a cursor intent', async () => {
    const repos = makeRepos([row(0, slots({ top: ['dress'] })), row(1, slots({ footwear: ['boots'] }), true)])
    const outcome = await run(repos)

    expect(outcome).toEqual({
      ok: true,
      previousIndex: 1,
      restoredIndex: 0,
      slots: slots({ top: ['dress'] }),
      skipped: [],
    })
    expect(repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledTimes(1)
    expect(repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledWith({
      chatId: CHAT,
      characterId: CHAR,
      nextSlots: slots({ top: ['dress'] }),
      wornBundles: [],
      source: 'ui',
    })
    expect(mockNotify).toHaveBeenCalledWith(
      repos,
      expect.objectContaining({ ...CONTEXT, historyIntent: { kind: 'cursor', index: 0 } }),
      expect.any(String),
    )
  })

  it('refuses with no_history when nothing is recorded', async () => {
    const outcome = await run(makeRepos([]))
    expect(outcome).toMatchObject({ ok: false, reason: 'no_history' })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('refuses with at_first when already at 0 and no index is given', async () => {
    const repos = makeRepos([row(0, slots({}), true), row(1, slots({ top: ['dress'] }))])
    const outcome = await run(repos)
    expect(outcome).toMatchObject({ ok: false, reason: 'at_first' })
    expect(outcome.ok === false && outcome.message).toContain('Bertie')
    expect(repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
  })

  it('refuses out_of_range naming the range', async () => {
    const outcome = await run(makeRepos([row(0, slots({})), row(1, slots({}), true)]), 5)
    expect(outcome).toMatchObject({ ok: false, reason: 'out_of_range' })
    expect(outcome.ok === false && outcome.message).toContain('0 to 1')
  })

  it('refuses already_current', async () => {
    const outcome = await run(makeRepos([row(0, slots({})), row(1, slots({}), true)]), 1)
    expect(outcome).toMatchObject({ ok: false, reason: 'already_current' })
  })

  it('rolls forward as readily as back', async () => {
    const repos = makeRepos([row(0, slots({}), true), row(1, slots({ top: ['dress'] })), row(2, slots({ footwear: ['boots'] }))])
    const outcome = await run(repos, 2)
    expect(outcome).toMatchObject({ ok: true, previousIndex: 0, restoredIndex: 2 })
  })

  it('skips an archived item, and a missing one, but restores the rest', async () => {
    const repos = makeRepos([
      row(0, slots({ top: ['dress', 'coat'], footwear: ['boots'], accessories: ['gone'] })),
      row(1, slots({}), true),
    ])
    const outcome = await run(repos)
    expect(outcome).toMatchObject({
      ok: true,
      slots: slots({ top: ['dress'], footwear: ['boots'] }),
      skipped: [
        { itemId: 'coat', title: 'Greatcoat', reason: 'archived' },
        { itemId: 'gone', title: null, reason: 'missing' },
      ],
    })
  })

  it('keeps an archived item that is currently worn in the same slot', async () => {
    const repos = makeRepos(
      [row(0, slots({ top: ['dress', 'coat'] })), row(1, slots({ top: ['coat'] }), true)],
      slots({ top: ['coat'] }),
    )
    const outcome = await run(repos)
    expect(outcome).toMatchObject({ ok: true, slots: slots({ top: ['dress', 'coat'] }), skipped: [] })
  })

  it('filterStaleItems drops an archived item worn in a different slot', () => {
    const { slots: kept, skipped } = filterStaleItems(
      POOL,
      slots({ top: ['coat'] }),
      slots({ accessories: ['coat'] }),
    )
    expect(kept.top).toEqual([])
    expect(skipped).toEqual([{ itemId: 'coat', title: 'Greatcoat', reason: 'archived' }])
  })
})
