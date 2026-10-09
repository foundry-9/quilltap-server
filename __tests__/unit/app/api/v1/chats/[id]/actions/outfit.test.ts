import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'
import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'

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

const { handleEquipSlot } = require('@/app/api/v1/chats/[id]/actions/outfit')

function makeRequest(body: unknown): any {
  return {
    json: async () => body,
  }
}

describe('chats [id] equip action — vault-overlay regression', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    ctx = {
      user: { id: 'user-1' },
      repos: {
        wardrobe: {
          // Raw DB-only path returns null for vault-only items (no DB row).
          findById: jest.fn().mockResolvedValue(null),
          findByIds: jest.fn().mockResolvedValue([]),
          // Overlay-aware lookup resolves the vault item by stable UUID.
          findByIdForCharacter: jest.fn(),
          findByIdsForCharacter: jest.fn(),
        },
        chats: {
          findById: jest.fn(),
          update: jest.fn().mockResolvedValue(undefined),
          getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
          setEquippedOutfit: jest.fn().mockImplementation(
            async (_chatId: string, _charId: string, slots: unknown) => slots
          ),
        },
        characters: {
          findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Gary' }),
        },
      },
    }
    ctx.repos.wardrobeWear = ledgerOver(ctx.repos.chats)
  })

  it('equips a vault-only wardrobe item via the overlay lookup (mode: equip)', async () => {
    // The user's reported case: a Wardrobe/<title>.md file in the vault yields
    // a stable derived UUID. The legacy raw findById returns null because no
    // DB row exists; the equip handler must instead use findByIdForCharacter.
    const vaultItem = {
      id: 'c52b1e29-6a6b-84a6-8084-d5b1d0bf4d7d',
      characterId: 'char-1',
      title: 'Black athletic shorts',
      types: ['bottom'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      archivedAt: null,
      description: null,
      migratedFromClothingRecordId: null,
      createdAt: '2026-04-26T22:10:49.081Z',
      updatedAt: '2026-04-26T22:10:49.081Z',
    }
    ctx.repos.wardrobe.findByIdForCharacter.mockResolvedValue(vaultItem)
    ctx.repos.wardrobe.findByIdsForCharacter.mockResolvedValue([vaultItem])
    ctx.repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      pendingOutfitNotifications: null,
    })

    const req = makeRequest({
      characterId: 'char-1',
      mode: 'equip',
      itemId: vaultItem.id,
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    // Slots are arrays now; equipItem replaces every slot covered by the
    // item's types (here, just `bottom`).
    expect(body.equippedSlots).toEqual({
      top: [],
      bottom: [vaultItem.id],
      footwear: [],
      accessories: [],
      hair: [],
    })

    // The handler must use the overlay-aware lookup, not the raw one. It now
    // also passes the resolved project tier (empty here — no project context).
    expect(ctx.repos.wardrobe.findByIdForCharacter).toHaveBeenCalledWith(
      'char-1',
      vaultItem.id,
      expect.objectContaining({ projectMountPointIds: [] })
    )
    expect(ctx.repos.wardrobe.findById).not.toHaveBeenCalled()

    // Slots must be persisted.
    expect(ctx.repos.chats.setEquippedOutfit).toHaveBeenCalledWith(
      'chat-1',
      'char-1',
      expect.objectContaining({ bottom: [vaultItem.id] })
    )
  })

  it('returns 404 when neither the overlay nor archetype lookup finds the item (mode: equip)', async () => {
    ctx.repos.wardrobe.findByIdForCharacter.mockResolvedValue(null)

    const req = makeRequest({
      characterId: 'char-1',
      mode: 'equip',
      itemId: 'never-existed',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    expect(response.status).toBe(404)
    expect(ctx.repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
  })

  it('rejects an item whose types do not cover the requested slot (mode: add_to_slot)', async () => {
    // For `equip`, the cascade infers slots from item.types so a "shoes in top"
    // call is meaningless. For `add_to_slot`, an explicit slot is required and
    // the handler validates it against item.types.
    ctx.repos.wardrobe.findByIdForCharacter.mockResolvedValue({
      id: 'shoes-1',
      characterId: 'char-1',
      title: 'Loafers',
      types: ['footwear'],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      archivedAt: null,
      description: null,
      migratedFromClothingRecordId: null,
      createdAt: '2026-04-26T22:10:49.081Z',
      updatedAt: '2026-04-26T22:10:49.081Z',
    })

    const req = makeRequest({
      characterId: 'char-1',
      mode: 'add_to_slot',
      slot: 'top',
      itemId: 'shoes-1',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    expect(response.status).toBe(400)
    expect(ctx.repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
  })

  it('removes a specific item from a slot (mode: remove_from_slot)', async () => {
    ctx.repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
      top: ['t-shirt-1', 'cardigan-1'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })

    const req = makeRequest({
      characterId: 'char-1',
      mode: 'remove_from_slot',
      slot: 'top',
      itemId: 't-shirt-1',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots.top).toEqual(['cardigan-1'])
    // remove_from_slot doesn't need an item lookup — the slot edit is structural.
    expect(ctx.repos.wardrobe.findByIdForCharacter).not.toHaveBeenCalled()
  })

  it('clears a slot entirely (mode: clear_slot)', async () => {
    ctx.repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
      top: ['t-shirt-1', 'cardigan-1'],
      bottom: ['jeans-1'],
      footwear: [],
      accessories: [],
      hair: [],
    })

    const req = makeRequest({
      characterId: 'char-1',
      mode: 'clear_slot',
      slot: 'top',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots).toEqual({
      top: [],
      bottom: ['jeans-1'],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })
})

describe('chats [id] equip action — wear ledger', () => {
  let ctx: any
  const SHIRT = '5a1e0000-0000-4000-8000-000000000001'
  const SLACKS = '5a1e0000-0000-4000-8000-000000000002'
  const SUIT = '5a1e0000-0000-4000-8000-000000000003'
  const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }
  const shirt = { id: SHIRT, title: 'Shirt', types: ['top'], componentItemIds: [] }
  const slacks = { id: SLACKS, title: 'Slacks', types: ['bottom'], componentItemIds: [] }
  const suit = { id: SUIT, title: 'Suit', types: ['top', 'bottom'], componentItemIds: [SHIRT, SLACKS] }
  const all = new Map<string, any>([shirt, slacks, suit].map((i) => [i.id, i]))

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = {
      user: { id: 'user-1' },
      repos: {
        wardrobe: {
          findByIdForCharacter: jest.fn(async (_c: string, id: string) => all.get(id) ?? null),
          findByIdsForCharacter: jest.fn(async (_c: string, ids: string[]) =>
            ids.map((id) => all.get(id)).filter(Boolean),
          ),
        },
        chats: {
          findById: jest.fn(),
          getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
          setEquippedOutfit: jest.fn(async (_c: string, _ch: string, slots: unknown) => slots),
        },
        characters: { findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Gary' }) },
      },
    }
    ctx.repos.wardrobeWear = ledgerOver(ctx.repos.chats)
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

  describe('archived items (bug 191)', () => {
    const COAT = '5a1e0000-0000-4000-8000-000000000009'
    const coat = { id: COAT, title: 'Winter Coat', types: ['top'], componentItemIds: [], archivedAt: '2026-09-01T00:00:00.000Z' }
    beforeEach(() => { all.set(COAT, coat) })
    afterEach(() => { all.delete(COAT) })

    it.each(['wear', 'replace'])('mode %s refuses an archived item with the tool\'s words', async (mode) => {
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
