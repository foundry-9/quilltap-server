/**
 * Fold catch-up continuation (review finding 7, bug 232).
 *
 * A catch-up job (`pass: 'other-fold' | 'episode-fold'`) reads at most
 * FOLD_MAX_SLICES_PER_JOB slices. A backlog longer than that must not wait a
 * day per step (or forever, for a chat older than the sweep's lookback): the
 * handler enqueues the next step from the advanced cursor, keyed on it so
 * steps never collapse together. A slice lost to a timeout fails the job for
 * a retry instead.
 */

jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/extraction', () => ({
  buildExtractionContext: jest.fn(),
  ExtractionContextError: jest.requireActual('@/lib/memory/extraction/context').ExtractionContextError,
  runFoldCatchup: jest.fn(),
  runTurnExtraction: jest.fn(),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueMemoryExtraction: jest.fn(async () => 'job-next'),
  memoryExtractionPassOf: jest.requireActual('@/lib/background-jobs/queue-service').memoryExtractionPassOf,
}))
jest.mock('@/lib/services/system-events.service', () => ({ createMemoryExtractionEvent: jest.fn() }))
jest.mock('@/lib/services/cost-estimation.service', () => ({ estimateMessageCost: jest.fn() }))

import { handleMemoryExtraction } from '@/lib/background-jobs/handlers/memory-extraction'
import { getRepositories } from '@/lib/repositories/factory'
import { buildExtractionContext, runFoldCatchup, runTurnExtraction } from '@/lib/memory/extraction'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'
import { CheapLLMTaskLostError } from '@/lib/memory/cheap-llm-tasks'

const mockCatchup = runFoldCatchup as jest.Mock
const mockEnqueue = enqueueMemoryExtraction as jest.Mock

const ctx = { chat: { id: 'chat-1' }, route: { connectionProfile: { provider: 'OPENAI', modelName: 'm' } } }

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'u1',
  type: 'MEMORY_EXTRACTION',
  payload: {
    chatId: 'chat-1',
    turnOpenerMessageId: null,
    extractionAnchorMessageId: 'tail',
    connectionProfileId: 'prof-1',
    pass: 'other-fold',
    ...over,
  },
}) as never

const result = (over: Record<string, unknown> = {}) => ({
  pass: 'other-fold', calls: 8, timedOut: 0, failed: 0, admitted: [], createdIds: [], reinforcedIds: [],
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, debugLogs: [],
  slices: 4, slicesDeferred: 0, cursorAdvancedTo: 'h240',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepositories as jest.Mock).mockReturnValue({
    connections: { findById: jest.fn(async () => ({ id: 'prof-1' })) },
  })
  ;(buildExtractionContext as jest.Mock).mockResolvedValue(ctx)
})

describe.each(['other-fold', 'episode-fold'] as const)('%s catch-up job', pass => {
  it('runs the catch-up for its pass, not the turn passes', async () => {
    mockCatchup.mockResolvedValue(result({ pass }))
    await handleMemoryExtraction(job({ pass }))
    expect(mockCatchup).toHaveBeenCalledWith(ctx, pass, { ignoreIdle: false })
    expect(runTurnExtraction).not.toHaveBeenCalled()
  })

  it('enqueues the next step from the advanced cursor when slices were deferred', async () => {
    mockCatchup.mockResolvedValue(result({ pass, slicesDeferred: 6 }))
    await handleMemoryExtraction(job({ pass, ignoreIdle: true }))
    expect(mockCatchup).toHaveBeenCalledWith(ctx, pass, { ignoreIdle: true })
    expect(mockEnqueue).toHaveBeenCalledWith('u1', {
      chatId: 'chat-1',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: null,
      connectionProfileId: 'prof-1',
      pass,
      cursor: 'h240',
      ignoreIdle: true,
    })
  })

  it('does not carry ignoreIdle into a successor of an ordinary sweep job', async () => {
    mockCatchup.mockResolvedValue(result({ pass, slicesDeferred: 2 }))
    await handleMemoryExtraction(job({ pass }))
    expect(mockEnqueue.mock.calls[0][1]).not.toHaveProperty('ignoreIdle')
  })

  it('enqueues nothing when the backlog is done', async () => {
    mockCatchup.mockResolvedValue(result({ pass }))
    await handleMemoryExtraction(job({ pass }))
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('enqueues nothing (and fails for retry) when a slice timed out', async () => {
    mockCatchup.mockResolvedValue(result({ pass, slicesDeferred: 6, timedOut: 1 }))
    await expect(handleMemoryExtraction(job({ pass }))).rejects.toBeInstanceOf(CheapLLMTaskLostError)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('rows queued before Phase D', () => {
  it('reads foldOtherCatchup / foldOtherIgnoreIdle as an idle-skipping other-fold catch-up', async () => {
    mockCatchup.mockResolvedValue(result({ slicesDeferred: 1 }))
    await handleMemoryExtraction(job({ pass: undefined, foldOtherCatchup: true, foldOtherIgnoreIdle: true }))
    expect(mockCatchup).toHaveBeenCalledWith(ctx, 'other-fold', { ignoreIdle: true })
    expect(mockEnqueue.mock.calls[0][1]).toMatchObject({ pass: 'other-fold', cursor: 'h240', ignoreIdle: true })
  })

  it('reads foldEpisodeCatchup as an episode-fold catch-up', async () => {
    mockCatchup.mockResolvedValue(result({ pass: 'episode-fold' }))
    await handleMemoryExtraction(job({ pass: undefined, foldEpisodeCatchup: true }))
    expect(mockCatchup).toHaveBeenCalledWith(ctx, 'episode-fold', { ignoreIdle: false })
  })
})
