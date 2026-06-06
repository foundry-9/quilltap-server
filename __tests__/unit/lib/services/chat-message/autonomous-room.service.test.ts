/**
 * Unit tests for the autonomous-room manual run-control service, focused on
 * the pause → resume lifecycle.
 *
 * Resume of a *paused* run must CONTINUE the same run (preserve currentRunId
 * and the turn/token counters, no fresh-start ceremony) and exclude the paused
 * interval from the wall-clock budget by shifting runStartedAt forward. Resume
 * of any other state falls back to a fresh start (new runId via the manual
 * start path).
 */

import {
  startAutonomousRoomManually,
  pauseAutonomousRoom,
  resumeAutonomousRoom,
  reconcileAutonomousRunsAtStartup,
} from '@/lib/services/chat-message/autonomous-room.service'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueAutonomousRoomTurn: jest.fn(),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockEnqueue = enqueueAutonomousRoomTurn as jest.MockedFunction<typeof enqueueAutonomousRoomTurn>

const RUN_ID = '11111111-1111-4111-8111-111111111111'

const baseChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  chatType: 'autonomous',
  currentRunId: RUN_ID,
  runState: 'paused',
  runStateMessage: 'manual:paused',
  runStartedAt: '2026-05-26T16:00:00.000Z',
  runEndedAt: null,
  runPausedAt: '2026-05-26T16:10:00.000Z', // 10 minutes of active time before pause
  runPausedAccumMs: 0,
  runTurnsConsumed: 5,
  runTokensConsumed: 1000,
  scheduleCron: null,
  scheduleNextRunAt: null,
  scheduleFreshnessWindowMs: null,
  ...overrides,
})

const makeRepos = (chat: Record<string, unknown> | null) => {
  const updates: Array<Record<string, unknown>> = []
  const messages: Array<{ chatId: string; message: Record<string, unknown> }> = []
  const repos = {
    chats: {
      findById: jest.fn(async () => (chat ? { ...chat } : null)),
      update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
        updates.push({ ...patch })
      }),
      // The run-start contract posts a Host "run begun" banner via
      // postRunStartAnnouncement → repos.chats.addMessage.
      addMessage: jest.fn(async (chatId: string, message: Record<string, unknown>) => {
        messages.push({ chatId, message })
      }),
    },
    characters: {
      findById: jest.fn(async () => null),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => null),
    },
  }
  return { repos, updates, messages }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEnqueue.mockResolvedValue('job-next')
})

describe('startAutonomousRoomManually', () => {
  it('flips the row straight to running (counters zeroed) and posts the run-begun banner before enqueueing', async () => {
    const { repos, updates, messages } = makeRepos(
      baseChat({ runState: 'idle', currentRunId: null, runPausedAt: null }),
    )
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await startAutonomousRoomManually('chat-1', 'user-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The badge/header should be correct the instant this returns: the row is
    // 'running', not parked at 'idle' for the turn job to promote.
    const patch = updates[0]
    expect(patch.runState).toBe('running')
    expect(typeof patch.runStartedAt).toBe('string')
    expect(patch.runEndedAt).toBeNull()
    expect(patch.runPausedAt).toBeNull()
    expect(patch.runPausedAccumMs).toBe(0)
    expect(patch.runTurnsConsumed).toBe(0)
    expect(patch.runTokensConsumed).toBe(0)
    expect(patch.runMilestonesAnnounced).toBe(0)
    expect(patch.currentRunId).toBe(result.runId)

    // The turn job is enqueued with the freshly minted run id.
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', runId: result.runId })

    // A Host "run begun" banner is posted.
    expect(messages).toHaveLength(1)
    expect(messages[0].message.systemSender).toBe('host')
    expect(messages[0].message.systemKind).toBe('autonomous-room-start')
  })

  it('rejects when a run is already in progress', async () => {
    const { repos, updates } = makeRepos(baseChat({ runState: 'running' }))
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await startAutonomousRoomManually('chat-1', 'user-1')

    expect(result).toMatchObject({ ok: false, reason: 'already_running' })
    expect(updates).toHaveLength(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('rolls the row to error when the turn enqueue fails', async () => {
    const { repos, updates } = makeRepos(baseChat({ runState: 'idle', currentRunId: null }))
    mockGetRepositories.mockReturnValue(repos as never)
    mockEnqueue.mockRejectedValueOnce(new Error('queue down'))

    await expect(startAutonomousRoomManually('chat-1', 'user-1')).rejects.toThrow('queue down')

    // First write flipped to running; the rollback write parks it at error so
    // the badge doesn't lie about a run that never queued a turn.
    expect(updates[0].runState).toBe('running')
    expect(updates[updates.length - 1].runState).toBe('error')
    expect(updates[updates.length - 1].runStateMessage).toBe('start:enqueue_failed')
  })
})

describe('pauseAutonomousRoom', () => {
  it('stamps runPausedAt alongside the paused state', async () => {
    const { repos, updates } = makeRepos(baseChat({ runState: 'running', runPausedAt: null }))
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await pauseAutonomousRoom('chat-1')

    expect(result.ok).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].runState).toBe('paused')
    expect(updates[0].runStateMessage).toBe('manual:paused')
    expect(typeof updates[0].runPausedAt).toBe('string')
    expect(Number.isNaN(Date.parse(updates[0].runPausedAt as string))).toBe(false)
  })
})

describe('resumeAutonomousRoom — continuing a paused run', () => {
  it('keeps the same runId and counters, clears pause state, and enqueues with the existing runId', async () => {
    const { repos, updates } = makeRepos(baseChat())
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await resumeAutonomousRoom('chat-1', 'user-1')

    expect(result).toEqual({ ok: true, runId: RUN_ID, jobId: 'job-next' })

    expect(updates).toHaveLength(1)
    const patch = updates[0]
    expect(patch.runState).toBe('running')
    expect(patch.runStateMessage).toBeNull()
    expect(patch.runEndedAt).toBeNull()
    expect(patch.runPausedAt).toBeNull()
    // The run is continued — currentRunId, runStartedAt (the token-accounting
    // window anchor), and the counters are never touched.
    expect(patch).not.toHaveProperty('currentRunId')
    expect(patch).not.toHaveProperty('runStartedAt')
    expect(patch).not.toHaveProperty('runTurnsConsumed')
    expect(patch).not.toHaveProperty('runTokensConsumed')

    // The turn job reuses the existing run id (so the stale-run guard passes).
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', runId: RUN_ID })
  })

  it('accumulates the paused interval into runPausedAccumMs and leaves runStartedAt untouched', async () => {
    const nowMs = Date.parse('2026-05-26T18:00:00.000Z')
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs)
    try {
      // 5s already accumulated from a prior pause cycle.
      const { repos, updates } = makeRepos(baseChat({ runPausedAccumMs: 5_000 }))
      mockGetRepositories.mockReturnValue(repos as never)

      await resumeAutonomousRoom('chat-1', 'user-1')

      // This paused interval = 18:00 − 16:10, added on top of the prior 5s.
      const thisPauseMs = nowMs - Date.parse('2026-05-26T16:10:00.000Z')
      expect(updates[0].runPausedAccumMs).toBe(5_000 + thisPauseMs)
      // runStartedAt must NOT move — it anchors the token-usage window.
      expect(updates[0]).not.toHaveProperty('runStartedAt')
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('rejects when the run is already running', async () => {
    const { repos, updates } = makeRepos(baseChat({ runState: 'running' }))
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await resumeAutonomousRoom('chat-1', 'user-1')

    expect(result).toMatchObject({ ok: false, reason: 'already_running' })
    expect(updates).toHaveLength(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('resumeAutonomousRoom — falling back to a fresh start', () => {
  it.each(['idle', 'stopped', 'budgetExhausted', 'error'])(
    'starts a fresh run (new runId, running transition) when state is %s',
    async (state) => {
      const { repos, updates } = makeRepos(baseChat({ runState: state }))
      mockGetRepositories.mockReturnValue(repos as never)

      const result = await resumeAutonomousRoom('chat-1', 'user-1')

      expect(result.ok).toBe(true)
      // Fresh start mints a brand-new run id and flips the row straight to
      // 'running' (counters zeroed) so the badge/header reflect it immediately.
      const patch = updates[0]
      expect(patch.runState).toBe('running')
      expect(patch.runTurnsConsumed).toBe(0)
      expect(patch.runTokensConsumed).toBe(0)
      expect(patch.currentRunId).toBeDefined()
      expect(patch.currentRunId).not.toBe(RUN_ID)
      expect(patch.runPausedAt).toBeNull()
      if (result.ok) {
        expect(result.runId).toBe(patch.currentRunId)
        expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', runId: result.runId })
      }
    },
  )

  it('starts fresh when paused but missing a currentRunId', async () => {
    const { repos, updates } = makeRepos(baseChat({ currentRunId: null }))
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await resumeAutonomousRoom('chat-1', 'user-1')

    expect(result.ok).toBe(true)
    expect(updates[0].runState).toBe('running')
    expect(updates[0].currentRunId).toBeTruthy()
  })
})

describe('reconcileAutonomousRunsAtStartup', () => {
  const makeReconcileRepos = (chats: Array<Record<string, unknown>>) => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    const repos = {
      chats: {
        findAll: jest.fn(async () => chats.map((c) => ({ ...c }))),
        update: jest.fn(async (id: string, patch: Record<string, unknown>) => {
          updates.push({ id, patch: { ...patch } })
        }),
      },
    }
    return { repos, updates }
  }

  it('parks a crash-interrupted (running) room at paused/resumable, preserving counters and bumping runId', async () => {
    const { repos, updates } = makeReconcileRepos([
      {
        id: 'chat-1',
        chatType: 'autonomous',
        runState: 'running',
        currentRunId: RUN_ID,
        runStartedAt: '2026-05-26T16:00:00.000Z',
        lastMessageAt: '2026-05-26T16:08:00.000Z',
        runTurnsConsumed: 5,
        runTokensConsumed: 1000,
      },
    ])
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await reconcileAutonomousRunsAtStartup()

    expect(result.reconciledCount).toBe(1)
    expect(updates).toHaveLength(1)
    const patch = updates[0].patch
    expect(patch.runState).toBe('paused')
    expect(patch.runStateMessage).toBe('restart:interrupted')
    expect(patch.runEndedAt).toBeNull()
    // Pause stamp comes from the last message (proxy for when conversing stopped).
    expect(patch.runPausedAt).toBe('2026-05-26T16:08:00.000Z')
    // currentRunId bumped for zombie-job safety; counters left untouched.
    expect(patch.currentRunId).toBeDefined()
    expect(patch.currentRunId).not.toBe(RUN_ID)
    expect(patch).not.toHaveProperty('runTurnsConsumed')
    expect(patch).not.toHaveProperty('runTokensConsumed')
  })

  it('ignores rooms that are not autonomous or not running', async () => {
    const { repos, updates } = makeReconcileRepos([
      { id: 'a', chatType: 'salon', runState: 'running' },
      { id: 'b', chatType: 'autonomous', runState: 'idle' },
      { id: 'c', chatType: 'autonomous', runState: 'paused' },
    ])
    mockGetRepositories.mockReturnValue(repos as never)

    const result = await reconcileAutonomousRunsAtStartup()

    expect(result.reconciledCount).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('falls back to runStartedAt for the pause stamp when there is no last message', async () => {
    const { repos, updates } = makeReconcileRepos([
      {
        id: 'chat-1',
        chatType: 'autonomous',
        runState: 'running',
        currentRunId: RUN_ID,
        runStartedAt: '2026-05-26T16:00:00.000Z',
        lastMessageAt: null,
      },
    ])
    mockGetRepositories.mockReturnValue(repos as never)

    await reconcileAutonomousRunsAtStartup()

    expect(updates[0].patch.runPausedAt).toBe('2026-05-26T16:00:00.000Z')
  })
})
