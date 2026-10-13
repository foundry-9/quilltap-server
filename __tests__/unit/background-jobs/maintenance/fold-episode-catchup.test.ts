/** @jest-environment node */
/**
 * The episode catch-up sweep starts at most one chain per chat: a chat with an
 * episode catch-up already queued or running (the sweep's own job or a
 * `continue-episode:` successor, whose anchors never match) is skipped.
 */
import { enqueueFoldEpisodeCatchups } from '@/lib/background-jobs/maintenance/fold-episode-catchup'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'
import { findFoldEpisodeCatchupCandidates } from '@/lib/memory/fold-episode-catchup'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child } }
})
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueMemoryExtraction: jest.fn() }))
jest.mock('@/lib/memory/fold-episode-catchup', () => ({ findFoldEpisodeCatchupCandidates: jest.fn() }))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

const find = findFoldEpisodeCatchupCandidates as jest.Mock
const enqueue = enqueueMemoryExtraction as jest.Mock
const cand = (n: number) => ({ userId: 'u1', chatId: `chat${n}`, foldEndMessageId: `m${n}`, connectionProfileId: `p${n}` })

function jobsInFlight(pending: unknown[], processing: unknown[] = []) {
  const findByUserId = jest.fn(async (_u: string, status: string) => (status === 'PENDING' ? pending : processing))
  ;(getRepositories as jest.Mock).mockReturnValue({ backgroundJobs: { findByUserId } })
  return findByUserId
}

beforeEach(() => {
  jest.clearAllMocks()
  enqueue.mockResolvedValue('job')
})

describe('enqueueFoldEpisodeCatchups', () => {
  it('skips a chat whose continuation chain is still queued or running', async () => {
    find.mockResolvedValue({ candidates: [cand(1), cand(2), cand(3)], deferred: 0 })
    jobsInFlight(
      [{ type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat1', foldEpisodeCatchup: true, extractionAnchorMessageId: 'continue-episode:m0' } }],
      [
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat2', foldEpisodeCatchup: true, extractionAnchorMessageId: 'm2' } },
        // A per-turn extraction or an OTHER catch-up does not block the episode chain.
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat3', foldOtherCatchup: true } },
      ],
    )

    expect(await enqueueFoldEpisodeCatchups()).toEqual({ enqueued: 1, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('u1', {
      chatId: 'chat3',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: 'm3',
      connectionProfileId: 'p3',
      foldEpisodeCatchup: true,
    })
  })

  it('forwards a shared chat list and reads no jobs when nothing is selected', async () => {
    find.mockResolvedValue({ candidates: [], deferred: 0 })
    const findByUserId = jobsInFlight([])
    const chats = [{ id: 'c' }]
    await enqueueFoldEpisodeCatchups({ now: 5, chats: chats as never })
    expect(find).toHaveBeenCalledWith({ now: 5, limit: expect.any(Number), chats })
    expect(findByUserId).not.toHaveBeenCalled()
  })

  it('falls back to the enqueue dedupe when the job list cannot be read', async () => {
    find.mockResolvedValue({ candidates: [cand(1)], deferred: 0 })
    ;(getRepositories as jest.Mock).mockReturnValue({
      backgroundJobs: { findByUserId: jest.fn(async () => { throw new Error('locked') }) },
    })
    expect(await enqueueFoldEpisodeCatchups()).toEqual({ enqueued: 1, deferred: 0 })
  })
})
