/**
 * Outfit-change side effects (lib/wardrobe/outfit-change-effects.ts): the
 * avatar refresh and Aurora's announcement, with the per-turn coalescing set.
 * These moved here from lib/tools/handlers/wardrobe-handler-shared.ts.
 */

const {
  notifyWardrobeChanged,
  scheduleWardrobeAnnouncement,
  recordPendingWardrobeAnnouncement,
  flushPendingWardrobeAnnouncements,
} = require('@/lib/wardrobe/outfit-change-effects')

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeOutfitAnnouncement: jest.fn(),
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn(),
}))

const { logger } = require('@/lib/logger')
const { enqueueWardrobeOutfitAnnouncement } = require('@/lib/background-jobs/queue-service')
const { triggerAvatarGenerationIfEnabled } = require('@/lib/wardrobe/avatar-generation')

describe('outfit-change-effects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enqueueWardrobeOutfitAnnouncement.mockResolvedValue(undefined)
    triggerAvatarGenerationIfEnabled.mockResolvedValue(undefined)
  })

  it('logs a warning when announcement enqueue fails', async () => {
    enqueueWardrobeOutfitAnnouncement.mockRejectedValueOnce(new Error('queue unavailable'))

    await scheduleWardrobeAnnouncement('wardrobe-test', {
      userId: 'user-1',
      chatId: 'chat-1',
      characterId: 'char-1',
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to schedule wardrobe outfit announcement',
      expect.objectContaining({
        context: 'wardrobe-test',
        chatId: 'chat-1',
        characterId: 'char-1',
        error: 'queue unavailable',
      }),
    )
  })

  describe('recordPendingWardrobeAnnouncement', () => {
    it('adds to the per-turn Set without enqueuing immediately when one is present', async () => {
      const pending = new Set<string>()
      await recordPendingWardrobeAnnouncement(
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', pendingWardrobeAnnouncements: pending },
        'wardrobe-test',
      )
      expect(pending.has('char-1')).toBe(true)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('falls back to immediate enqueue when no per-turn Set is present', async () => {
      await recordPendingWardrobeAnnouncement(
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1' },
        'wardrobe-test',
      )
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
    })

    it('coalesces multiple records for the same character into a single Set entry', async () => {
      const pending = new Set<string>()
      const ctx = { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', pendingWardrobeAnnouncements: pending }
      for (let i = 0; i < 6; i++) {
        await recordPendingWardrobeAnnouncement(ctx, 'wardrobe-test')
      }
      expect(pending.size).toBe(1)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('keeps separate entries for different characters', async () => {
      const pending = new Set<string>()
      const base = { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending }
      await recordPendingWardrobeAnnouncement({ ...base, characterId: 'char-1' }, 's')
      await recordPendingWardrobeAnnouncement({ ...base, characterId: 'char-2' }, 's')
      expect(pending.size).toBe(2)
    })
  })

  describe('notifyWardrobeChanged', () => {
    const repos = { marker: 'repos' }

    it('refreshes the avatar and joins the per-turn set', async () => {
      const pending = new Set<string>()
      await notifyWardrobeChanged(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', pendingWardrobeAnnouncements: pending },
        'wardrobe-test',
      )
      expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledWith(repos, {
        userId: 'user-1',
        chatId: 'chat-1',
        characterId: 'char-1',
        callerContext: 'wardrobe-test',
      })
      expect(pending.has('char-1')).toBe(true)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('enqueues the announcement at once without a per-turn set', async () => {
      await notifyWardrobeChanged(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1' },
        'wardrobe-test',
      )
      expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledTimes(1)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
    })
  })

  describe('flushPendingWardrobeAnnouncements', () => {
    it('enqueues one announcement per character and clears the Set', async () => {
      const pending = new Set<string>(['char-1', 'char-2'])
      await flushPendingWardrobeAnnouncements({
        userId: 'user-1',
        chatId: 'chat-1',
        pendingWardrobeAnnouncements: pending,
      })
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(2)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-2',
      })
      expect(pending.size).toBe(0)
    })

    it('is a no-op when the Set is missing', async () => {
      await flushPendingWardrobeAnnouncements({ userId: 'user-1', chatId: 'chat-1' })
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
    })

    it('is idempotent across repeated calls', async () => {
      const pending = new Set<string>(['char-1'])
      const ctx = { userId: 'user-1', chatId: 'chat-1', pendingWardrobeAnnouncements: pending }
      await flushPendingWardrobeAnnouncements(ctx)
      await flushPendingWardrobeAnnouncements(ctx)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(1)
    })
  })
})
