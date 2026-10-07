/**
 * The wear ledger on the two hand-written wardrobe routes — the character's
 * own and Quilltap General. (The group/project tiers go through the route
 * factory and are pinned in `mount-wardrobe-route-factory.test.ts`.)
 *
 *   - Every collection GET attaches `wear` to each item from ONE
 *     `findSummaries` call, alongside `origin`.
 *   - Item GET `?action=wear-history` answers `{ history, wearers,
 *     lastWornChat }`, naming wearers through the raw read and labelling the
 *     ones it cannot name, and only after the item has been found in its tier.
 *
 * Design of record: docs/developer/features/complete/wardrobe-wear-ledger.md §5.1
 */

// Use global `jest` so module mocks hoist before the route imports.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => {
  const actions = jest.requireActual('@/lib/api/middleware/actions')
  return {
    createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) =>
      async (req: any) => handler(req, mockCtx),
    createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
      async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params),
    exists: (entity: unknown) => entity != null,
    withActionDispatch: actions.withActionDispatch,
    withCollectionActionDispatch: actions.withCollectionActionDispatch,
    dispatchAction: actions.dispatchAction,
  }
})

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  resolveWardrobeMount: jest.fn(),
}))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {},
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountsForCharacter: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}))

jest.mock('@/lib/mount-index/general-wardrobe', () => ({
  ensureGeneralWardrobeFolder: jest.fn(),
}))

jest.mock('@/lib/wardrobe/wardrobe-instructions-handlers', () => ({
  parseWardrobeInstructionsBody: jest.fn(),
  handleReadWardrobeInstructions: jest.fn(),
  handleWriteWardrobeInstructions: jest.fn(),
}))

import { GET as GET_CHARACTER_LIST } from '@/app/api/v1/characters/[id]/wardrobe/route'
import { GET as GET_CHARACTER_ITEM } from '@/app/api/v1/characters/[id]/wardrobe/[itemId]/route'
import { GET as GET_GENERAL_LIST } from '@/app/api/v1/wardrobe/route'
import { GET as GET_GENERAL_ITEM } from '@/app/api/v1/wardrobe/[itemId]/route'

const CHAR_ID = '11111111-1111-4111-8111-111111111111'
const MARGUERITE = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'
const CHAT_ID = '44444444-4444-4444-8444-444444444444'

const NEVER_WORN = { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null }
const WORN = {
  wearCount: 4,
  firstWornAt: '2026-03-14T10:00:00.000Z',
  lastWornAt: '2026-10-04T10:00:00.000Z',
  lastWornChatId: CHAT_ID,
}

const HISTORY = {
  ...WORN,
  wearers: [
    { characterId: CHAR_ID, wearCount: 2, firstWornAt: '2026-05-01T10:00:00.000Z', lastWornAt: '2026-10-04T10:00:00.000Z', lastWornChatId: CHAT_ID },
    { characterId: MARGUERITE, wearCount: 1, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: '2026-03-14T10:00:00.000Z', lastWornChatId: null },
    { characterId: GONE, wearCount: 1, firstWornAt: '2026-04-01T10:00:00.000Z', lastWornAt: '2026-04-01T10:00:00.000Z', lastWornChatId: null },
  ],
}

function item(overrides: Record<string, unknown> = {}) {
  return { id: 'item-1', characterId: CHAR_ID, title: 'Greatcoat', types: ['top'], componentItemIds: [], ...overrides }
}

function req(url: string): any {
  return { url, nextUrl: new URL(url), method: 'GET' }
}

function params(p: Record<string, string>) {
  return { params: Promise.resolve(p) }
}

function buildRepos() {
  const characters: Record<string, { id: string; name: string; defaultImageId: null }> = {
    [CHAR_ID]: { id: CHAR_ID, name: 'Vivienne', defaultImageId: null },
    [MARGUERITE]: { id: MARGUERITE, name: 'Marguerite', defaultImageId: null },
  }
  return {
    characters: {
      findById: jest.fn(async (id: string) => characters[id] ?? null),
      findByIdRaw: jest.fn(async (id: string) => characters[id] ?? null),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: CHAT_ID, title: 'The Thornfield Dinner' }),
    },
    wardrobe: {
      findByCharacterId: jest.fn().mockResolvedValue([item(), item({ id: 'item-2', title: 'Spats' })]),
      findByIdForCharacter: jest.fn().mockResolvedValue(item()),
      findArchetypes: jest.fn().mockResolvedValue([item({ characterId: null })]),
      findArchetypeById: jest.fn().mockResolvedValue(item({ characterId: null })),
      findArchetypesInMountsAttributed: jest.fn().mockResolvedValue([]),
    },
    wardrobeWear: {
      findSummaries: jest.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [id, id === 'item-1' ? WORN : NEVER_WORN])),
      ),
      findHistory: jest.fn().mockResolvedValue(HISTORY),
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx = { user: { id: 'user-1' }, repos: buildRepos() }
})

describe('collection GETs attach wear', () => {
  it('character wardrobe: every item carries its summary beside its origin, from one ledger read', async () => {
    const res: any = await GET_CHARACTER_LIST(
      req(`http://x.test/api/v1/characters/${CHAR_ID}/wardrobe`),
      params({ id: CHAR_ID }),
    )

    expect(res.status).toBe(200)
    expect(mockCtx.repos.wardrobeWear.findSummaries).toHaveBeenCalledTimes(1)
    expect(mockCtx.repos.wardrobeWear.findSummaries).toHaveBeenCalledWith(['item-1', 'item-2'])
    expect(res.body.wardrobeItems).toEqual([
      expect.objectContaining({ id: 'item-1', origin: expect.objectContaining({ scope: 'character' }), wear: WORN }),
      expect.objectContaining({ id: 'item-2', wear: NEVER_WORN }),
    ])
  })

  it('Quilltap General: archetypes carry their summaries', async () => {
    const res: any = await GET_GENERAL_LIST(req('http://x.test/api/v1/wardrobe'))

    expect(res.status).toBe(200)
    expect(res.body.wardrobeItems).toEqual([
      expect.objectContaining({ id: 'item-1', origin: expect.objectContaining({ scope: 'general' }), wear: WORN }),
    ])
  })
})

describe('item GET ?action=wear-history', () => {
  const EXPECTED = {
    history: HISTORY,
    wearers: [
      { characterId: CHAR_ID, name: 'Vivienne', avatarUrl: null },
      { characterId: MARGUERITE, name: 'Marguerite', avatarUrl: null },
      { characterId: GONE, name: 'a departed character', avatarUrl: null },
    ],
    lastWornChat: { id: CHAT_ID, title: 'The Thornfield Dinner' },
  }

  it('character item: resolves names raw and links the chat', async () => {
    const res: any = await GET_CHARACTER_ITEM(
      req(`http://x.test/api/v1/characters/${CHAR_ID}/wardrobe/item-1?action=wear-history`),
      params({ id: CHAR_ID, itemId: 'item-1' }),
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual(EXPECTED)
    expect(mockCtx.repos.characters.findByIdRaw).toHaveBeenCalledWith(GONE)
    expect(mockCtx.repos.chats.findById).toHaveBeenCalledWith(CHAT_ID)
  })

  it('General item: same body; a deleted chat leaves lastWornChat null', async () => {
    mockCtx.repos.chats.findById.mockResolvedValue(null)

    const res: any = await GET_GENERAL_ITEM(
      req('http://x.test/api/v1/wardrobe/item-1?action=wear-history'),
      params({ itemId: 'item-1' }),
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...EXPECTED, lastWornChat: null })
  })

  it('404s before reading the ledger when the item is not in the tier', async () => {
    mockCtx.repos.wardrobe.findByIdForCharacter.mockResolvedValue(null)

    const res: any = await GET_CHARACTER_ITEM(
      req(`http://x.test/api/v1/characters/${CHAR_ID}/wardrobe/nope?action=wear-history`),
      params({ id: CHAR_ID, itemId: 'nope' }),
    )

    expect(res.status).toBe(404)
    expect(mockCtx.repos.wardrobeWear.findHistory).not.toHaveBeenCalled()
  })

  it('without an action, still serves the item itself', async () => {
    const res: any = await GET_GENERAL_ITEM(
      req('http://x.test/api/v1/wardrobe/item-1'),
      params({ itemId: 'item-1' }),
    )

    expect(res.status).toBe(200)
    expect(res.body.wardrobeItem).toEqual(expect.objectContaining({ id: 'item-1' }))
    expect(mockCtx.repos.wardrobeWear.findHistory).not.toHaveBeenCalled()
  })
})
