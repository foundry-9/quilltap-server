/**
 * Chats API v1 — `?action=equip` and `?action=outfit-summary`.
 *
 * Every put-on gesture resolves against the character's wearable pool and the
 * shared wear-ops refusals (not found → 404; archived, bug 191, or a slot the
 * item doesn't cover → 400), then commits through the wear ledger's
 * chokepoint. The summary resolves each character's slots against that
 * character's own pool by the canonical routing rule
 * (`resolveEquippedOutfitForCharacter`): composites expand and every leaf lands
 * in the slots its own `types` cover.
 *
 * The pool loaders are mocked at the seam; the pools themselves are real
 * (`buildWearablePool`), so precedence and the archived rule are the
 * production ones.
 */

import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'
import { buildWearablePool, loadCastPools, loadWearablePool } from '@/lib/wardrobe/pool'

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
  loadCastPools: jest.fn(),
}))

const { handleEquipSlot, handleGetOutfitSummary } = require('@/app/api/v1/chats/[id]/actions/outfit')

const mockLoadPool = loadWearablePool as jest.MockedFunction<typeof loadWearablePool>
const mockLoadCastPools = loadCastPools as jest.MockedFunction<typeof loadCastPools>

const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

function makeRequest(body: unknown): any {
  return {
    json: async () => body,
  }
}

function wardrobeItem(id: string, title: string, types: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    characterId: 'char-1',
    title,
    types,
    componentItemIds: [] as string[],
    appropriateness: null,
    isDefault: false,
    replace: false,
    archivedAt: null,
    description: null,
    createdAt: '2026-04-26T22:10:49.081Z',
    updatedAt: '2026-04-26T22:10:49.081Z',
    ...extra,
  }
}

/** A real pool: `own` in the character's vault, `general` in Quilltap General. */
function poolOf(characterId: string, own: any[], general: any[] = []) {
  const tag = (scope: 'character' | 'general') => (item: any) => ({
    ...item,
    origin: { scope, id: scope === 'character' ? characterId : null, name: '' },
  })
  return buildWearablePool(
    characterId,
    { groupMountPointIds: [], projectMountPointIds: [] },
    { own: own.map(tag('character')), group: [], project: [], general: general.map(tag('general')) },
  )
}

function makeCtx() {
  const ctx: any = {
    user: { id: 'user-1' },
    repos: {
      wardrobe: {},
      chats: {
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', projectId: null }),
        update: jest.fn().mockResolvedValue(undefined),
        getEquippedOutfit: jest.fn(),
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
        setEquippedOutfit: jest.fn(async (_chatId: string, _charId: string, slots: unknown) => slots),
      },
      characters: {
        findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Gary' }),
      },
    },
  }
  ctx.repos.wardrobeWear = ledgerOver(ctx.repos.chats)
  return ctx
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('chats [id] equip action — pool lookup', () => {
  let ctx: any
  const vaultItem = wardrobeItem('c52b1e29-6a6b-84a6-8084-d5b1d0bf4d7d', 'Black athletic shorts', ['bottom'])
  const loafers = wardrobeItem('shoes-1', 'Loafers', ['footwear'])

  beforeEach(() => {
    ctx = makeCtx()
    mockLoadPool.mockImplementation(async (_repos, characterId) => poolOf(characterId, [vaultItem, loafers]))
  })

  it('equips a vault item found in the wearable pool (mode: equip)', async () => {
    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'equip', itemId: vaultItem.id }),
      'chat-1',
      ctx,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots).toEqual({ ...EMPTY, bottom: [vaultItem.id] })

    // The operator is dressing the character: the pool resolves the project
    // tier from the chat and the roster does not apply.
    expect(mockLoadPool).toHaveBeenCalledWith(ctx.repos, 'char-1', undefined, {
      chatId: 'chat-1',
      operator: true,
    })
    expect(ctx.repos.chats.setEquippedOutfit).toHaveBeenCalledWith(
      'chat-1',
      'char-1',
      expect.objectContaining({ bottom: [vaultItem.id] }),
    )
  })

  it('equips a shared (General) item the character can reach', async () => {
    const cravat = wardrobeItem('cravat-1', 'Cravat', ['accessories'], { characterId: null })
    mockLoadPool.mockImplementation(async (_repos, characterId) => poolOf(characterId, [], [cravat]))

    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'wear', itemId: 'cravat-1' }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(200)
    expect((await response.json()).equippedSlots.accessories).toEqual(['cravat-1'])
  })

  it('returns 404 when the item is not in the pool (mode: equip)', async () => {
    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'equip', itemId: 'never-existed' }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(404)
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
  })

  it('rejects an item whose types do not cover the requested slot (mode: add_to_slot)', async () => {
    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'add_to_slot', slot: 'top', itemId: 'shoes-1' }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('cannot be added to the "top" slot')
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
  })

  it('removes a specific item from a slot without loading a pool (mode: remove_from_slot)', async () => {
    ctx.repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({ ...EMPTY, top: ['t-shirt-1', 'cardigan-1'] })

    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'remove_from_slot', slot: 'top', itemId: 't-shirt-1' }),
      'chat-1',
      ctx,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots.top).toEqual(['cardigan-1'])
    // Taking off is structural — no item lookup.
    expect(mockLoadPool).not.toHaveBeenCalled()
  })

  it('clears a slot entirely (mode: clear_slot)', async () => {
    ctx.repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
      ...EMPTY,
      top: ['t-shirt-1', 'cardigan-1'],
      bottom: ['jeans-1'],
    })

    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'clear_slot', slot: 'top' }),
      'chat-1',
      ctx,
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots).toEqual({ ...EMPTY, bottom: ['jeans-1'] })
  })
})

describe('chats [id] equip action — wear ledger', () => {
  let ctx: any
  const SHIRT = '5a1e0000-0000-4000-8000-000000000001'
  const SLACKS = '5a1e0000-0000-4000-8000-000000000002'
  const SUIT = '5a1e0000-0000-4000-8000-000000000003'
  const COAT = '5a1e0000-0000-4000-8000-000000000009'
  const shirt = wardrobeItem(SHIRT, 'Shirt', ['top'])
  const slacks = wardrobeItem(SLACKS, 'Slacks', ['bottom'])
  const suit = wardrobeItem(SUIT, 'Suit', ['top', 'bottom'], { componentItemIds: [SHIRT, SLACKS] })
  const coat = wardrobeItem(COAT, 'Winter Coat', ['top'], { archivedAt: '2026-09-01T00:00:00.000Z' })

  beforeEach(() => {
    ctx = makeCtx()
    mockLoadPool.mockImplementation(async (_repos, characterId) => poolOf(characterId, [shirt, slacks, suit, coat]))
  })

  it('set_all forwards the reachable worn bundles, expanded to their leaves', async () => {
    const response = await handleEquipSlot(
      makeRequest({
        characterId: 'char-1',
        mode: 'set_all',
        slots: { ...EMPTY, top: [SHIRT], bottom: [SLACKS] },
        wornBundleIds: [SUIT, SHIRT, 'not-reachable'],
      }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(200)
    const input = ctx.repos.wardrobeWear.commitEquippedOutfit.mock.calls[0][0]
    expect(input).toMatchObject({
      chatId: 'chat-1',
      characterId: 'char-1',
      source: 'ui',
      // A leaf claimed as a bundle and an id the character cannot see are dropped.
      wornBundles: [{ id: SUIT, leafIds: [SHIRT, SLACKS] }],
    })
  })

  it('set_all without wornBundleIds claims nothing', async () => {
    await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'set_all', slots: { ...EMPTY, top: [SHIRT] } }),
      'chat-1',
      ctx,
    )
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit.mock.calls[0][0].wornBundles).toEqual([])
  })

  it('set_all refuses an id the character cannot reach', async () => {
    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'set_all', slots: { ...EMPTY, top: ['someone-elses'] } }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(400)
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
  })

  describe('archived items (bug 191)', () => {
    it.each(['wear', 'replace', 'equip'])("mode %s refuses an archived item with the tool's words", async (mode) => {
      const response = await handleEquipSlot(makeRequest({ characterId: 'char-1', mode, itemId: COAT }), 'chat-1', ctx)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('"Winter Coat" is archived and cannot be worn')
      expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
    })

    it('add_to_slot refuses an archived item', async () => {
      const response = await handleEquipSlot(
        makeRequest({ characterId: 'char-1', mode: 'add_to_slot', slot: 'top', itemId: COAT }),
        'chat-1',
        ctx,
      )
      expect(response.status).toBe(400)
      expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
    })

    it('set_all refuses a fitting that newly puts on an archived item', async () => {
      const response = await handleEquipSlot(
        makeRequest({ characterId: 'char-1', mode: 'set_all', slots: { ...EMPTY, top: [COAT] } }),
        'chat-1',
        ctx,
      )
      expect(response.status).toBe(400)
      expect(ctx.repos.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled()
    })

    it('set_all lets an archived item already being worn stay on', async () => {
      ctx.repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({ ...EMPTY, top: [COAT] })
      const response = await handleEquipSlot(
        makeRequest({ characterId: 'char-1', mode: 'set_all', slots: { ...EMPTY, top: [COAT], bottom: [SLACKS] } }),
        'chat-1',
        ctx,
      )
      expect(response.status).toBe(200)
      expect(ctx.repos.wardrobeWear.commitEquippedOutfit).toHaveBeenCalledTimes(1)
    })
  })

  it('wearing a bundle claims it with the leaves it dissolved into', async () => {
    await handleEquipSlot(makeRequest({ characterId: 'char-1', mode: 'wear', itemId: SUIT }), 'chat-1', ctx)
    const input = ctx.repos.wardrobeWear.commitEquippedOutfit.mock.calls[0][0]
    expect(input).toMatchObject({ source: 'ui', wornBundles: [{ id: SUIT, leafIds: [SHIRT, SLACKS] }] })
    expect(input.nextSlots).toMatchObject({ top: [SHIRT], bottom: [SLACKS] })
  })

  it('set_all reports a failed save instead of success, and schedules nothing', async () => {
    const { enqueueWardrobeOutfitAnnouncement } = require('@/lib/background-jobs/queue-service')
    ctx.repos.wardrobeWear.commitEquippedOutfit.mockRejectedValueOnce(new Error('disk full'))
    const response = await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'set_all', slots: { ...EMPTY, top: [SHIRT] } }),
      'chat-1',
      ctx,
    )
    expect(response.status).toBe(500)
    expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
  })

  it("taking off is committed as 'take-off'", async () => {
    await handleEquipSlot(
      makeRequest({ characterId: 'char-1', mode: 'clear_slot', slot: 'top' }),
      'chat-1',
      ctx,
    )
    expect(ctx.repos.wardrobeWear.commitEquippedOutfit.mock.calls[0][0]).toMatchObject({ source: 'take-off', wornBundles: [] })
  })
})

describe('chats [id] outfit-summary', () => {
  let ctx: any
  const blouse = wardrobeItem('blouse', 'Blouse', ['top'])
  const trousers = wardrobeItem('trousers', 'Trousers', ['bottom'])
  const loafers = wardrobeItem('loafers', 'Loafers', ['footwear'])
  const casual = wardrobeItem('casual', 'Casual Outfit', ['top', 'bottom', 'footwear'], {
    componentItemIds: ['blouse', 'trousers', 'loafers'],
  })
  const dress = wardrobeItem('dress', 'Silk Dress', ['top', 'bottom'])

  beforeEach(() => {
    ctx = makeCtx()
    ctx.repos.chats.findById.mockResolvedValue({ id: 'chat-1', projectId: 'proj-1' })
  })

  it("resolves each character against their own pool and routes leaves by their own types", async () => {
    ctx.repos.chats.getEquippedOutfit.mockResolvedValue({
      // A legacy composite stored in one slot: its parts spread to their own slots.
      'char-1': { ...EMPTY, top: ['casual'] },
      // A multi-slot leaf stored in one slot lands in both.
      'char-2': { ...EMPTY, top: ['dress'] },
    })
    mockLoadCastPools.mockResolvedValue(
      new Map([
        ['char-1', poolOf('char-1', [blouse, trousers, loafers, casual])],
        // char-2 cannot see char-1's casual outfit; only their own dress.
        ['char-2', poolOf('char-2', [dress])],
      ]),
    )

    const response = await handleGetOutfitSummary('chat-1', ctx)
    expect(response.status).toBe(200)
    const { summary } = await response.json()

    expect(mockLoadCastPools).toHaveBeenCalledWith(ctx.repos, 'proj-1', ['char-1', 'char-2'])
    expect(summary['char-1']).toEqual({
      top: [{ itemId: 'blouse', title: 'Blouse' }],
      bottom: [{ itemId: 'trousers', title: 'Trousers' }],
      footwear: [{ itemId: 'loafers', title: 'Loafers' }],
      accessories: [],
      hair: [],
    })
    expect(summary['char-2']).toEqual({
      top: [{ itemId: 'dress', title: 'Silk Dress' }],
      bottom: [{ itemId: 'dress', title: 'Silk Dress' }],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it("drops an id outside the character's own pool rather than borrowing another character's item", async () => {
    ctx.repos.chats.getEquippedOutfit.mockResolvedValue({ 'char-2': { ...EMPTY, top: ['blouse', 'dress'] } })
    mockLoadCastPools.mockResolvedValue(new Map([['char-2', poolOf('char-2', [dress])]]))

    const { summary } = await (await handleGetOutfitSummary('chat-1', ctx)).json()
    expect(summary['char-2'].top).toEqual([{ itemId: 'dress', title: 'Silk Dress' }])
  })

  it('returns 404 for a missing chat', async () => {
    ctx.repos.chats.findById.mockResolvedValue(null)
    const response = await handleGetOutfitSummary('chat-1', ctx)
    expect(response.status).toBe(404)
    expect(mockLoadCastPools).not.toHaveBeenCalled()
  })
})
