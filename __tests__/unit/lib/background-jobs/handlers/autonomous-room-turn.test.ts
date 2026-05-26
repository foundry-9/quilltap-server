import { handleAutonomousRoomTurn } from '@/lib/background-jobs/handlers/autonomous-room-turn'
import { getRepositories } from '@/lib/repositories/factory'
import { handleSendMessage } from '@/lib/services/chat-message/orchestrator.service'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager'
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/services/chat-message/orchestrator.service', () => ({
  handleSendMessage: jest.fn(),
}))
jest.mock('@/lib/chat/turn-manager', () => ({
  selectNextSpeaker: jest.fn(),
  calculateTurnStateFromHistory: jest.fn(),
  getActiveCharacterParticipants: jest.fn(),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueAutonomousRoomTurn: jest.fn(),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockHandleSendMessage = handleSendMessage as jest.MockedFunction<typeof handleSendMessage>
const mockSelectNextSpeaker = selectNextSpeaker as jest.MockedFunction<typeof selectNextSpeaker>
const mockCalculateTurnStateFromHistory = calculateTurnStateFromHistory as jest.MockedFunction<typeof calculateTurnStateFromHistory>
const mockGetActiveCharacterParticipants = getActiveCharacterParticipants as jest.MockedFunction<typeof getActiveCharacterParticipants>
const mockEnqueueAutonomousRoomTurn = enqueueAutonomousRoomTurn as jest.MockedFunction<typeof enqueueAutonomousRoomTurn>

/**
 * Build a child-style repository proxy that simulates the readonly-DB +
 * buffered-writes semantics of the forked-job runner. Reads return the
 * "committed" snapshot; writes are recorded but do NOT update the snapshot
 * (mirroring how the AsyncLocalStorage buffer holds writes until flush at
 * end of job, with the readonly connection unable to see them).
 */
const createBufferedRepos = (initial: {
  chat: Record<string, unknown>
  jobId: string
  chatId: string
}) => {
  const committed = { ...initial.chat }
  const chatUpdates: Array<Record<string, unknown>> = []
  const messageAdds: Array<{ id?: string; createdAt?: string; participantId?: string | null; type?: string }> = []

  return {
    state: {
      get committed() { return committed },
      get chatUpdates() { return chatUpdates },
      get messageAdds() { return messageAdds },
    },
    repos: {
      chats: {
        findById: jest.fn(async () => ({ ...committed })),
        getMessages: jest.fn(async () => messageAdds),
        update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
          chatUpdates.push({ ...patch })
          // Buffered: do NOT update `committed`.
        }),
        addMessage: jest.fn(async (_id: string, message: Record<string, unknown>) => {
          messageAdds.push(message as never)
        }),
      },
      chatSettings: {
        findByUserId: jest.fn(async () => null),
      },
      llmLogs: {
        getTotalTokenUsageForChatSince: jest.fn(async () => ({ totalTokens: 0 })),
        getTotalTokenUsageSince: jest.fn(async () => ({ totalTokens: 0 })),
      },
      characters: {
        findById: jest.fn(async (id: string) => ({ id, name: `Char-${id}` })),
      },
      backgroundJobs: {
        findPendingForChat: jest.fn(async () => []),
      },
    },
  }
}

const baseJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'AUTONOMOUS_ROOM_TURN' as const,
  status: 'PROCESSING' as const,
  payload: { chatId: 'chat-1', runId: 'run-A' },
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const baseChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'autonomous',
  currentRunId: 'run-A',
  runState: 'running',
  runStartedAt: '2026-05-26T16:00:00.000Z',
  runTurnsConsumed: 5,
  runTokensConsumed: 1000,
  budgetMaxTurns: null,
  budgetMaxTokens: null,
  budgetMaxWallClockMs: null,
  scheduleCron: null,
  scheduleNextRunAt: null,
  participants: [
    { id: 'p1', characterId: 'char-1', type: 'CHARACTER', status: 'active', controlledBy: 'llm' },
    { id: 'p2', characterId: 'char-2', type: 'CHARACTER', status: 'active', controlledBy: 'llm' },
  ],
  spokenThisCycleParticipantIds: [],
  ...overrides,
})

/**
 * Minimal duck-typed ReadableStream that satisfies the handler's `drainStream`
 * loop (Jest's jsdom env doesn't expose the real Web Streams API).
 */
const drainableStream = () => ({
  getReader: () => ({
    read: async () => ({ done: true, value: undefined }),
    releaseLock: () => {},
  }),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockHandleSendMessage.mockResolvedValue(drainableStream() as never)
  mockGetActiveCharacterParticipants.mockImplementation(((participants: Array<{ id: string }>) => participants) as never)
  mockCalculateTurnStateFromHistory.mockReturnValue({} as never)
  mockSelectNextSpeaker.mockReturnValue({ nextSpeakerId: 'p1', reason: 'next', cycleComplete: false } as never)
  mockEnqueueAutonomousRoomTurn.mockResolvedValue('job-next')
})

describe('handleAutonomousRoomTurn — counter bookkeeping', () => {
  // Regression: the child-side repo proxy buffers writes; a read-modify-write
  // off `findById` after `update` always picks up the *previous* run's stale
  // counter, so the in-job increment-write lands after the reset-write at
  // flush time and clobbers it. The counter then accumulates across every
  // run forever. Verify the increment uses the local in-handler snapshot.

  it('resets the counter to 1 on the first turn of a new run (idle → running)', async () => {
    // Committed DB still shows the previous run's leftover counter (999),
    // because the manual-start path did NOT reset it — the reset happens
    // inside this handler at the idle → running transition.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'idle', runTurnsConsumed: 999, runTokensConsumed: 50000 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    // The first chats.update fires the idle → running reset (runTurnsConsumed:
    // 0). The final chats.update writes the post-turn counter. We assert on
    // the latter: it must be 1, not 1000 (the bug would yield 1000 because
    // post.runTurnsConsumed reads the still-stale 999 from the readonly DB).
    const updatesWithTurns = state.chatUpdates.filter(u => 'runTurnsConsumed' in u)
    expect(updatesWithTurns.length).toBeGreaterThanOrEqual(2)
    const resetUpdate = updatesWithTurns[0]
    const finalUpdate = updatesWithTurns[updatesWithTurns.length - 1]
    expect(resetUpdate.runTurnsConsumed).toBe(0)
    expect(finalUpdate.runTurnsConsumed).toBe(1)
  })

  it('increments off the local snapshot when continuing a run (already running)', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const updatesWithTurns = state.chatUpdates.filter(u => 'runTurnsConsumed' in u)
    // No reset on a continuing run — only the single post-turn update.
    expect(updatesWithTurns).toHaveLength(1)
    expect(updatesWithTurns[0].runTurnsConsumed).toBe(8)
  })

  it('does not increment when handleSendMessage throws (turn failed)', async () => {
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)
    mockHandleSendMessage.mockRejectedValueOnce(new Error('boom'))

    await handleAutonomousRoomTurn(baseJob() as never)

    // No increment-write should land — only the error transition.
    const updatesWithTurns = state.chatUpdates.filter(
      u => 'runTurnsConsumed' in u && typeof u.runTurnsConsumed === 'number',
    )
    expect(updatesWithTurns).toHaveLength(0)
  })

  it('does NOT trip budgetExhausted on the first turn of a fresh run with a small turn cap', async () => {
    // Original user-reported symptom: a chat with budgetMaxTurns=10 and a
    // stale counter of 999 carried over from a prior run would trip
    // budgetExhausted immediately on the first turn — the buggy
    // read-modify-write off `post.runTurnsConsumed` ignored the buffered
    // reset and saw 999 + 1 = 1000 >= 10. With the fix, the local snapshot
    // (mutated to 0 on the idle → running transition) gives 0 + 1 = 1,
    // well under the cap, so the next turn is enqueued normally.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({
        runState: 'idle',
        runTurnsConsumed: 999,
        budgetMaxTurns: 10,
      }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const exhaustionTransitions = state.chatUpdates.filter(
      u => u.runState === 'budgetExhausted',
    )
    expect(exhaustionTransitions).toHaveLength(0)
    expect(mockEnqueueAutonomousRoomTurn).toHaveBeenCalledTimes(1)
  })

  it('uses the freshly-computed counter for the post-turn budget check', async () => {
    // Counter reaches the cap exactly on this turn (running, 7 → 8 with
    // cap=8). The post-turn budget check must see the just-computed value
    // (8), not the stale re-read (7), and trip the run.
    const { state, repos } = createBufferedRepos({
      chat: baseChat({ runState: 'running', runTurnsConsumed: 7, budgetMaxTurns: 8 }),
      jobId: 'job-1',
      chatId: 'chat-1',
    })
    mockGetRepositories.mockReturnValue(repos as never)

    await handleAutonomousRoomTurn(baseJob() as never)

    const stateTransitions = state.chatUpdates.filter(u => u.runState === 'budgetExhausted')
    expect(stateTransitions).toHaveLength(1)
    expect(stateTransitions[0].runStateMessage).toBe('budget:turns')
    expect(mockEnqueueAutonomousRoomTurn).not.toHaveBeenCalled()
  })
})
