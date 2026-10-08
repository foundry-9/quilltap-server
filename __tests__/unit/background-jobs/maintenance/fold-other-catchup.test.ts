/** @jest-environment node */
import { enqueueFoldOtherCatchups } from '@/lib/background-jobs/maintenance/fold-other-catchup'
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service'
import { findFoldOtherCatchupCandidates, FOLD_OTHER_CATCHUP_MAX_CHATS } from '@/lib/memory/fold-other-pass'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child } }
})
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueMemoryExtraction: jest.fn() }))
jest.mock('@/lib/memory/fold-other-pass', () => ({
  findFoldOtherCatchupCandidates: jest.fn(),
  FOLD_OTHER_CATCHUP_MAX_CHATS: 25,
}))

const find = findFoldOtherCatchupCandidates as jest.Mock
const enqueue = enqueueMemoryExtraction as jest.Mock
const cand = (n: number) => ({ userId: `u${n}`, chatId: `chat${n}`, lastMessageId: `m${n}`, connectionProfileId: `p${n}` })

beforeEach(() => {
  jest.clearAllMocks()
  enqueue.mockResolvedValue('job')
})

describe('enqueueFoldOtherCatchups', () => {
  it('enqueues nothing when there are no candidates', async () => {
    find.mockResolvedValue({ candidates: [], deferred: 0 })
    expect(await enqueueFoldOtherCatchups()).toEqual({ enqueued: 0, deferred: 0 })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('enqueues one catch-up extraction per candidate with the right payload', async () => {
    find.mockResolvedValue({ candidates: [cand(1), cand(2)], deferred: 0 })
    expect(await enqueueFoldOtherCatchups()).toEqual({ enqueued: 2, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue).toHaveBeenNthCalledWith(1, 'u1', {
      chatId: 'chat1',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: 'm1',
      connectionProfileId: 'p1',
      foldOtherCatchup: true,
    })
  })

  it('defaults the limit to the module cap and forwards now/limit overrides', async () => {
    find.mockResolvedValue({ candidates: [], deferred: 0 })
    await enqueueFoldOtherCatchups()
    expect(find).toHaveBeenLastCalledWith({ now: undefined, limit: FOLD_OTHER_CATCHUP_MAX_CHATS })
    await enqueueFoldOtherCatchups({ now: 123, limit: 3 })
    expect(find).toHaveBeenLastCalledWith({ now: 123, limit: 3 })
  })

  it('reports deferred chats beyond the cap', async () => {
    find.mockResolvedValue({ candidates: [cand(1)], deferred: 7 })
    expect(await enqueueFoldOtherCatchups({ limit: 1 })).toEqual({ enqueued: 1, deferred: 7 })
  })

  it('continues past an enqueue failure and counts only successes', async () => {
    find.mockResolvedValue({ candidates: [cand(1), cand(2), cand(3)], deferred: 0 })
    enqueue.mockResolvedValueOnce('a').mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('c')
    expect(await enqueueFoldOtherCatchups()).toEqual({ enqueued: 2, deferred: 0 })
    expect(enqueue).toHaveBeenCalledTimes(3)
  })

  it('propagates a failure of the candidate search', async () => {
    find.mockRejectedValue(new Error('db'))
    await expect(enqueueFoldOtherCatchups()).rejects.toThrow('db')
  })
})
