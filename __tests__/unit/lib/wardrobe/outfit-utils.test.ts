import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  computeDisplacedSlots,
  equipItem,
  addToSlot,
  removeFromSlot,
} from '@/lib/wardrobe/outfit-displacement'
import { describeOutfit } from '@/lib/wardrobe/outfit-description'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('wardrobe outfit utilities', () => {
  describe('describeOutfit', () => {
    it('describes a completely empty outfit as naked and unadorned', () => {
      expect(
        describeOutfit({
          top: [],
          bottom: [],
          footwear: [],
          accessories: [],
        })
      ).toBe('- completely naked and unadorned\n')
    })

    it('uses topless and bottomless fallbacks while preserving equipped items', () => {
      expect(
        describeOutfit({
          top: [],
          bottom: ['striped trousers'],
          footwear: [],
          accessories: ['silver rings'],
        })
      ).toBe([
        '- **top:** topless',
        '- **bottom:** striped trousers',
        '- **footwear:** barefoot',
        '- **accessories:** silver rings',
        '',
      ].join('\n'))
    })

    it('collapses slots sharing the same value onto a single line', () => {
      expect(
        describeOutfit({
          top: ['Working Outfit'],
          bottom: ['Working Outfit'],
          footwear: ['Working Outfit'],
          accessories: ['Working Outfit'],
        })
      ).toBe('- **top, bottom, footwear, accessories:** Working Outfit\n')
    })

    it('groups multi-slot items but keeps distinct slots separate', () => {
      expect(
        describeOutfit({
          top: ['silk dress'],
          bottom: ['silk dress'],
          footwear: ['leather boots'],
          accessories: ['pearl earrings'],
        })
      ).toBe([
        '- **top, bottom:** silk dress',
        '- **footwear:** leather boots',
        '- **accessories:** pearl earrings',
        '',
      ].join('\n'))
    })

    it('comma-joins multiple items in a single slot for layering', () => {
      expect(
        describeOutfit({
          top: ['t-shirt', 'cardigan'],
          bottom: ['jeans'],
          footwear: ['sneakers'],
          accessories: [],
        })
      ).toBe([
        '- **top:** t-shirt, cardigan',
        '- **bottom:** jeans',
        '- **footwear:** sneakers',
        '- **accessories:** no accessories',
        '',
      ].join('\n'))
    })
  })

  describe('computeDisplacedSlots (pure)', () => {
    const baseSlots = {
      top: ['dress-1'],
      bottom: ['dress-1'],
      footwear: ['boots-1'],
      accessories: [],
    }

    it("equip mode replaces every slot covered by the new item's types", () => {
      const next = computeDisplacedSlots(baseSlots, {
        mode: 'equip',
        item: { id: 'shirt-1', types: ['top'] },
      })

      expect(next).toEqual({
        top: ['shirt-1'],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
      })
    })

    it('equip mode replaces both top and bottom for a multi-slot dress', () => {
      const next = computeDisplacedSlots(
        { top: ['shirt-1'], bottom: ['jeans-1'], footwear: [], accessories: [] },
        {
          mode: 'equip',
          item: { id: 'dress-1', types: ['top', 'bottom'] },
        },
      )

      expect(next).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
      })
    })

    it('add_to_slot mode appends to the slot array without displacing siblings', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1'], bottom: [], footwear: [], accessories: [] },
        {
          mode: 'add_to_slot',
          slot: 'top',
          item: { id: 'cardigan-1', types: ['top'] },
        },
      )

      expect(next).toEqual({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })
    })

    it('add_to_slot mode is a no-op when the item is already in the slot', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1'], bottom: [], footwear: [], accessories: [] },
        {
          mode: 'add_to_slot',
          slot: 'top',
          item: { id: 't-shirt-1', types: ['top'] },
        },
      )

      expect(next.top).toEqual(['t-shirt-1'])
    })

    it('remove_from_slot with an itemId filters that id out of the slot', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1', 'cardigan-1'], bottom: [], footwear: [], accessories: [] },
        {
          mode: 'remove_from_slot',
          slot: 'top',
          itemId: 't-shirt-1',
        },
      )

      expect(next.top).toEqual(['cardigan-1'])
    })

    it('remove_from_slot without an itemId clears the slot entirely', () => {
      const next = computeDisplacedSlots(
        { top: ['t-shirt-1', 'cardigan-1'], bottom: [], footwear: [], accessories: [] },
        {
          mode: 'remove_from_slot',
          slot: 'top',
        },
      )

      expect(next.top).toEqual([])
    })

    it('clear_slot empties the named slot but leaves others alone', () => {
      const next = computeDisplacedSlots(baseSlots, {
        mode: 'clear_slot',
        slot: 'top',
      })

      expect(next).toEqual({
        top: [],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
      })
    })
  })

  describe('repo-backed equip primitives', () => {
    let repos: {
      chats: {
        getEquippedOutfitForCharacter: jest.Mock
        setEquippedOutfit: jest.Mock
      }
    }

    beforeEach(() => {
      repos = {
        chats: {
          getEquippedOutfitForCharacter: jest.fn(),
          setEquippedOutfit: jest.fn(async (_chatId: string, _characterId: string, slots: unknown) => slots),
        },
      }
    })

    it('equipItem replaces every slot the item covers (multi-slot dress)', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['shirt-1'],
        bottom: ['jeans-1'],
        footwear: ['boots-1'],
        accessories: [],
      })

      const result = await equipItem(repos, 'chat-1', 'char-1', {
        id: 'dress-1',
        types: ['top', 'bottom'],
      })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
      })
      expect(result).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: ['boots-1'],
        accessories: [],
      })
    })

    it('equipItem starts from empty slots when nothing is equipped yet', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue(null)

      const result = await equipItem(repos, 'chat-1', 'char-1', {
        id: 'dress-1',
        types: ['top', 'bottom'],
      })

      expect(result).toEqual({
        top: ['dress-1'],
        bottom: ['dress-1'],
        footwear: [],
        accessories: [],
      })
    })

    it('equipItem stores a composite as its own id (no expansion at write time)', async () => {
      // Composite "rain outfit" covers top/bottom/footwear via componentItemIds;
      // its own types reflect the slots it covers, and its id is what's stored.
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: [],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      await equipItem(repos, 'chat-1', 'char-1', {
        id: 'rain-outfit',
        types: ['top', 'bottom', 'footwear'],
      })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['rain-outfit'],
        bottom: ['rain-outfit'],
        footwear: ['rain-outfit'],
        accessories: [],
      })
    })

    it('addToSlot appends to the slot array', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await addToSlot(repos, 'chat-1', 'char-1', 'top', {
        id: 'cardigan-1',
        types: ['top'],
      })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })
      expect(result.top).toEqual(['t-shirt-1', 'cardigan-1'])
    })

    it('addToSlot rejects items whose types do not include the requested slot', async () => {
      // The slot validator runs before any DB read.
      await expect(
        addToSlot(repos, 'chat-1', 'char-1', 'top', {
          id: 'shoes-1',
          types: ['footwear'],
        }),
      ).rejects.toThrow(/cannot occupy slot 'top'/)

      expect(repos.chats.setEquippedOutfit).not.toHaveBeenCalled()
    })

    it('addToSlot is a no-op when the item is already in the slot', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await addToSlot(repos, 'chat-1', 'char-1', 'top', {
        id: 'cardigan-1',
        types: ['top'],
      })

      // The slot still reflects a single occurrence; we don't double-append.
      expect(result.top).toEqual(['cardigan-1'])
    })

    it('removeFromSlot with an itemId filters that id out of the slot', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })

      const result = await removeFromSlot(repos, 'chat-1', 'char-1', 'top', 't-shirt-1')

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: ['cardigan-1'],
        bottom: [],
        footwear: [],
        accessories: [],
      })
      expect(result.top).toEqual(['cardigan-1'])
    })

    it('removeFromSlot without an itemId clears the slot entirely', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: ['t-shirt-1', 'cardigan-1'],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
      })

      const result = await removeFromSlot(repos, 'chat-1', 'char-1', 'top')

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: [],
        bottom: ['jeans-1'],
        footwear: [],
        accessories: [],
      })
      expect(result.top).toEqual([])
    })
  })
})
