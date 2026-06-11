/**
 * Tests for the shared autonomous run-start core + child-aware bridge.
 *
 * The regression these lock in: the run-start row write (`currentRunId`) MUST be
 * applied before the first turn job is enqueued, and the scheduled path MUST
 * route through host-RPC when running in the forked job child so that ordering
 * holds on the parent's RW connection. A turn that runs before `currentRunId`
 * is committed self-aborts as `stale_run_job` and wedges the room.
 */

import {
  beginAutonomousRun,
  startScheduledAutonomousRun,
} from '@/lib/background-jobs/handlers/autonomous-run-start'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueAutonomousRoomTurn } from '@/lib/background-jobs/queue-service'
import { callHost } from '@/lib/background-jobs/child/host-rpc-client'

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
jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({ callHost: jest.fn() }))
// Keep the real `runStartPatch` (it's the source of the `currentRunId` field we
// assert on) but stub the banner so we don't drag in characters/turn-manager.
jest.mock('@/lib/background-jobs/handlers/autonomous-room-announce', () => {
  const actual = jest.requireActual('@/lib/background-jobs/handlers/autonomous-room-announce')
  return { ...actual, postRunStartAnnouncement: jest.fn() }
})

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockEnqueue = enqueueAutonomousRoomTurn as jest.MockedFunction<typeof enqueueAutonomousRoomTurn>
const mockCallHost = callHost as jest.MockedFunction<typeof callHost>

interface ReposHarness {
  repos: any
  callOrder: string[]
  chatUpdates: Array<Record<string, unknown>>
}

function makeRepos(chat: Record<string, unknown> | null): ReposHarness {
  const callOrder: string[] = []
  const chatUpdates: Array<Record<string, unknown>> = []
  const repos = {
    chats: {
      findById: jest.fn(async () => chat),
      update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
        callOrder.push('update')
        chatUpdates.push(patch)
      }),
    },
  }
  mockGetRepositories.mockReturnValue(repos as any)
  mockEnqueue.mockImplementation(async () => {
    callOrder.push('enqueue')
    return 'job-1'
  })
  return { repos, callOrder, chatUpdates }
}

const AUTONOMOUS_CHAT = { id: 'chat-1', chatType: 'autonomous' }

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('beginAutonomousRun', () => {
  it('writes currentRunId BEFORE enqueuing the turn (the ordering contract)', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })

    const result = await beginAutonomousRun({
      chatId: 'chat-1',
      userId: 'user-1',
      runId: 'run-NEW',
      nowIso: '2026-06-11T00:00:00.000Z',
      scheduleLastRunAt: '2026-06-11T00:00:00.000Z',
      scheduleNextRunAt: '2026-06-12T10:00:00.000Z',
      onEnqueueFailure: 'idle',
    })

    expect(result).toEqual({ ok: true, runId: 'run-NEW', jobId: 'job-1' })
    // The chat-row write happens first, and it carries the new run id.
    expect(h.callOrder).toEqual(['update', 'enqueue'])
    expect(h.chatUpdates[0]).toMatchObject({
      currentRunId: 'run-NEW',
      runState: 'running',
      scheduleLastRunAt: '2026-06-11T00:00:00.000Z',
      scheduleNextRunAt: '2026-06-12T10:00:00.000Z',
    })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', runId: 'run-NEW' })
  })

  it('omits scheduleNextRunAt when the key is not provided', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })
    await beginAutonomousRun({
      chatId: 'chat-1', userId: 'user-1', runId: 'run-NEW',
      nowIso: '2026-06-11T00:00:00.000Z', scheduleLastRunAt: '2026-06-11T00:00:00.000Z',
      onEnqueueFailure: 'error',
    })
    expect(h.chatUpdates[0]).not.toHaveProperty('scheduleNextRunAt')
  })

  it('rolls the row back to the requested state and returns enqueue_failed when enqueue throws', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })
    mockEnqueue.mockImplementation(async () => {
      h.callOrder.push('enqueue')
      throw new Error('db down')
    })

    const result = await beginAutonomousRun({
      chatId: 'chat-1', userId: 'user-1', runId: 'run-NEW',
      nowIso: '2026-06-11T00:00:00.000Z', onEnqueueFailure: 'idle',
    })

    expect(result).toMatchObject({ ok: false, reason: 'enqueue_failed', message: 'schedule:enqueue_failed' })
    // Two writes: the run-start flip, then the rollback.
    expect(h.repos.chats.update).toHaveBeenCalledTimes(2)
    expect(h.chatUpdates[1]).toMatchObject({ runState: 'idle', runStateMessage: 'schedule:enqueue_failed' })
  })

  it('uses error state for the manual-start rollback policy', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })
    mockEnqueue.mockImplementation(async () => { throw new Error('db down') })
    const result = await beginAutonomousRun({
      chatId: 'chat-1', userId: 'user-1', runId: 'run-NEW',
      nowIso: '2026-06-11T00:00:00.000Z', onEnqueueFailure: 'error',
    })
    expect(result).toMatchObject({ ok: false, reason: 'enqueue_failed', message: 'start:enqueue_failed' })
    expect(h.chatUpdates[1]).toMatchObject({ runState: 'error', runStateMessage: 'start:enqueue_failed' })
  })

  it('returns chat_not_found / not_autonomous without writing', async () => {
    const missing = makeRepos(null)
    expect(await beginAutonomousRun({
      chatId: 'x', userId: 'u', runId: 'r', nowIso: 'now', onEnqueueFailure: 'idle',
    })).toMatchObject({ ok: false, reason: 'chat_not_found' })
    expect(missing.repos.chats.update).not.toHaveBeenCalled()

    const wrong = makeRepos({ id: 'chat-1', chatType: 'group' })
    expect(await beginAutonomousRun({
      chatId: 'chat-1', userId: 'u', runId: 'r', nowIso: 'now', onEnqueueFailure: 'idle',
    })).toMatchObject({ ok: false, reason: 'not_autonomous' })
    expect(wrong.repos.chats.update).not.toHaveBeenCalled()
  })
})

describe('startScheduledAutonomousRun (child-aware bridge)', () => {
  const input = {
    chatId: 'chat-1', userId: 'user-1', runId: 'run-NEW',
    nowIso: '2026-06-11T00:00:00.000Z', onEnqueueFailure: 'idle' as const,
  }

  it('routes to host-RPC (does NOT touch the DB) when running in the job child', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })
    process.env.QUILLTAP_JOB_CHILD = '1'
    mockCallHost.mockResolvedValue({ ok: true, runId: 'run-NEW', jobId: 'job-host' } as any)

    const result = await startScheduledAutonomousRun(input)

    expect(mockCallHost).toHaveBeenCalledWith('startScheduledAutonomousRun', input)
    expect(result).toEqual({ ok: true, runId: 'run-NEW', jobId: 'job-host' })
    // The core must not have run locally in the child.
    expect(h.repos.chats.update).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('runs the core directly on the parent (no host-RPC) when not in the child', async () => {
    const h = makeRepos({ ...AUTONOMOUS_CHAT })
    const result = await startScheduledAutonomousRun(input)

    expect(mockCallHost).not.toHaveBeenCalled()
    expect(h.repos.chats.update).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, runId: 'run-NEW' })
  })
})
