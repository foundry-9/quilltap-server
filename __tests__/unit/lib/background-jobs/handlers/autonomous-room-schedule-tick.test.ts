/**
 * Tests for the autonomous-room schedule tick: that a due cron slot delegates
 * to the parent-ordered `startScheduledAutonomousRun` (never doing the
 * race-prone child-buffered write+enqueue itself), and that the self-heal sweep
 * re-engages a room left `running` with nothing in flight.
 */

import {
  handleAutonomousRoomScheduleTick,
  healWedgedRuns,
} from '@/lib/background-jobs/handlers/autonomous-room-schedule-tick'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service'
import { startScheduledAutonomousRun } from '@/lib/background-jobs/handlers/autonomous-run-start'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueAutonomousRoomTurn: jest.fn() }))
jest.mock('@/lib/background-jobs/handlers/autonomous-run-start', () => ({
  startScheduledAutonomousRun: jest.fn(),
}))

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockEnqueue = enqueueAutonomousRoomTurn as jest.MockedFunction<typeof enqueueAutonomousRoomTurn>
const mockStartScheduled = startScheduledAutonomousRun as jest.MockedFunction<typeof startScheduledAutonomousRun>

function makeRepos(chats: Array<Record<string, unknown>>, pendingByChat: Record<string, any[]> = {}) {
  const repos = {
    chatSettings: { findByUserId: jest.fn(async () => undefined) },
    chats: {
      findByUserId: jest.fn(async () => chats),
      update: jest.fn(async () => {}),
    },
    backgroundJobs: {
      findPendingForChat: jest.fn(async (chatId: string) => pendingByChat[chatId] ?? []),
    },
  }
  mockGetRepositories.mockReturnValue(repos as any)
  return repos
}

const minutesAgoIso = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  mockStartScheduled.mockResolvedValue({ ok: true, runId: 'run-x', jobId: 'job-x' } as any)
  mockEnqueue.mockResolvedValue('job-heal')
})

describe('handleAutonomousRoomScheduleTick — scheduled start delegation', () => {
  it('delegates a due+fresh cron slot to startScheduledAutonomousRun (not an inline write/enqueue)', async () => {
    makeRepos([
      {
        id: 'chat-due',
        chatType: 'autonomous',
        scheduleCron: '0 5 * * *',
        runState: 'idle',
        scheduleNextRunAt: minutesAgoIso(60), // an hour overdue
        scheduleFreshnessWindowMs: 12 * 60 * 60 * 1000,
      },
    ])

    await handleAutonomousRoomScheduleTick({ userId: 'user-1' } as any)

    expect(mockStartScheduled).toHaveBeenCalledTimes(1)
    expect(mockStartScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-due',
        userId: 'user-1',
        runId: expect.any(String),
        onEnqueueFailure: 'idle',
        scheduleLastRunAt: expect.any(String),
        scheduleNextRunAt: expect.any(String),
      }),
    )
  })

  it('does not start a run that is not yet due', async () => {
    makeRepos([
      {
        id: 'chat-future',
        chatType: 'autonomous',
        scheduleCron: '0 5 * * *',
        runState: 'idle',
        scheduleNextRunAt: new Date(Date.now() + 3600_000).toISOString(),
        scheduleFreshnessWindowMs: 12 * 60 * 60 * 1000,
      },
    ])

    await handleAutonomousRoomScheduleTick({ userId: 'user-1' } as any)
    expect(mockStartScheduled).not.toHaveBeenCalled()
  })

  it('skips running rooms in the start scan (they are handled by the heal sweep)', async () => {
    makeRepos([
      { id: 'chat-run', chatType: 'autonomous', scheduleCron: '0 5 * * *', runState: 'running', currentRunId: 'r1', updatedAt: minutesAgoIso(1) },
    ])
    await handleAutonomousRoomScheduleTick({ userId: 'user-1' } as any)
    expect(mockStartScheduled).not.toHaveBeenCalled()
  })
})

describe('healWedgedRuns — self-heal sweep', () => {
  it('re-enqueues a running room with no in-flight turn past the grace window', async () => {
    makeRepos([
      { id: 'chat-wedged', chatType: 'autonomous', runState: 'running', currentRunId: 'run-wedged', updatedAt: minutesAgoIso(5) },
    ])

    const healed = await healWedgedRuns('user-1')

    expect(healed).toBe(1)
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-wedged', runId: 'run-wedged' })
  })

  it('leaves a running room alone while a turn job is in flight', async () => {
    makeRepos(
      [{ id: 'chat-ok', chatType: 'autonomous', runState: 'running', currentRunId: 'r1', updatedAt: minutesAgoIso(10) }],
      { 'chat-ok': [{ type: 'AUTONOMOUS_ROOM_TURN', status: 'PENDING' }] },
    )

    const healed = await healWedgedRuns('user-1')
    expect(healed).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('leaves a freshly-started run alone (within the grace window)', async () => {
    makeRepos([
      { id: 'chat-fresh', chatType: 'autonomous', runState: 'running', currentRunId: 'r1', updatedAt: minutesAgoIso(0) },
    ])
    const healed = await healWedgedRuns('user-1')
    expect(healed).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('ignores non-running rooms and running rooms with no currentRunId', async () => {
    makeRepos([
      { id: 'chat-paused', chatType: 'autonomous', runState: 'paused', currentRunId: 'r1', updatedAt: minutesAgoIso(30) },
      { id: 'chat-norun', chatType: 'autonomous', runState: 'running', currentRunId: null, updatedAt: minutesAgoIso(30) },
    ])
    const healed = await healWedgedRuns('user-1')
    expect(healed).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
