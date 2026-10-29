/**
 * Outfit-change side effects (lib/wardrobe/outfit-change-effects.ts): the
 * avatar refresh, Aurora's announcement and the outfit-history entry, with the
 * per-turn containers that collapse a turn to one of each per character.
 */

const {
  notifyWardrobeChanged,
  scheduleWardrobeAnnouncement,
  recordPendingWardrobeAnnouncement,
  flushPendingWardrobeAnnouncements,
  newWardrobeTurnContainers,
  turnContainersOf,
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

const OPERATOR = { source: 'operator' }
const BY_CHAR_1 = { source: 'character', actorCharacterId: 'char-1' }

function makeRepos() {
  return { wardrobeHistory: { settle: jest.fn().mockResolvedValue({ kind: 'appended', entryIndex: 1, seeded: false }) } }
}

describe('outfit-change-effects', () => {
  let repos: ReturnType<typeof makeRepos>

  beforeEach(() => {
    jest.clearAllMocks()
    enqueueWardrobeOutfitAnnouncement.mockResolvedValue(undefined)
    triggerAvatarGenerationIfEnabled.mockResolvedValue(undefined)
    repos = makeRepos()
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

  it('newWardrobeTurnContainers makes both containers together', () => {
    const containers = newWardrobeTurnContainers()
    expect(containers.pendingWardrobeAnnouncements).toBeInstanceOf(Set)
    expect(containers.pendingWardrobeHistory).toBeInstanceOf(Map)
    expect(turnContainersOf(containers)).toEqual(containers)
    expect(turnContainersOf(undefined)).toEqual({})
  })

  describe('recordPendingWardrobeAnnouncement', () => {
    it('defers both the announcement and the history entry inside a turn', async () => {
      const turn = newWardrobeTurnContainers()
      await recordPendingWardrobeAnnouncement(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: BY_CHAR_1, ...turn },
        'wardrobe-test',
      )
      expect(turn.pendingWardrobeAnnouncements.has('char-1')).toBe(true)
      expect(turn.pendingWardrobeHistory.get('char-1')).toEqual({ kind: 'append', provenance: BY_CHAR_1 })
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
      expect(repos.wardrobeHistory.settle).not.toHaveBeenCalled()
    })

    it('announces and settles at once without a turn', async () => {
      await recordPendingWardrobeAnnouncement(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: OPERATOR },
        'wardrobe-test',
      )
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledWith('chat-1', 'char-1', {
        kind: 'append',
        provenance: OPERATOR,
      })
    })

    it('settles the rollback cursor intent instead of an append', async () => {
      await recordPendingWardrobeAnnouncement(
        repos,
        {
          userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: OPERATOR,
          historyIntent: { kind: 'cursor', index: 3 },
        },
        'wardrobe-test',
      )
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledWith('chat-1', 'char-1', { kind: 'cursor', index: 3 })
    })

    it('still announces when the history settle throws', async () => {
      repos.wardrobeHistory.settle.mockRejectedValueOnce(new Error('boom'))
      await recordPendingWardrobeAnnouncement(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: OPERATOR },
        'wardrobe-test',
      )
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith('Failed to settle wardrobe history', expect.anything())
    })

    it('settles at once when a turn set arrives without its history map', async () => {
      const pending = new Set<string>()
      await recordPendingWardrobeAnnouncement(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: BY_CHAR_1, pendingWardrobeAnnouncements: pending },
        'wardrobe-test',
      )
      expect(pending.has('char-1')).toBe(true)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledTimes(1)
    })

    it('coalesces multiple records for the same character; the last intent wins', async () => {
      const turn = newWardrobeTurnContainers()
      const ctx = { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: BY_CHAR_1, ...turn }
      await recordPendingWardrobeAnnouncement(repos, { ...ctx, historyIntent: { kind: 'cursor', index: 2 } }, 's')
      for (let i = 0; i < 3; i++) {
        await recordPendingWardrobeAnnouncement(repos, ctx, 's')
      }
      expect(turn.pendingWardrobeAnnouncements.size).toBe(1)
      expect(turn.pendingWardrobeHistory.get('char-1')).toEqual({ kind: 'append', provenance: BY_CHAR_1 })

      await recordPendingWardrobeAnnouncement(repos, { ...ctx, historyIntent: { kind: 'cursor', index: 0 } }, 's')
      expect(turn.pendingWardrobeHistory.get('char-1')).toEqual({ kind: 'cursor', index: 0 })
    })

    it('keeps separate entries for different characters', async () => {
      const turn = newWardrobeTurnContainers()
      const base = { userId: 'user-1', chatId: 'chat-1', provenance: BY_CHAR_1, ...turn }
      await recordPendingWardrobeAnnouncement(repos, { ...base, characterId: 'char-1' }, 's')
      await recordPendingWardrobeAnnouncement(repos, { ...base, characterId: 'char-2' }, 's')
      expect(turn.pendingWardrobeAnnouncements.size).toBe(2)
      expect(turn.pendingWardrobeHistory.size).toBe(2)
    })
  })

  describe('notifyWardrobeChanged', () => {
    it('refreshes the avatar and joins the turn', async () => {
      const turn = newWardrobeTurnContainers()
      await notifyWardrobeChanged(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: BY_CHAR_1, ...turn },
        'wardrobe-test',
      )
      expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledWith(repos, {
        userId: 'user-1',
        chatId: 'chat-1',
        characterId: 'char-1',
        callerContext: 'wardrobe-test',
      })
      expect(turn.pendingWardrobeAnnouncements.has('char-1')).toBe(true)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
      expect(repos.wardrobeHistory.settle).not.toHaveBeenCalled()
    })

    it('announces and settles at once without a turn', async () => {
      await notifyWardrobeChanged(
        repos,
        { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', provenance: OPERATOR },
        'wardrobe-test',
      )
      expect(triggerAvatarGenerationIfEnabled).toHaveBeenCalledTimes(1)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledWith('user-1', {
        chatId: 'chat-1',
        characterId: 'char-1',
      })
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledTimes(1)
    })
  })

  describe('flushPendingWardrobeAnnouncements', () => {
    it('settles each character\'s intent, enqueues one announcement each, and clears both containers', async () => {
      const turn = newWardrobeTurnContainers()
      turn.pendingWardrobeAnnouncements.add('char-1').add('char-2')
      turn.pendingWardrobeHistory.set('char-1', { kind: 'append', provenance: BY_CHAR_1 })
      turn.pendingWardrobeHistory.set('char-2', { kind: 'cursor', index: 4 })

      await flushPendingWardrobeAnnouncements({ userId: 'user-1', chatId: 'chat-1', ...turn }, repos)

      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(2)
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledWith('chat-1', 'char-1', { kind: 'append', provenance: BY_CHAR_1 })
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledWith('chat-1', 'char-2', { kind: 'cursor', index: 4 })
      expect(turn.pendingWardrobeAnnouncements.size).toBe(0)
      expect(turn.pendingWardrobeHistory.size).toBe(0)
    })

    it('settles before announcing', async () => {
      const order: string[] = []
      repos.wardrobeHistory.settle.mockImplementation(async () => { order.push('settle') })
      enqueueWardrobeOutfitAnnouncement.mockImplementation(async () => { order.push('announce') })
      const turn = newWardrobeTurnContainers()
      turn.pendingWardrobeAnnouncements.add('char-1')
      turn.pendingWardrobeHistory.set('char-1', { kind: 'append', provenance: BY_CHAR_1 })
      await flushPendingWardrobeAnnouncements({ userId: 'user-1', chatId: 'chat-1', ...turn }, repos)
      expect(order).toEqual(['settle', 'announce'])
    })

    it('is a no-op when the containers are missing', async () => {
      await flushPendingWardrobeAnnouncements({ userId: 'user-1', chatId: 'chat-1' }, repos)
      expect(enqueueWardrobeOutfitAnnouncement).not.toHaveBeenCalled()
      expect(repos.wardrobeHistory.settle).not.toHaveBeenCalled()
    })

    it('is idempotent across repeated calls', async () => {
      const turn = newWardrobeTurnContainers()
      turn.pendingWardrobeAnnouncements.add('char-1')
      turn.pendingWardrobeHistory.set('char-1', { kind: 'append', provenance: BY_CHAR_1 })
      const ctx = { userId: 'user-1', chatId: 'chat-1', ...turn }
      await flushPendingWardrobeAnnouncements(ctx, repos)
      await flushPendingWardrobeAnnouncements(ctx, repos)
      expect(enqueueWardrobeOutfitAnnouncement).toHaveBeenCalledTimes(1)
      expect(repos.wardrobeHistory.settle).toHaveBeenCalledTimes(1)
    })
  })
})
