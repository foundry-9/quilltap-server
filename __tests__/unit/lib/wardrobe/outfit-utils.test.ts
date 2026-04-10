import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  computeDisplacedSlots,
  equipWithDisplacement,
  unequipWithDisplacement,
} from '@/lib/wardrobe/outfit-displacement'
import { describeOutfit } from '@/lib/wardrobe/outfit-description'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
  },
}))

describe('wardrobe outfit utilities', () => {
  describe('describeOutfit', () => {
    it('describes a completely empty outfit as naked and unadorned', () => {
      expect(
        describeOutfit({
          top: null,
          bottom: null,
          footwear: null,
          accessories: null,
        })
      ).toBe('- completely naked and unadorned\n')
    })

    it('uses topless and bottomless fallbacks while preserving equipped items', () => {
      expect(
        describeOutfit({
          top: null,
          bottom: 'striped trousers',
          footwear: null,
          accessories: 'silver rings',
        })
      ).toBe([
        '- **top:** topless',
        '- **bottom:** striped trousers',
        '- **footwear:** barefoot',
        '- **accessories:** silver rings',
        '',
      ].join('\n'))
    })
  })

  describe('computeDisplacedSlots', () => {
    const wardrobeItems = [
      { id: 'dress-1', types: ['top', 'bottom'] },
      { id: 'shirt-1', types: ['top'] },
      { id: 'boots-1', types: ['footwear'] },
    ]

    it('clears all occupied slots for a displaced multi-slot item', () => {
      const next = computeDisplacedSlots(
        {
          top: 'dress-1',
          bottom: 'dress-1',
          footwear: 'boots-1',
          accessories: null,
        },
        wardrobeItems,
        'top',
        'shirt-1'
      )

      expect(next).toEqual({
        top: 'shirt-1',
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
    })

    it('clears every covered slot when unequipping one side of a multi-slot item', () => {
      const next = computeDisplacedSlots(
        {
          top: 'dress-1',
          bottom: 'dress-1',
          footwear: null,
          accessories: null,
        },
        wardrobeItems,
        'top',
        null
      )

      expect(next).toEqual({
        top: null,
        bottom: null,
        footwear: null,
        accessories: null,
      })
    })
  })

  describe('repo-backed displacement helpers', () => {
    let repos: {
      wardrobe: { findById: jest.Mock }
      chats: {
        getEquippedOutfitForCharacter: jest.Mock
        setEquippedOutfit: jest.Mock
      }
    }

    beforeEach(() => {
      repos = {
        wardrobe: {
          findById: jest.fn(),
        },
        chats: {
          getEquippedOutfitForCharacter: jest.fn(),
          setEquippedOutfit: jest.fn(async (_chatId: string, _characterId: string, slots: unknown) => slots),
        },
      }
    })

    it('persists displacement when equipping over a multi-slot item', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: 'dress-1',
        bottom: 'dress-1',
        footwear: 'boots-1',
        accessories: null,
      })
      repos.wardrobe.findById.mockImplementation(async (id: string) => {
        if (id === 'dress-1') return { id, types: ['top', 'bottom'] }
        return null
      })

      const result = await equipWithDisplacement(repos, 'chat-1', 'char-1', {
        id: 'shirt-1',
        types: ['top'],
      })

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: 'shirt-1',
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
      expect(result).toEqual({
        top: 'shirt-1',
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
    })

    it('falls back to clearing only the requested slot when the equipped item record is missing', async () => {
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({
        top: 'missing-item',
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
      repos.wardrobe.findById.mockResolvedValue(null)

      const result = await unequipWithDisplacement(repos, 'chat-1', 'char-1', 'top')

      expect(repos.chats.setEquippedOutfit).toHaveBeenCalledWith('chat-1', 'char-1', {
        top: null,
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
      expect(result).toEqual({
        top: null,
        bottom: null,
        footwear: 'boots-1',
        accessories: null,
      })
    })
  })
})
