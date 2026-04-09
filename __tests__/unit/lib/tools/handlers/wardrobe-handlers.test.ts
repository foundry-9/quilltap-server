import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { getRepositories } from '@/lib/repositories/factory'
import { executeWardrobeCreateItemTool } from '@/lib/tools/handlers/wardrobe-create-item-handler'
import { executeWardrobeListTool } from '@/lib/tools/handlers/wardrobe-list-handler'
import { executeWardrobeUpdateOutfitTool } from '@/lib/tools/handlers/wardrobe-update-outfit-handler'

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

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

const now = '2026-04-07T00:00:00.000Z'

const makeWardrobeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  characterId: 'char-1',
  title: 'Evening Dress',
  description: 'A formal velvet dress',
  types: ['top', 'bottom'],
  appropriateness: 'formal evening',
  isDefault: false,
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
        create: jest.fn(),
      },
      chats: {
        getEquippedOutfitForCharacter: jest.fn(),
        updateEquippedSlot: jest.fn().mockResolvedValue(undefined),
        setEquippedOutfit: jest.fn().mockImplementation(async (_chatId: string, _charId: string, slots: unknown) => slots),
        findById: jest.fn(),
      },
      outfitPresets: {
        findByCharacterId: jest.fn().mockResolvedValue([]),
      },
    }

    mockGetRepositories.mockReturnValue(repos as any)
  })

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
    repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
      top: 'item-1',
      bottom: 'item-1',
      footwear: 'boots-1',
      accessories: null,
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
      top: 'top-1',
      bottom: null,
      footwear: null,
      accessories: null,
    })

    const result = await executeWardrobeListTool(
      { type_filter: ['top'], include_equipped: false },
      context
    )

    expect(result.success).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.item_id).toBe('top-2')
  })

  it('equips a multi-slot item and returns the updated outfit summary', async () => {
    const dress = makeWardrobeItem({
      id: 'dress-1',
      title: 'Midnight Dress',
      types: ['top', 'bottom'],
    })

    repos.wardrobe.findByCharacterId.mockResolvedValue([dress])
    repos.wardrobe.findById.mockImplementation(async (id: unknown) => {
      if (id === 'dress-1') return dress
      return null
    })
    repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
      top: 'dress-1',
      bottom: 'dress-1',
      footwear: null,
      accessories: null,
    })

    const result = await executeWardrobeUpdateOutfitTool(
      { slot: 'top', item_title: 'Midnight Dress' },
      context
    )

    // equipWithDisplacement uses setEquippedOutfit for batch update
    expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith(
      'chat-1',
      'char-1',
      {
        top: 'dress-1',
        bottom: 'dress-1',
        footwear: null,
        accessories: null,
      }
    )
    expect(result).toMatchObject({
      success: true,
      action: 'equipped',
      slot: 'top',
      item: { item_id: 'dress-1', title: 'Midnight Dress' },
      current_state: {
        top: 'dress-1',
        bottom: 'dress-1',
        footwear: null,
        accessories: null,
      },
    })
    expect(result.coverage_summary).toContain('Midnight Dress')
    expect(result.coverage_summary).toContain('barefoot')
  })

  it('rejects equipping an item into an incompatible slot', async () => {
    repos.wardrobe.findById.mockResolvedValue(
      makeWardrobeItem({
        id: 'shoes-1',
        title: 'Oxford Shoes',
        types: ['footwear'],
      })
    )

    const result = await executeWardrobeUpdateOutfitTool(
      { slot: 'top', item_id: 'shoes-1' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot be equipped in the "top" slot')
    expect(repos.chats.updateEquippedSlot).not.toHaveBeenCalled()
    expect(repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
  })

  it('creates and immediately equips a new wardrobe item when requested', async () => {
    repos.wardrobe.create.mockResolvedValue(
      makeWardrobeItem({
        id: 'new-item-1',
        title: 'Crimson Scarf',
        description: 'A soft crimson scarf with golden tassels',
        types: ['accessories', 'top'],
      })
    )
    repos.chats.findById.mockResolvedValue({
      id: 'chat-1',
      equippedOutfit: {
        'char-1': {
          top: 'new-item-1',
          bottom: null,
          footwear: null,
          accessories: 'new-item-1',
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
      appropriateness: 'casual',
      isDefault: false,
    })
    // equipWithDisplacement uses setEquippedOutfit for batch update
    expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith(
      'chat-1',
      'char-1',
      {
        top: 'new-item-1',
        bottom: null,
        footwear: null,
        accessories: 'new-item-1',
      }
    )
    expect(result).toMatchObject({
      success: true,
      item_id: 'new-item-1',
      title: 'Crimson Scarf',
      equipped: true,
      current_state: {
        top: 'new-item-1',
        bottom: null,
        footwear: null,
        accessories: 'new-item-1',
      },
    })
  })
})
