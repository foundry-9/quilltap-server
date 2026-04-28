import { describe, expect, it, jest, beforeEach } from '@jest/globals'

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
  })

  it('equips a vault-only wardrobe item via the overlay lookup', async () => {
    // The user's reported case: a Wardrobe/<title>.md file in the vault yields
    // a stable derived UUID. The legacy raw findById returns null because no
    // DB row exists; the equip handler must instead use findByIdForCharacter.
    const vaultItem = {
      id: 'c52b1e29-6a6b-84a6-8084-d5b1d0bf4d7d',
      characterId: 'char-1',
      title: 'Black athletic shorts',
      types: ['bottom'],
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
      slot: 'bottom',
      itemId: vaultItem.id,
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.equippedSlots).toEqual({
      top: null,
      bottom: vaultItem.id,
      footwear: null,
      accessories: null,
    })

    // The handler must use the overlay-aware lookup, not the raw one.
    expect(ctx.repos.wardrobe.findByIdForCharacter).toHaveBeenCalledWith(
      'char-1',
      vaultItem.id
    )
    expect(ctx.repos.wardrobe.findById).not.toHaveBeenCalled()

    // Slots must be persisted.
    expect(ctx.repos.chats.setEquippedOutfit).toHaveBeenCalledWith(
      'chat-1',
      'char-1',
      expect.objectContaining({ bottom: vaultItem.id })
    )

    // Phase D: per-turn `pendingOutfitNotifications` flow has been retired in
    // favour of the debounced Aurora announcement, so the equip handler no
    // longer performs its own bulk wardrobe lookup. The overlay-aware lookup
    // moved into the debounced job (`handleWardrobeOutfitAnnouncement`).
  })

  it('returns 404 when neither the overlay nor archetype lookup finds the item', async () => {
    ctx.repos.wardrobe.findByIdForCharacter.mockResolvedValue(null)

    const req = makeRequest({
      characterId: 'char-1',
      slot: 'top',
      itemId: 'never-existed',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    expect(response.status).toBe(404)
    expect(ctx.repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
  })

  it('rejects an item whose types do not cover the requested slot', async () => {
    ctx.repos.wardrobe.findByIdForCharacter.mockResolvedValue({
      id: 'shoes-1',
      characterId: 'char-1',
      title: 'Loafers',
      types: ['footwear'],
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
      slot: 'top',
      itemId: 'shoes-1',
    })

    const response = await handleEquipSlot(req, 'chat-1', ctx)
    expect(response.status).toBe(400)
    expect(ctx.repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
  })
})
