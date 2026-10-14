/** @jest-environment node */
/**
 * The fold catch-up sweep (`enqueueFoldCatchups(pass, …)`): one
 * MEMORY_EXTRACTION job per selected chat, `pass` naming the fold pass, and at
 * most one chain per chat and pass — a chat with a catch-up of that pass
 * already queued or running (the sweep's own job or a continuation, whose
 * anchors never match) is skipped (bug 232).
 */
import { enqueueFoldCatchups } from '@/lib/background-jobs/maintenance/fold-catchup'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'
import { findFoldCatchupCandidates, FOLD_CATCHUP_MAX_CHATS } from '@/lib/memory/extraction'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child } }
})
jest.mock('@/lib/background-jobs/queue-service', () => {
  const actual = jest.requireActual('@/lib/background-jobs/queue-service')
  return { memoryExtractionPassOf: actual.memoryExtractionPassOf, enqueueMemoryExtraction: jest.fn() }
})
jest.mock('@/lib/memory/extraction', () => ({
  findFoldCatchupCandidates: jest.fn(),
  FOLD_CATCHUP_MAX_CHATS: 50,
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

const find = findFoldCatchupCandidates as jest.Mock
const enqueue = enqueueMemoryExtraction as jest.Mock
const cand = (n: number, userId = `u${n}`) => ({ userId, chatId: `chat${n}`, anchorMessageId: `m${n}`, connectionProfileId: `p${n}` })

function jobsInFlight(pending: unknown[], processing: unknown[] = []) {
  const findByUserId = jest.fn(async (_u: string, status: string) => (status === 'PENDING' ? pending : processing))
  ;(getRepositories as jest.Mock).mockReturnValue({ backgroundJobs: { findByUserId } })
  return findByUserId
}

beforeEach(() => {
  jest.clearAllMocks()
  enqueue.mockResolvedValue('job')
  jobsInFlight([])
})

describe.each(['other-fold', 'episode-fold'] as const)('enqueueFoldCatchups(%s)', pass => {
  it('enqueues nothing, and reads no jobs, when there are no candidates', async () => {
    find.mockResolvedValue({ candidates: [], deferred: 0 })
    const findByUserId = jobsInFlight([])
    expect(await enqueueFoldCatchups(pass)).toEqual({ enqueued: 0, deferred: 0 })
    expect(enqueue).not.toHaveBeenCalled()
    expect(findByUserId).not.toHaveBeenCalled()
  })

  it('enqueues one catch-up extraction per candidate with the right payload', async () => {
    find.mockResolvedValue({ candidates: [cand(1), cand(2)], deferred: 0 })
    expect(await enqueueFoldCatchups(pass)).toEqual({ enqueued: 2, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue).toHaveBeenNthCalledWith(1, 'u1', {
      chatId: 'chat1',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: 'm1',
      connectionProfileId: 'p1',
      pass,
    })
  })

  it('defaults the limit to the module cap and forwards now/limit/chats/cursors', async () => {
    find.mockResolvedValue({ candidates: [], deferred: 0 })
    await enqueueFoldCatchups(pass)
    expect(find).toHaveBeenLastCalledWith(pass, { now: undefined, limit: FOLD_CATCHUP_MAX_CHATS, chats: undefined, cursors: undefined })
    const chats = [{ id: 'c' }]
    const cursors = new Map()
    await enqueueFoldCatchups(pass, { now: 123, limit: 3, chats: chats as never, cursors })
    expect(find).toHaveBeenLastCalledWith(pass, { now: 123, limit: 3, chats, cursors })
  })

  it('reports deferred chats beyond the cap', async () => {
    find.mockResolvedValue({ candidates: [cand(1)], deferred: 7 })
    expect(await enqueueFoldCatchups(pass, { limit: 1 })).toEqual({ enqueued: 1, deferred: 7 })
  })

  it('continues past an enqueue failure and counts only successes', async () => {
    find.mockResolvedValue({ candidates: [cand(1), cand(2), cand(3)], deferred: 0 })
    enqueue.mockResolvedValueOnce('a').mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('c')
    expect(await enqueueFoldCatchups(pass)).toEqual({ enqueued: 2, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(3)
  })

  it('propagates a failure of the candidate search', async () => {
    find.mockRejectedValue(new Error('db'))
    await expect(enqueueFoldCatchups(pass)).rejects.toThrow('db')
  })

  it('falls back to the enqueue dedupe when the job list cannot be read', async () => {
    find.mockResolvedValue({ candidates: [cand(1)], deferred: 0 })
    ;(getRepositories as jest.Mock).mockReturnValue({
      backgroundJobs: { findByUserId: jest.fn(async () => { throw new Error('locked') }) },
    })
    expect(await enqueueFoldCatchups(pass)).toEqual({ enqueued: 1, deferred: 0 })
  })
})

describe('enqueueFoldCatchups — one chain per chat and pass (bug 232)', () => {
  it('skips a chat whose chain of the same pass is still queued or running', async () => {
    find.mockResolvedValue({ candidates: [cand(1, 'u1'), cand(2, 'u1'), cand(3, 'u1'), cand(4, 'u1')], deferred: 0 })
    jobsInFlight(
      [
        // A continuation: its cursor and null anchor never match the sweep's own.
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat1', pass: 'episode-fold', cursor: 'm0', extractionAnchorMessageId: null } },
        // A row queued before Phase D, read through its legacy flag.
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat4', foldEpisodeCatchup: true, extractionAnchorMessageId: 'continue-episode:m0' } },
      ],
      [
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat2', pass: 'episode-fold', extractionAnchorMessageId: 'm2' } },
        // A per-turn extraction or an OTHER catch-up does not block the episode chain.
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat3', pass: 'other-fold' } },
        { type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat3', turnOpenerMessageId: 'u9' } },
        // Another job type naming the chat does not count.
        { type: 'CONTEXT_SUMMARY', payload: { chatId: 'chat3', pass: 'episode-fold' } },
      ],
    )

    expect(await enqueueFoldCatchups('episode-fold')).toEqual({ enqueued: 1, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('u1', {
      chatId: 'chat3',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: 'm3',
      connectionProfileId: 'p3',
      pass: 'episode-fold',
    })
  })

  it('an episode chain does not block the OTHER catch-up of the same chat', async () => {
    find.mockResolvedValue({ candidates: [cand(1, 'u1')], deferred: 0 })
    jobsInFlight([{ type: 'MEMORY_EXTRACTION', payload: { chatId: 'chat1', pass: 'episode-fold' } }])
    expect(await enqueueFoldCatchups('other-fold')).toEqual({ enqueued: 1, deferred: 0 })
  })
})
