import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

// The tool handlers call these primitives to actually mutate `chats.equippedOutfit`.
// Mocking lets us assert directly on which primitive was invoked with which arguments;
// per-test setup of `repos.chats.getEquippedOutfitForCharacter` continues to drive the
// `current_state` returned by the handler (it's read after the mutation).
jest.mock('@/lib/wardrobe/outfit-displacement', () => ({
  equipItem: jest.fn(),
  addToSlot: jest.fn(),
  removeFromSlot: jest.fn(),
}))

// CommonJS require resolves AFTER jest.mock factories have run, so both the
// handlers under test and the mock bindings stay in sync. Static `import`
// statements get hoisted by SWC and can resolve before the mock takes effect.
const { getRepositories } = require('@/lib/repositories/factory')
const { executeWardrobeChangeItemTool } = require('@/lib/tools/handlers/wardrobe-change-item-handler')
const { executeWardrobeCreateItemTool } = require('@/lib/tools/handlers/wardrobe-create-item-handler')
const { executeWardrobeListTool } = require('@/lib/tools/handlers/wardrobe-list-handler')
const { executeWardrobeUpdateOutfitTool } = require('@/lib/tools/handlers/wardrobe-update-outfit-handler')
const outfitDisplacement = require('@/lib/wardrobe/outfit-displacement')

const mockGetRepositories = getRepositories as jest.Mock
const mockEquipItem = outfitDisplacement.equipItem as jest.Mock
const mockAddToSlot = outfitDisplacement.addToSlot as jest.Mock
const mockRemoveFromSlot = outfitDisplacement.removeFromSlot as jest.Mock

const now = '2026-04-07T00:00:00.000Z'

const makeWardrobeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  characterId: 'char-1',
  title: 'Evening Dress',
  description: 'A formal velvet dress',
  types: ['top', 'bottom'],
  componentItemIds: [],
  appropriateness: 'formal evening',
  isDefault: false,
  archivedAt: null,
  migratedFromClothingRecordId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

describe('wardrobe tool handlers', () => {
  const context = {
    userId: 'user-1',
    chatId: 'chat-1',
    characterId: 'char-1',
  }

  let repos: any

  beforeEach(() => {
    jest.clearAllMocks()

    repos = {
      wardrobe: {
        findByCharacterId: jest.fn(),
        findById: jest.fn(),
        // Bulk lookup used by buildCoverageSummaryFromState — defaults to empty.
        findByIds: jest.fn().mockResolvedValue([]),
        // Overlay-aware single-item lookup used by the equip primitives.
        findByIdForCharacter: jest.fn((_charId: string, id: string) =>
          repos.wardrobe.findById(id)
        ),
        create: jest.fn(),
      },
      chats: {
        getEquippedOutfitForCharacter: jest.fn(),
        setEquippedOutfit: jest
          .fn()
          .mockImplementation(async (_chatId: string, _charId: string, slots: unknown) => slots),
        findById: jest.fn(),
      },
    }

    mockGetRepositories.mockReturnValue(repos as any)

    // Default the displacement primitives to resolved no-ops; tests that need to
    // observe state changes drive `getEquippedOutfitForCharacter` directly.
    mockEquipItem.mockResolvedValue({ top: [], bottom: [], footwear: [], accessories: [] })
    mockAddToSlot.mockResolvedValue({ top: [], bottom: [], footwear: [], accessories: [] })
    mockRemoveFromSlot.mockResolvedValue({ top: [], bottom: [], footwear: [], accessories: [] })
  })

  describe('executeWardrobeListTool', () => {
    it('lists wardrobe items with filters and equipped-slot annotations', async () => {
      repos.wardrobe.findByCharacterId.mockResolvedValue([
        makeWardrobeItem(),
        makeWardrobeItem({
          id: 'boots-1',
          title: 'Riding Boots',
          description: 'Polished leather boots',
          types: ['footwear'],
          appropriateness: 'casual outdoor',
        }),
        makeWardrobeItem({
          id: 'scarf-1',
          title: 'Silk Scarf',
          types: ['accessories'],
          appropriateness: 'formal gala',
        }),
      ])
      // Slots are arrays now: a multi-slot item shows up in every slot it covers.
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['item-1'],
        bottom: ['item-1'],
        footwear: ['boots-1'],
        accessories: [],
      })

      const result = await executeWardrobeListTool(
        {
          type_filter: ['top', 'accessories'],
          appropriateness_filter: 'formal',
        },
        context
      )

      expect(result.success).toBe(true)
      expect(result.total_count).toBe(2)
      expect(result.items).toEqual([
        expect.objectContaining({
          item_id: 'item-1',
          is_equipped: true,
          // For multi-slot items, equipped_slot reports the first slot in
          // canonical WARDROBE_SLOT_TYPES order (top before bottom).
          equipped_slot: 'top',
        }),
        expect.objectContaining({
          item_id: 'scarf-1',
          is_equipped: false,
          equipped_slot: null,
        }),
      ])
    })

    it('can exclude currently equipped items from wardrobe results', async () => {
      repos.wardrobe.findByCharacterId.mockResolvedValue([
        makeWardrobeItem({ id: 'top-1', title: 'Blouse', types: ['top'] }),
        makeWardrobeItem({ id: 'top-2', title: 'Cardigan', types: ['top'] }),
      ])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['top-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeListTool(
        { type_filter: ['top'], include_equipped: false },
        context
      )

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.item_id).toBe('top-2')
    })

    it('excludes archived items from the list', async () => {
      repos.wardrobe.findByCharacterId.mockResolvedValue([
        makeWardrobeItem({ id: 'active-1', title: 'Travel Coat', types: ['top'] }),
        makeWardrobeItem({
          id: 'archived-1',
          title: 'Old Cloak',
          types: ['top'],
          archivedAt: '2026-04-08T00:00:00.000Z',
        }),
      ])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeListTool({}, context)

      expect(result.success).toBe(true)
      expect(result.items.map((item) => item.item_id)).toEqual(['active-1'])
    })

    it('flags composites with is_composite and resolved component titles', async () => {
      // A composite "rain outfit" references three leaf items; the listing
      // should mark it composite and surface the component titles for the LLM.
      repos.wardrobe.findByCharacterId.mockResolvedValue([
        makeWardrobeItem({
          id: 'raincoat-1',
          title: 'Raincoat',
          types: ['top'],
          componentItemIds: [],
        }),
        makeWardrobeItem({
          id: 'jeans-1',
          title: 'Blue Jeans',
          types: ['bottom'],
          componentItemIds: [],
        }),
        makeWardrobeItem({
          id: 'wellies-1',
          title: 'Wellies',
          types: ['footwear'],
          componentItemIds: [],
        }),
        makeWardrobeItem({
          id: 'rain-outfit',
          title: 'Rain Outfit',
          types: ['top', 'bottom', 'footwear'],
          componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
        }),
      ])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeListTool({}, context)

      expect(result.success).toBe(true)
      const composite = result.items.find((i) => i.item_id === 'rain-outfit') as any
      expect(composite).toBeDefined()
      expect(composite.is_composite).toBe(true)
      expect(composite.component_item_ids).toEqual(['raincoat-1', 'jeans-1', 'wellies-1'])
      expect(composite.component_titles).toEqual(['Raincoat', 'Blue Jeans', 'Wellies'])

      // Leaf items don't get composite metadata.
      const leaf = result.items.find((i) => i.item_id === 'raincoat-1') as any
      expect(leaf.is_composite).toBeUndefined()
    })
  })

  describe('executeWardrobeUpdateOutfitTool — composite items only', () => {
    it('mode: wear — equips a composite, replacing every slot it covers', async () => {
      const raincoat = makeWardrobeItem({
        id: 'raincoat-1',
        title: 'Raincoat',
        types: ['top'],
        componentItemIds: [],
      })
      const jeans = makeWardrobeItem({
        id: 'jeans-1',
        title: 'Blue Jeans',
        types: ['bottom'],
        componentItemIds: [],
      })
      const wellies = makeWardrobeItem({
        id: 'wellies-1',
        title: 'Wellies',
        types: ['footwear'],
        componentItemIds: [],
      })
      const rainOutfit = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })

      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return rainOutfit
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([rainOutfit, raincoat, jeans, wellies])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['rain-outfit'],
        bottom: ['rain-outfit'],
        footwear: ['rain-outfit'],
        accessories: [],
      })

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'wear', item_id: 'rain-outfit' },
        context
      )

      // The composite is dressed via equipItem, which replaces every slot in
      // its types with [composite.id].
      expect(mockEquipItem).toHaveBeenCalledTimes(1)
      expect(mockEquipItem).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', rainOutfit)
      expect(mockRemoveFromSlot).not.toHaveBeenCalled()

      expect(result.success).toBe(true)
      expect(result.action).toBe('worn')
      expect(result.slots_affected).toEqual(['top', 'bottom', 'footwear'])
      expect(result.item).toEqual({ item_id: 'rain-outfit', title: 'Rain Outfit' })
      expect(result.current_state).toEqual({
        top: ['rain-outfit'],
        bottom: ['rain-outfit'],
        footwear: ['rain-outfit'],
        accessories: [],
      })
    })

    it('mode: remove — calls removeFromSlot once per slot in the composite', async () => {
      const rainOutfit = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })

      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return rainOutfit
        return null
      })
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'remove', item_id: 'rain-outfit' },
        context
      )

      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(3)
      expect(mockRemoveFromSlot).toHaveBeenNthCalledWith(
        1,
        repos,
        'chat-1',
        'char-1',
        'top',
        'rain-outfit'
      )
      expect(mockRemoveFromSlot).toHaveBeenNthCalledWith(
        2,
        repos,
        'chat-1',
        'char-1',
        'bottom',
        'rain-outfit'
      )
      expect(mockRemoveFromSlot).toHaveBeenNthCalledWith(
        3,
        repos,
        'chat-1',
        'char-1',
        'footwear',
        'rain-outfit'
      )
      expect(mockEquipItem).not.toHaveBeenCalled()

      expect(result.success).toBe(true)
      expect(result.action).toBe('removed')
      expect(result.slots_affected).toEqual(['top', 'bottom', 'footwear'])
    })

    it('rejects a leaf item (componentItemIds empty) and points at wardrobe_change_item', async () => {
      const tshirt = makeWardrobeItem({
        id: 't-shirt-1',
        title: 'White T-Shirt',
        types: ['top'],
        componentItemIds: [],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 't-shirt-1') return tshirt
        return null
      })

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'wear', item_id: 't-shirt-1' },
        context
      )

      expect(result.success).toBe(false)
      // Error should steer the LLM toward the atomic tool, mentioning either
      // the "single garment" framing or the wardrobe_change_item tool name.
      expect(result.error).toMatch(/single garment|wardrobe_change_item/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
      expect(mockRemoveFromSlot).not.toHaveBeenCalled()
    })

    it('returns NOT_FOUND when neither item_id nor item_title matches anything', async () => {
      repos.wardrobe.findById.mockResolvedValue(null)
      repos.wardrobe.findByCharacterId.mockResolvedValue([])

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'wear', item_title: 'Imaginary Outfit' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
    })

    it('rejects an archived composite outfit', async () => {
      const archivedComposite = makeWardrobeItem({
        id: 'old-outfit',
        title: 'Old Outfit',
        types: ['top', 'bottom'],
        componentItemIds: ['raincoat-1', 'jeans-1'],
        archivedAt: '2026-04-08T00:00:00.000Z',
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'old-outfit') return archivedComposite
        return null
      })

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'wear', item_id: 'old-outfit' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/archived/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
    })

    it('coverage summary expands composites to leaf garments', async () => {
      // After equipping a composite, the coverage builder expands its id into
      // leaf garments and describes those — so the summary should mention the
      // raincoat / jeans / wellies and not "Rain Outfit".
      const raincoat = makeWardrobeItem({
        id: 'raincoat-1',
        title: 'Raincoat',
        types: ['top'],
        componentItemIds: [],
      })
      const jeans = makeWardrobeItem({
        id: 'jeans-1',
        title: 'Blue Jeans',
        types: ['bottom'],
        componentItemIds: [],
      })
      const wellies = makeWardrobeItem({
        id: 'wellies-1',
        title: 'Wellies',
        types: ['footwear'],
        componentItemIds: [],
      })
      const rainOutfit = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })

      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return rainOutfit
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([rainOutfit, raincoat, jeans, wellies])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['rain-outfit'],
        bottom: ['rain-outfit'],
        footwear: ['rain-outfit'],
        accessories: [],
      })

      const result = await executeWardrobeUpdateOutfitTool(
        { mode: 'wear', item_id: 'rain-outfit' },
        context
      )

      expect(result.success).toBe(true)
      // The summary describes the leaves, not the composite itself.
      expect(result.coverage_summary).toContain('Raincoat')
      expect(result.coverage_summary).toContain('Blue Jeans')
      expect(result.coverage_summary).toContain('Wellies')
      expect(result.coverage_summary).not.toContain('Rain Outfit')
    })
  })

  describe('executeWardrobeChangeItemTool — atomic items only', () => {
    it('mode: equip — equips a leaf item, replacing every slot it covers', async () => {
      const dress = makeWardrobeItem({
        id: 'dress-1',
        title: 'Midnight Dress',
        types: ['top', 'bottom'],
        componentItemIds: [],
      })

      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'dress-1') return dress
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([dress])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'equip', item_id: 'dress-1' },
        context
      )

      expect(mockEquipItem).toHaveBeenCalledTimes(1)
      expect(mockEquipItem).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', dress)
      expect(result).toMatchObject({
        success: true,
        action: 'equipped',
        // Multi-slot equip uses the 'inferred' marker because more than one
        // slot was touched in a single call.
        slot: 'inferred',
        item: { item_id: 'dress-1', title: 'Midnight Dress' },
        current_state: {
          top: ['dress-1'],
          bottom: ['dress-1'],
          footwear: [],
          accessories: [],
        },
      })
    })

    it('mode: equip — single-slot leaf reports its concrete slot', async () => {
      const shoes = makeWardrobeItem({
        id: 'shoes-1',
        title: 'Oxford Shoes',
        types: ['footwear'],
        componentItemIds: [],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'shoes-1') return shoes
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([shoes])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: ['shoes-1'],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'equip', item_id: 'shoes-1' },
        context
      )

      expect(mockEquipItem).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', shoes)
      expect(result).toMatchObject({
        success: true,
        action: 'equipped',
        slot: 'footwear',
        item: { item_id: 'shoes-1', title: 'Oxford Shoes' },
      })
    })

    it('mode: equip — rejects a composite item and points at wardrobe_set_outfit', async () => {
      const composite = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return composite
        return null
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'equip', item_id: 'rain-outfit' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/composite|wardrobe_set_outfit/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
    })

    it('mode: add_to_slot — layers a leaf item into an occupied slot', async () => {
      const cardigan = makeWardrobeItem({
        id: 'cardigan-1',
        title: 'Wool Cardigan',
        types: ['top'],
        componentItemIds: [],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'cardigan-1') return cardigan
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([cardigan])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'add_to_slot', slot: 'top', item_id: 'cardigan-1' },
        context
      )

      expect(mockAddToSlot).toHaveBeenCalledTimes(1)
      expect(mockAddToSlot).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', 'top', cardigan)
      expect(result).toMatchObject({
        success: true,
        action: 'equipped',
        slot: 'top',
        item: { item_id: 'cardigan-1', title: 'Wool Cardigan' },
      })
    })

    it('mode: add_to_slot — rejects a composite item', async () => {
      const composite = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return composite
        return null
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'add_to_slot', slot: 'top', item_id: 'rain-outfit' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/composite|wardrobe_set_outfit/i)
      expect(mockAddToSlot).not.toHaveBeenCalled()
    })

    it('mode: add_to_slot — rejects an item whose types do not cover the slot', async () => {
      const shoes = makeWardrobeItem({
        id: 'shoes-1',
        title: 'Oxford Shoes',
        types: ['footwear'],
        componentItemIds: [],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'shoes-1') return shoes
        return null
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'add_to_slot', slot: 'top', item_id: 'shoes-1' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/cannot be added to the "top" slot/)
      expect(mockAddToSlot).not.toHaveBeenCalled()
    })

    it('mode: remove_from_slot — with a named leaf, calls removeFromSlot with the item id', async () => {
      const tshirt = makeWardrobeItem({
        id: 't-shirt-1',
        title: 'White T-Shirt',
        types: ['top'],
        componentItemIds: [],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 't-shirt-1') return tshirt
        return null
      })
      repos.wardrobe.findByIds.mockResolvedValue([])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'remove_from_slot', slot: 'top', item_id: 't-shirt-1' },
        context
      )

      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(1)
      expect(mockRemoveFromSlot).toHaveBeenCalledWith(
        repos,
        'chat-1',
        'char-1',
        'top',
        't-shirt-1'
      )
      expect(result).toMatchObject({
        success: true,
        action: 'removed',
        slot: 'top',
        item: { item_id: 't-shirt-1', title: 'White T-Shirt' },
      })
    })

    it('mode: remove_from_slot — with a named composite, rejects and does not mutate', async () => {
      const composite = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom', 'footwear'],
        componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      })
      repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
        if (id === 'rain-outfit') return composite
        return null
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'remove_from_slot', slot: 'top', item_id: 'rain-outfit' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/composite|wardrobe_set_outfit/i)
      expect(mockRemoveFromSlot).not.toHaveBeenCalled()
    })

    it('mode: remove_from_slot — without an item_id, clears the slot via removeFromSlot', async () => {
      repos.wardrobe.findByIds.mockResolvedValue([])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'remove_from_slot', slot: 'top' },
        context
      )

      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(1)
      // No itemId argument means "clear everything in this slot".
      expect(mockRemoveFromSlot).toHaveBeenCalledWith(
        repos,
        'chat-1',
        'char-1',
        'top',
        undefined
      )
      expect(result).toMatchObject({
        success: true,
        action: 'removed',
        slot: 'top',
      })
    })

    it('mode: clear_slot — empties the named slot via removeFromSlot with no item id', async () => {
      repos.wardrobe.findByIds.mockResolvedValue([])
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
      })

      const result = await executeWardrobeChangeItemTool(
        { mode: 'clear_slot', slot: 'top' },
        context
      )

      expect(mockRemoveFromSlot).toHaveBeenCalledTimes(1)
      expect(mockRemoveFromSlot).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', 'top')
      expect(result).toMatchObject({
        success: true,
        action: 'removed',
        slot: 'top',
      })
      expect(result.current_state.top).toEqual([])
    })

    it('returns NOT_FOUND when an item is named but not found in the wardrobe', async () => {
      repos.wardrobe.findById.mockResolvedValue(null)
      repos.wardrobe.findByCharacterId.mockResolvedValue([])

      const result = await executeWardrobeChangeItemTool(
        { mode: 'equip', item_title: 'Phantom Hat' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/i)
      expect(mockEquipItem).not.toHaveBeenCalled()
    })
  })

  describe('executeWardrobeCreateItemTool', () => {
    it('creates and immediately equips a new wardrobe item when requested', async () => {
      const newItem = makeWardrobeItem({
        id: 'new-item-1',
        title: 'Crimson Scarf',
        description: 'A soft crimson scarf with golden tassels',
        types: ['accessories', 'top'],
      })
      repos.wardrobe.create.mockResolvedValue(newItem)
      repos.wardrobe.findByCharacterId.mockResolvedValue([])
      repos.chats.findById.mockResolvedValue({
        id: 'chat-1',
        // After equip, the chat's equippedOutfit reflects the array shape.
        equippedOutfit: {
          'char-1': {
            top: ['new-item-1'],
            bottom: [],
            footwear: [],
            accessories: ['new-item-1'],
          },
        },
      })

      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Crimson Scarf',
          description: 'A soft crimson scarf with golden tassels',
          types: ['accessories', 'top'],
          appropriateness: 'casual',
          equip_now: true,
        },
        context
      )

      expect(repos.wardrobe.create).toHaveBeenCalledWith({
        characterId: 'char-1',
        title: 'Crimson Scarf',
        description: 'A soft crimson scarf with golden tassels',
        types: ['accessories', 'top'],
        componentItemIds: [],
        appropriateness: 'casual',
        isDefault: false,
      })
      // equipItem persists the new item in every slot it covers.
      expect(mockEquipItem).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', newItem)
      expect(result).toMatchObject({
        success: true,
        item_id: 'new-item-1',
        title: 'Crimson Scarf',
        equipped: true,
        is_composite: false,
        resolved_types: ['accessories', 'top'],
        current_state: {
          top: ['new-item-1'],
          bottom: [],
          footwear: [],
          accessories: ['new-item-1'],
        },
      })
    })

    it('creates a composite item when component_item_ids reference existing leaf items', async () => {
      // Two leaves already in the character's wardrobe — the new item should
      // bundle them and have its `types` derived from their union, in canonical
      // slot order.
      const raincoat = makeWardrobeItem({
        id: 'raincoat-1',
        title: 'Raincoat',
        types: ['top'],
        componentItemIds: [],
      })
      const jeans = makeWardrobeItem({
        id: 'jeans-1',
        title: 'Blue Jeans',
        types: ['bottom'],
        componentItemIds: [],
      })
      const newComposite = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        description: 'A practical pairing',
        types: ['top', 'bottom'],
        componentItemIds: ['raincoat-1', 'jeans-1'],
      })

      repos.wardrobe.findByCharacterId.mockResolvedValue([raincoat, jeans])
      repos.wardrobe.create.mockResolvedValue(newComposite)

      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Rain Outfit',
          description: 'A practical pairing',
          appropriateness: 'rainy weather',
          component_item_ids: ['raincoat-1', 'jeans-1'],
        },
        context
      )

      expect(repos.wardrobe.create).toHaveBeenCalledWith({
        characterId: 'char-1',
        title: 'Rain Outfit',
        description: 'A practical pairing',
        types: ['top', 'bottom'],
        componentItemIds: ['raincoat-1', 'jeans-1'],
        appropriateness: 'rainy weather',
        isDefault: false,
      })
      expect(result).toMatchObject({
        success: true,
        item_id: 'rain-outfit',
        title: 'Rain Outfit',
        equipped: false,
        is_composite: true,
        resolved_types: ['top', 'bottom'],
        resolved_component_item_ids: ['raincoat-1', 'jeans-1'],
      })
    })

    it('creates a composite item when component_titles reference existing leaf items', async () => {
      const raincoat = makeWardrobeItem({
        id: 'raincoat-1',
        title: 'Raincoat',
        types: ['top'],
        componentItemIds: [],
      })
      const wellies = makeWardrobeItem({
        id: 'wellies-1',
        title: 'Wellies',
        types: ['footwear'],
        componentItemIds: [],
      })
      const newComposite = makeWardrobeItem({
        id: 'wet-walk',
        title: 'Wet Walk',
        types: ['top', 'footwear'],
        componentItemIds: ['raincoat-1', 'wellies-1'],
      })

      repos.wardrobe.findByCharacterId.mockResolvedValue([raincoat, wellies])
      repos.wardrobe.create.mockResolvedValue(newComposite)

      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Wet Walk',
          component_titles: ['Raincoat', 'Wellies'],
        },
        context
      )

      // Title resolution preserves input order; canonical slot ordering applies
      // to the resolved types union (top before footwear).
      expect(repos.wardrobe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ['top', 'footwear'],
          componentItemIds: ['raincoat-1', 'wellies-1'],
        })
      )
      expect(result).toMatchObject({
        success: true,
        item_id: 'wet-walk',
        is_composite: true,
        resolved_types: ['top', 'footwear'],
        resolved_component_item_ids: ['raincoat-1', 'wellies-1'],
      })
    })

    it('overrides LLM-supplied types with the union derived from components', async () => {
      // The LLM sends `types: ['accessories']`, which is wrong for the
      // components. The handler should ignore that and use the union of the
      // components' types instead.
      const raincoat = makeWardrobeItem({
        id: 'raincoat-1',
        title: 'Raincoat',
        types: ['top'],
        componentItemIds: [],
      })
      const jeans = makeWardrobeItem({
        id: 'jeans-1',
        title: 'Blue Jeans',
        types: ['bottom'],
        componentItemIds: [],
      })
      const newComposite = makeWardrobeItem({
        id: 'rain-outfit',
        title: 'Rain Outfit',
        types: ['top', 'bottom'],
        componentItemIds: ['raincoat-1', 'jeans-1'],
      })

      repos.wardrobe.findByCharacterId.mockResolvedValue([raincoat, jeans])
      repos.wardrobe.create.mockResolvedValue(newComposite)

      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Rain Outfit',
          types: ['accessories'],
          component_item_ids: ['raincoat-1', 'jeans-1'],
        },
        context
      )

      // The persisted types reflect the component union, not the LLM input.
      expect(repos.wardrobe.create).toHaveBeenCalledWith(
        expect.objectContaining({ types: ['top', 'bottom'] })
      )
      expect(result.success).toBe(true)
      expect(result.resolved_types).toEqual(['top', 'bottom'])
      expect(result.resolved_types).not.toContain('accessories')
    })

    it('rejects a leaf create that supplies neither types nor components', async () => {
      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Mystery Item',
          // No types, no component_item_ids, no component_titles.
        },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/types|component/i)
      expect(repos.wardrobe.create).not.toHaveBeenCalled()
    })

    it('fails with NOT_FOUND when a component_item_id does not match anything', async () => {
      repos.wardrobe.findByCharacterId.mockResolvedValue([])
      // Archetype lookup also misses.
      repos.wardrobe.findById.mockResolvedValue(null)

      const result = await executeWardrobeCreateItemTool(
        {
          title: 'Phantom Outfit',
          component_item_ids: ['ghost-1'],
        },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found|ghost-1/i)
      expect(repos.wardrobe.create).not.toHaveBeenCalled()
    })
  })
})
