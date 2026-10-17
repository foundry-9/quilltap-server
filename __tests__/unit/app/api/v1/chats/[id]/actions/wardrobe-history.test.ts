/**
 * Chats API v1 — `?action=wardrobe-history` and `?action=wardrobe-rollback`.
 *
 * History resolves each entry against the character's operator pool, marking
 * archived and missing ids rather than dropping them. Rollback is an operator
 * change: one commit through the ledger, the history settled as a cursor move,
 * refusals answered 400. The pool loader is mocked at the seam; the pools are
 * real (`buildWearablePool`).
 */

import { historyDouble, ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'
import { buildWearablePool, loadWearablePool } from '@/lib/wardrobe/pool'

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/wardrobe/pool', () => ({
  ...jest.requireActual('@/lib/wardrobe/pool'),
  loadWearablePool: jest.fn(),
}))

const { handleGetWardrobeHistory, handleWardrobeRollback } = require('@/app/api/v1/chats/[id]/actions/outfit')

const mockLoadPool = loadWearablePool as jest.MockedFunction<typeof loadWearablePool>

const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

function wardrobeItem(id: string, title: string, types: string[], extra: Record<string, unknown> = {}) {
  return {
    id, characterId: 'char-1', title, types, componentItemIds: [] as string[], appropriateness: null,
    isDefault: false, replace: false, archivedAt: null, description: null,
    createdAt: '2026-04-26T22:10:49.081Z', updatedAt: '2026-04-26T22:10:49.081Z', ...extra,
  }
}

function poolOf(characterId: string, own: any[]) {
  return buildWearablePool(
    characterId,
    { groupMountPointIds: [], projectMountPointIds: [] },
    {
      own: own.map((item) => ({ ...item, origin: { scope: 'character', id: characterId, name: '' } })),
      group: [], project: [], general: [],
    },
  )
}

const dress = wardrobeItem('dress', 'Green Dress', ['top', 'bottom'])
const coat = wardrobeItem('coat', 'Greatcoat', ['top'], { archivedAt: '2026-10-01T00:00:00.000Z' })

function row(entryIndex: number, slots: Record<string, string[]>, extra: Record<string, unknown> = {}) {
  return {
    id: `row-${entryIndex}`, chatId: 'chat-1', characterId: 'char-1', entryIndex,
    slots: { ...EMPTY, ...slots }, slotsHash: 'x'.repeat(16), source: 'operator',
    actorCharacterId: null, isCurrent: false, createdAt: '2026-10-16T00:00:00.000Z', ...extra,
  }
}

function makeCtx(rows: any[]) {
  const ctx: any = {
    user: { id: 'user-1' },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', projectId: null }),
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue({ ...EMPTY, top: ['dress'] }),
        setEquippedOutfit: jest.fn(async (_c: string, _ch: string, slots: unknown) => slots),
      },
      characters: {
        findByIdRaw: jest.fn(async (id: string) => ({ id, name: id === 'char-1' ? 'Bertie' : 'Jeeves' })),
      },
      wardrobeHistory: { ...historyDouble(), findEntries: jest.fn().mockResolvedValue(rows) },
    },
  }
  ctx.repos.wardrobeWear = ledgerOver(ctx.repos.chats)
  return ctx
}

function getReq(characterId?: string): any {
  const params = new URLSearchParams({ action: 'wardrobe-history' })
  if (characterId) params.set('characterId', characterId)
  return { nextUrl: new URL(`http://localhost/api/v1/chats/chat-1?${params}`) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLoadPool.mockImplementation(async (_repos, characterId) => poolOf(characterId, [dress, coat]) as any)
})

describe('GET ?action=wardrobe-history', () => {
  it('lists entries with labels, the cursor, and stale items marked', async () => {
    const ctx = makeCtx([
      row(0, { top: ['dress'] }, { source: 'chat-start' }),
      row(1, { top: ['coat', 'gone'] }, { source: 'character', actorCharacterId: 'char-2' }),
      row(2, { top: ['dress'] }, { source: 'operator', isCurrent: true }),
    ])
    const response = await handleGetWardrobeHistory(getReq('char-1'), 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.currentIndex).toBe(2)
    expect(body.entries.map((e: any) => [e.index, e.changedBy, e.isCurrent])).toEqual([
      [0, 'chat opened', false],
      [1, 'Jeeves', false],
      [2, 'the operator', true],
    ])
    expect(body.entries[1].slots.top).toEqual([
      { itemId: 'coat', title: 'Greatcoat', archived: true, missing: false },
      { itemId: 'gone', title: null, archived: false, missing: true },
    ])
    expect(mockLoadPool).toHaveBeenCalledWith(ctx.repos, 'char-1', undefined, { chatId: 'chat-1', operator: true })
  })

  it('answers an empty record without loading the pool', async () => {
    const response = await handleGetWardrobeHistory(getReq('char-1'), 'chat-1', makeCtx([]))
    expect(await response.json()).toEqual({ currentIndex: null, entries: [] })
    expect(mockLoadPool).not.toHaveBeenCalled()
  })

  it('requires characterId', async () => {
    const response = await handleGetWardrobeHistory(getReq(), 'chat-1', makeCtx([]))
    expect(response.status).toBe(400)
  })
})

describe('POST ?action=wardrobe-rollback', () => {
  const postReq = (body: unknown): any => ({ json: async () => body })

  it('rolls back as an operator change: one commit, a cursor move, skipped items reported', async () => {
    const ctx = makeCtx([
      row(0, { top: ['dress', 'coat'], bottom: ['dress'] }),
      row(1, { top: ['dress'] }, { isCurrent: true }),
    ])
    const response = await handleWardrobeRollback(postReq({ characterId: 'char-1', index: 0 }), 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      previousIndex: 1,
      restoredIndex: 0,
      equippedSlots: { ...EMPTY, top: ['dress'], bottom: ['dress'] },
      skipped: [{ itemId: 'coat', title: 'Greatcoat', reason: 'archived' }],
    })
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledTimes(1)
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ui', wornBundles: [] }),
    )
    expect(ctx.repos.wardrobeHistory.settle).toHaveBeenCalledWith('chat-1', 'char-1', { kind: 'cursor', index: 0 })
  })

  it('answers a refusal with 400 and changes nothing', async () => {
    const ctx = makeCtx([row(0, {}), row(1, {}, { isCurrent: true })])
    const response = await handleWardrobeRollback(postReq({ characterId: 'char-1', index: 1 }), 'chat-1', ctx)
    expect(response.status).toBe(400)
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
  })

  it('requires an index', async () => {
    const response = await handleWardrobeRollback(postReq({ characterId: 'char-1' }), 'chat-1', makeCtx([]))
    expect(response.status).toBe(400)
  })
})
