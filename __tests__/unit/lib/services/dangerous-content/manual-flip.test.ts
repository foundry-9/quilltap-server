/**
 * Tests for lib/services/dangerous-content/manual-flip.ts
 *
 * Covers the four manual transitions and the no-op behavior when the
 * requested state already matches the stored one.
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
;(getRepositories as jest.Mock).mockReturnValue({
  chats: { update: chatsUpdate },
})

beforeEach(() => {
  chatsUpdate.mockClear()
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
  it('returns "off" when conciergeOverride is OFF (even if isDangerousChat=true)', () => {
    expect(currentConciergeState({ conciergeOverride: 'OFF', isDangerousChat: true })).toBe('off')
  })

  it('returns "flagged" when isDangerousChat=true and not off-duty', () => {
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: true })).toBe('flagged')
  })

  it('returns "safe" when neither flag is set', () => {
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: false })).toBe('safe')
    expect(currentConciergeState({ conciergeOverride: null, isDangerousChat: null })).toBe('safe')
  })
})

describe('applyConciergeFlip', () => {
  it('is a no-op when the requested state already matches', async () => {
    const chat = makeChat({ isDangerousChat: false, conciergeOverride: null })
    const result = await applyConciergeFlip('chat-1', 'safe', chat)
    expect(result).toEqual({ newState: 'safe', changed: false })
    expect(chatsUpdate).not.toHaveBeenCalled()
    expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
  })

  it('Safe -> Flagged stamps classification metadata and announces manual-flagged', async () => {
    const chat = makeChat({ isDangerousChat: false, conciergeOverride: null, messageCount: 42 })
    const result = await applyConciergeFlip('chat-1', 'flagged', chat)
    expect(result.changed).toBe(true)
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      conciergeOverride: null,
      isDangerousChat: true,
      dangerClassifiedAtMessageCount: 42,
    }))
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-flagged' })
  })

  it('Flagged -> Safe clears classifier metadata and announces manual-safe', async () => {
    const chat = makeChat({ isDangerousChat: true, conciergeOverride: null })
    const result = await applyConciergeFlip('chat-1', 'safe', chat)
    expect(result.changed).toBe(true)
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      conciergeOverride: null,
      isDangerousChat: false,
      dangerScore: null,
      dangerClassifiedAt: null,
      dangerClassifiedAtMessageCount: null,
    }))
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-safe' })
  })

  it('anything -> Off-duty preserves isDangerousChat and announces manual-off-duty', async () => {
    const chat = makeChat({ isDangerousChat: true, conciergeOverride: null })
    const result = await applyConciergeFlip('chat-1', 'off', chat)
    expect(result.changed).toBe(true)
    expect(chatsUpdate).toHaveBeenCalledWith('chat-1', { conciergeOverride: 'OFF' })
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-off-duty' })
  })

  it('Off-duty -> Safe announces manual-on-duty (not manual-safe)', async () => {
    const chat = makeChat({ isDangerousChat: true, conciergeOverride: 'OFF' })
    const result = await applyConciergeFlip('chat-1', 'safe', chat)
    expect(result.changed).toBe(true)
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-on-duty' })
  })

  it('Off-duty -> Flagged announces manual-flagged', async () => {
    const chat = makeChat({ isDangerousChat: false, conciergeOverride: 'OFF' })
    const result = await applyConciergeFlip('chat-1', 'flagged', chat)
    expect(result.changed).toBe(true)
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind: 'manual-flagged' })
  })
})
