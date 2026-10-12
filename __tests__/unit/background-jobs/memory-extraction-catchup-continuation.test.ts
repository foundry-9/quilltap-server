/**
 * Fold-grain OTHER catch-up continuation (review finding 7).
 *
 * The catch-up reads at most FOLD_OTHER_MAX_SLICES_PER_JOB slices per job. A
 * backlog longer than that must not wait a day per step (or forever, for a
 * chat older than the sweep's lookback): the handler enqueues the next step
 * from the advanced watermark, keyed on it so steps never collapse together.
 */

jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/memory-processor', () => ({ processTurnForMemory: jest.fn() }))
jest.mock('@/lib/memory/fold-other-pass', () => ({ runFoldOtherCatchup: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueMemoryExtraction: jest.fn(async () => 'job-next') }))
jest.mock('@/lib/services/system-events.service', () => ({ createMemoryExtractionEvent: jest.fn() }))
jest.mock('@/lib/services/cost-estimation.service', () => ({ estimateMessageCost: jest.fn() }))

import { handleMemoryExtraction } from '@/lib/background-jobs/handlers/memory-extraction'
import { getRepositories } from '@/lib/repositories/factory'
import { runFoldOtherCatchup } from '@/lib/memory/fold-other-pass'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'

const mockCatchup = runFoldOtherCatchup as jest.Mock
const mockEnqueue = enqueueMemoryExtraction as jest.Mock

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'u1',
  type: 'MEMORY_EXTRACTION',
  payload: {
    chatId: 'chat-1',
    turnOpenerMessageId: null,
    extractionAnchorMessageId: 'tail',
    connectionProfileId: 'prof-1',
    foldOtherCatchup: true,
    ...over,
  },
}) as never

const result = (over: Record<string, unknown> = {}) => ({
  observers: 2, memoriesWritten: 0, memoriesReinforced: 0, candidatesProposed: 0,
  passesLostToTimeout: 0, slicesDeferred: 0, watermarkAdvancedTo: 'h240',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepositories as jest.Mock).mockReturnValue({
    connections: { findById: jest.fn(async () => ({ id: 'prof-1' })), findByUserId: jest.fn(async () => []) },
    chatSettings: { findByUserId: jest.fn(async () => ({ cheapLLMSettings: {} })) },
  })
})

it('enqueues the next step from the advanced watermark when slices were deferred', async () => {
  mockCatchup.mockResolvedValue(result({ slicesDeferred: 6 }))
  await handleMemoryExtraction(job({ foldOtherIgnoreIdle: true }))
  expect(mockEnqueue).toHaveBeenCalledWith('u1', {
    chatId: 'chat-1',
    turnOpenerMessageId: null,
    extractionAnchorMessageId: 'continue:h240',
    connectionProfileId: 'prof-1',
    foldOtherCatchup: true,
    foldOtherIgnoreIdle: true,
  })
})

it('enqueues nothing when the backlog is done', async () => {
  mockCatchup.mockResolvedValue(result())
  await handleMemoryExtraction(job())
  expect(mockEnqueue).not.toHaveBeenCalled()
})

it('enqueues nothing (and fails for retry) when a pass timed out', async () => {
  mockCatchup.mockResolvedValue(result({ slicesDeferred: 6, passesLostToTimeout: 1 }))
  await expect(handleMemoryExtraction(job())).rejects.toThrow()
  expect(mockEnqueue).not.toHaveBeenCalled()
})
