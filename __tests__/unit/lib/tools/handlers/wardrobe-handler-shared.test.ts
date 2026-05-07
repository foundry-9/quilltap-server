import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn(),
}))

const { logger } = require('@/lib/logger')
const { enqueueWardrobeOutfitAnnouncement } = require('@/lib/background-jobs/queue-service')
const {
  buildWardrobeCoverageSummaryFromState,
  emptyEquippedState,
  loadCurrentWardrobeState,
  scheduleWardrobeAnnouncement,
} = require('@/lib/tools/handlers/wardrobe-handler-shared')

describe('wardrobe-handler-shared', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an empty equipped state when no outfit is stored', async () => {
    const repos = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      },
      wardrobe: {
        findByIds: jest.fn().mockResolvedValue([]),
      },
    }

    const state = await loadCurrentWardrobeState(repos as any, 'chat-1', 'char-1')
    expect(state).toEqual(emptyEquippedState())
  })

  it('builds coverage summary using expanded composite leaves', async () => {
    const repos = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn(),
      },
      wardrobe: {
        findByIds: jest.fn().mockResolvedValue([
          { id: 'rain-outfit', title: 'Rain Outfit', types: ['top', 'bottom', 'footwear'], componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'] },
          { id: 'raincoat-1', title: 'Raincoat', types: ['top'], componentItemIds: [] },
          { id: 'jeans-1', title: 'Blue Jeans', types: ['bottom'], componentItemIds: [] },
          { id: 'wellies-1', title: 'Wellies', types: ['footwear'], componentItemIds: [] },
        ]),
      },
    }

    const summary = await buildWardrobeCoverageSummaryFromState(repos as any, {
      top: ['rain-outfit'],
      bottom: ['rain-outfit'],
      footwear: ['rain-outfit'],
      accessories: [],
    })

    expect(summary).toContain('Raincoat')
    expect(summary).toContain('Blue Jeans')
    expect(summary).toContain('Wellies')
    expect(summary).not.toContain('Rain Outfit')
  })

  it('logs a warning when announcement enqueue fails', async () => {
    enqueueWardrobeOutfitAnnouncement.mockRejectedValueOnce(new Error('queue unavailable'))

    await scheduleWardrobeAnnouncement('wardrobe-test', {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
      extraLogFields: { slot: 'top' },
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to schedule wardrobe outfit announcement',
      expect.objectContaining({
        context: 'wardrobe-test',
        chatId: 'chat-1',
        characterId: 'char-1',
        slot: 'top',
      }),
    )
  })
})
