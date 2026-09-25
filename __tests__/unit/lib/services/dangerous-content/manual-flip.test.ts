/**
 * Tests for lib/services/dangerous-content/manual-flip.ts
 *
 * Covers all six ordered transitions of the three-state control (stored
 * columns + announcement kind), the no-op when state and provenance already
 * match, the provenance-only update when the operator adopts the Concierge's
 * switch, the telemetry and ledger reset on a return to Moderated, and the
 * Concierge's own switches (refusals and classifier) through the chokepoint.
 */

import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip'
import { getRepositories } from '@/lib/repositories/factory'
import {
  postConciergeDangerAnnouncement,
  postConciergeManualAnnouncement,
} from '@/lib/services/concierge-notifications/writer'
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
  postConciergeDangerAnnouncement: jest.fn().mockResolvedValue(null),
}))

const chatsUpdate = jest.fn().mockResolvedValue(null)
const setMode = jest.fn().mockResolvedValue(true)
const resetLedger = jest.fn().mockResolvedValue(undefined)
;(getRepositories as jest.Mock).mockReturnValue({
  chats: { update: chatsUpdate, setConciergeMode: setMode, resetModerationRefusalLedger: resetLedger },
})

beforeEach(() => {
  chatsUpdate.mockClear()
  setMode.mockClear()
  setMode.mockResolvedValue(true)
  resetLedger.mockClear()
  ;(postConciergeManualAnnouncement as jest.Mock).mockClear()
  ;(postConciergeDangerAnnouncement as jest.Mock).mockClear()
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

const FROM = {
  moderated: { conciergeMode: 'moderated' as const, conciergeModeSetBy: null, conciergeModeReason: null },
  unmoderated: { conciergeMode: 'unmoderated' as const, conciergeModeSetBy: 'operator' as const, conciergeModeReason: 'manual' as const },
  locked: { conciergeMode: 'locked' as const, conciergeModeSetBy: 'operator' as const, conciergeModeReason: 'manual' as const },
}

const TO_MODERATED = { conciergeMode: 'moderated', conciergeModeSetBy: null, conciergeModeReason: null }
const CLEAR_TELEMETRY = {
  isDangerousChat: false,
  dangerScore: null,
  dangerCategories: [],
  dangerClassifiedAt: null,
  dangerClassifiedAtMessageCount: null,
}
const TO_UNMODERATED = { conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', conciergeModeReason: 'manual' }
const TO_LOCKED = { conciergeMode: 'locked', conciergeModeSetBy: 'operator', conciergeModeReason: 'manual' }

describe('applyConciergeFlip', () => {
  it.each(['moderated', 'unmoderated', 'locked'] as const)(
    'is a no-op when %s is requested again by the operator', async (state) => {
      const result = await applyConciergeFlip('chat-1', state, makeChat(FROM[state]))
      expect(result).toEqual({ newState: state, changed: false })
      expect(chatsUpdate).not.toHaveBeenCalled()
      expect(setMode).not.toHaveBeenCalled()
      expect(resetLedger).not.toHaveBeenCalled()
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
    })

  it('reads a NULL column as Moderated (no-op)', async () => {
    const result = await applyConciergeFlip('chat-1', 'moderated', makeChat({ conciergeMode: null }))
    expect(result.changed).toBe(false)
    expect(setMode).not.toHaveBeenCalled()
  })

  it.each([
    ['moderated', 'unmoderated', TO_UNMODERATED, 'set-unmoderated'],
    ['moderated', 'locked', TO_LOCKED, 'set-locked'],
    ['unmoderated', 'moderated', TO_MODERATED, 'set-moderated'],
    ['unmoderated', 'locked', TO_LOCKED, 'set-locked'],
    ['locked', 'moderated', TO_MODERATED, 'set-moderated'],
    ['locked', 'unmoderated', TO_UNMODERATED, 'set-unmoderated'],
  ] as const)('%s → %s writes the columns and announces %s', async (from, to, update, kind) => {
    const result = await applyConciergeFlip('chat-1', to, makeChat(FROM[from]))
    expect(result).toEqual({ newState: to, changed: true })
    // The operator's choice is unconditional: no expected state.
    expect(setMode).toHaveBeenCalledTimes(1)
    expect(setMode).toHaveBeenCalledWith('chat-1', update, undefined)
    expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', kind })
    // The state never rides a whole-row update, and the legacy column is never written.
    for (const [, patch] of chatsUpdate.mock.calls) {
      expect(patch).not.toHaveProperty('conciergeMode')
      expect(patch).not.toHaveProperty('conciergeOverride')
    }
    if (to === 'moderated') {
      expect(chatsUpdate).toHaveBeenCalledWith('chat-1', CLEAR_TELEMETRY)
    } else {
      expect(chatsUpdate).not.toHaveBeenCalled()
    }
  })

  it('empties the refusal ledger only on a return to Moderated', async () => {
    await applyConciergeFlip('chat-1', 'moderated', makeChat(FROM.unmoderated))
    expect(resetLedger).toHaveBeenCalledWith('chat-1')
    resetLedger.mockClear()
    await applyConciergeFlip('chat-1', 'locked', makeChat(FROM.moderated))
    await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.moderated))
    expect(resetLedger).not.toHaveBeenCalled()
  })

  describe('provenance', () => {
    const byConcierge = { conciergeMode: 'unmoderated' as const, conciergeModeSetBy: 'concierge' as const, conciergeModeReason: 'refusals' as const }

    it('updates provenance silently when the operator adopts the Concierge’s switch', async () => {
      const result = await applyConciergeFlip('chat-1', 'unmoderated', makeChat(byConcierge))
      expect(result).toEqual({ newState: 'unmoderated', changed: true })
      expect(setMode).toHaveBeenCalledWith('chat-1', { conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', conciergeModeReason: 'manual' })
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
    })

    it('never lets the Concierge re-attribute the operator’s choice', async () => {
      const result = await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.unmoderated), {
        by: 'concierge',
        reason: 'refusals',
      })
      expect(result.changed).toBe(false)
      expect(setMode).not.toHaveBeenCalled()
    })
  })

  describe("the Concierge's own switch", () => {
    it('announces nothing when the compare-and-set misses (the operator changed the chat meanwhile)', async () => {
      setMode.mockResolvedValue(false)
      const result = await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.moderated), {
        by: 'concierge',
        reason: 'classifier',
        classification: { score: 0.9, threshold: 0.7, categories: [] },
      })
      expect(result).toEqual({ newState: 'moderated', changed: false })
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
      expect(postConciergeDangerAnnouncement).not.toHaveBeenCalled()
    })

    it('refuses to run in the job child, where a buffered write cannot report whether it landed', async () => {
      process.env.QUILLTAP_JOB_CHILD = '1'
      try {
        const result = await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.moderated), {
          by: 'concierge',
          reason: 'refusals',
        })
        expect(result.changed).toBe(false)
        expect(setMode).not.toHaveBeenCalled()
      } finally {
        delete process.env.QUILLTAP_JOB_CHILD
      }
    })

    it('refusals: Moderated → Unmoderated with provenance and the auto-unmoderated announcement', async () => {
      const refusals = { count: 2, lastProvider: 'GOOGLE', lastModel: 'gemini' }
      const result = await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.moderated), {
        by: 'concierge',
        reason: 'refusals',
        refusals,
      })
      expect(result).toEqual({ newState: 'unmoderated', changed: true })
      // A compare-and-set against the state the Concierge read.
      expect(setMode).toHaveBeenCalledWith('chat-1', {
        conciergeMode: 'unmoderated',
        conciergeModeSetBy: 'concierge',
        conciergeModeReason: 'refusals',
      }, 'moderated')
      expect(postConciergeManualAnnouncement).toHaveBeenCalledWith({
        chatId: 'chat-1',
        kind: 'auto-unmoderated',
        details: refusals,
      })
      expect(postConciergeDangerAnnouncement).not.toHaveBeenCalled()
    })

    it("classifier: Moderated → Unmoderated with the verdict's announcement", async () => {
      const classification = { score: 0.9, threshold: 0.7, categories: [{ category: 'sexual', score: 0.9 }] }
      await applyConciergeFlip('chat-1', 'unmoderated', makeChat(FROM.moderated), {
        by: 'concierge',
        reason: 'classifier',
        classification,
      })
      expect(setMode).toHaveBeenCalledWith('chat-1', {
        conciergeMode: 'unmoderated',
        conciergeModeSetBy: 'concierge',
        conciergeModeReason: 'classifier',
      }, 'moderated')
      expect(postConciergeDangerAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', details: classification })
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
    })

    it.each([
      ['locked', 'unmoderated'],
      ['moderated', 'locked'],
      ['unmoderated', 'moderated'],
    ] as const)('refuses to move %s → %s', async (from, to) => {
      const result = await applyConciergeFlip('chat-1', to, makeChat(FROM[from]), { by: 'concierge', reason: 'refusals' })
      expect(result.changed).toBe(false)
      expect(setMode).not.toHaveBeenCalled()
      expect(postConciergeManualAnnouncement).not.toHaveBeenCalled()
    })
  })
})
