/**
 * Tests for lib/services/dangerous-content/manual-flip.ts
 *
 * Covers all 12 ordered transitions of the four-state control (stored pair +
 * announcement kind) and the no-op behavior when the requested state already
 * matches the stored one; the refusal-ledger reset on a return to Monitored;
 * and the Concierge's own `{ by: 'concierge' }` switch.
 */

import {
  applyConciergeFlip,
  currentConciergeState,
} from '@/lib/services/dangerous-content/manual-flip'
import { getRepositories } from '@/lib/repositories/factory'
import { postConciergeManualAnnouncement } from '@/lib/services/concierge-notifications/writer'
import type { ChatMetadata } from '@/lib/schemas/types'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeManualAnnouncement: jest.fn().mockResolvedValue(null),
}))

const chatsUpdate = jest.fn().mockResolvedValue(null)
const resetLedger = jest.fn().mockResolvedValue(undefined)
;(getRepositories as jest.Mock).mockReturnValue({
  chats: { update: chatsUpdate, resetModerationRefusalLedger: resetLedger },
})

beforeEach(() => {
  chatsUpdate.mockClear()
  resetLedger.mockClear()
  ;(postConciergeManualAnnouncement as jest.Mock).mockClear()
})

function makeChat(overrides: Partial<ChatMetadata> = {}): ChatMetadata {
  return {
    id: 'chat-1',
    userId: 'user-1',
    participants: [{ id: 'p1' } as ChatMetadata['participants'][number]],
    title: 'Test Chat',
    tags: [],
    messageCount: 12,
    lastRenameCheckInterchange: 0,
    compactionGeneration: 0,
    lastSummaryTurn: 0,
    lastSummaryTokens: 0,
    lastFullRebuildTurn: 0,
    summaryAnchorMessageIds: [],
    isPaused: false,
    isManuallyRenamed: false,
    impersonatingParticipantIds: [],
    allLLMPauseTurnCount: 0,
    turnQueue: '[]',
    documentEditingMode: false,
    documentMode: 'normal',
    dividerPosition: 45,
    terminalMode: 'normal',
    rightPaneVerticalSplit: 50,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    requestFullContextOnNextMessage: false,
    disabledTools: [],
    disabledToolGroups: [],
    forceToolsOnNextMessage: false,
    allowCrossCharacterVaultReads: false,
    state: {},
    agentTurnCount: 0,
    dangerCategories: [],
    chatType: 'salon',
    createdAt: '2026-05-22T00:00:00Z',
    updatedAt: '2026-05-22T00:00:00Z',
    ...overrides,
  } as ChatMetadata
}

describe('currentConciergeState', () => {
  it('returns "vouched" when conciergeOverride is OFF (even if isDangerousChat=true)', () => {
    expect(currentConciergeState({ conciergeOverride: 'OFF', isDangerousChat: true })).toBe('vouched')
  })

  it('returns "uncensored" when conciergeOverride is UNCENSORED (either label underneath)', () => {
    expect(currentConciergeState({ conciergeOverride: 'UNCENSORED', isDangerousChat: true })).toBe('uncensored')
    expect(currentConciergeState({ conciergeOverride: 'UNCENSORED', isDangerousChat: false })).toBe('uncensored')
  })

  it('returns "flagged" when isDangerousChat=true and no operator override', () => {
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: true })).toBe('flagged')
  })

  it('returns "monitored" when neither flag is set', () => {
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: false })).toBe('monitored')
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: null })).toBe('monitored')
  })
})

describe('applyConciergeFlip', () => {
  // Stored-field fixtures for each starting state.
  const FROM = {
    monitored: { conciergeOverride: null, isDangerousChat: false },
    flagged: { conciergeOverride: null, isDangerousChat: true },
    vouched: { conciergeOverride: 'OFF' as const, isDangerousChat: true },
    uncensored: { conciergeOverride: 'UNCENSORED' as const, isDangerousChat: true },
  }

  it.each(['monitored', 'flagged', 'vouched', 'uncensored'] as const)(
    'is a no-op when %s is requested again', async (state) => {
      const chat = makeChat(FROM[state])
      const result = await applyConciergeFlip('chat-1', state, chat)
      expect(result).toEqual({ newState: state, changed: false })
      expect(chatsUpdate).not.toHaveBeenCalled()
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
    })

  // All 12 ordered transitions: [from, to, expected update, announcement kind].
  const STAMP = expect.objectContaining({ conciergeOverride: null, isDangerousChat: true })
  const CLEAR = expect.objectContaining({
    conciergeOverride: null,
    isDangerousChat: false,
    dangerScore: null,
    dangerClassifiedAt: null,
    dangerClassifiedAtMessageCount: null,
  })
  const VOUCH = { conciergeOverride: 'OFF' }
  const UNCENSOR = { conciergeOverride: 'UNCENSORED' }

  const TRANSITIONS = [
    ['monitored', 'flagged', STAMP, 'manual-flagged'],
    ['monitored', 'vouched', VOUCH, 'manual-vouched'],
    ['monitored', 'uncensored', UNCENSOR, 'manual-uncensored'],
    ['flagged', 'monitored', CLEAR, 'manual-safe'],
    ['flagged', 'vouched', VOUCH, 'manual-vouched'],
    ['flagged', 'uncensored', UNCENSOR, 'manual-uncensored'],
    ['vouched', 'monitored', CLEAR, 'manual-resumed'],
    ['vouched', 'flagged', STAMP, 'manual-flagged'],
    ['vouched', 'uncensored', UNCENSOR, 'manual-uncensored'],
    ['uncensored', 'monitored', CLEAR, 'manual-resumed'],
    ['uncensored', 'flagged', STAMP, 'manual-flagged'],
    ['uncensored', 'vouched', VOUCH, 'manual-vouched'],
  ] as const

  it.each(TRANSITIONS)('%s -> %s writes the stored pair and announces the right kind',
    async (from, to, expectedUpdate, kind) => {
      const chat = makeChat(FROM[from])
      const result = await applyConciergeFlip('chat-1', to, chat)
      expect(result).toEqual({ newState: to, changed: true })
      expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expectedUpdate)
      expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind })
    })

  it('Monitored -> Flagged stamps classification metadata at the current message count', async () => {
    const chat = makeChat({ isDangerousChat: false, conciergeOverride: null, messageCount: 42 })
    await applyConciergeFlip('chat-1', 'flagged', chat)
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      conciergeOverride: null,
      isDangerousChat: true,
      dangerClassifiedAtMessageCount: 42,
    }))
  })

  it('operator states preserve isDangerousChat (the update never touches the label)', async () => {
    for (const to of ['vouched', 'uncensored'] as const) {
      chatsUpdate.mockClear()
      const chat = makeChat({ isDangerousChat: true, conciergeOverride: null })
      await applyConciergeFlip('chat-1', to, chat)
      const [, update] = chatsUpdate.mock.calls[0]
      expect(update).not.toHaveProperty('isDangerousChat')
    }
  })

  it.each(['flagged', 'vouched', 'uncensored'] as const)(
    '%s -> monitored resets the refusal ledger', async (from) => {
      await applyConciergeFlip('chat-1', 'monitored', makeChat(FROM[from]))
      expect(resetLedger).toHaveBeenCalledWith('chat-1')
    })

  it.each([
    ['monitored', 'flagged'], ['monitored', 'vouched'], ['monitored', 'uncensored'],
    ['flagged', 'vouched'], ['vouched', 'flagged'], ['uncensored', 'flagged'],
  ] as const)('%s -> %s leaves the refusal ledger alone', async (from, to) => {
    await applyConciergeFlip('chat-1', to, makeChat(FROM[from]))
    expect(resetLedger).not.toHaveBeenCalled()
  })

  it('a no-op Monitored request does not reset the ledger', async () => {
    await applyConciergeFlip('chat-1', 'monitored', makeChat(FROM.monitored))
    expect(resetLedger).not.toHaveBeenCalled()
  })

  it('the default options keep the operator flag byte-identical', async () => {
    await applyConciergeFlip('chat-1', 'flagged', makeChat(FROM.monitored))
    const [, update] = chatsUpdate.mock.calls[0]
    expect(update.dangerCategories).toEqual([])
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-flagged' })
  })

  it("the Concierge's refusal switch stamps its category and posts the auto kind", async () => {
    const refusals = { count: 2, lastProvider: 'GOOGLE', lastModel: 'gemini-2.5-flash' }
    const result = await applyConciergeFlip('chat-1', 'flagged', makeChat(FROM.monitored), {
      by: 'concierge',
      reason: 'refusals',
      refusals,
    })
    expect(result).toEqual({ newState: 'flagged', changed: true })
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      conciergeOverride: null,
      isDangerousChat: true,
      dangerCategories: ['moderation-refusals'],
    }))
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({
      chatId: 'chat-1',
      kind: 'auto-flagged-refusals',
      details: refusals,
    })
  })
})
