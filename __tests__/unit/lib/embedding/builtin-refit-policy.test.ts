/**
 * The Built-in (TF-IDF) vocabulary is refit only when it is missing, predates
 * the anchor-free text shape, or has drifted — never for a single memory edit
 * (builtin-tfidf-memory-tuning §6).
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingRefit: jest.fn().mockResolvedValue('job-1'),
}))

import {
  BUILTIN_TEXT_SHAPE_EPOCH,
  REFIT_MIN_NEW_MEMORIES,
  checkBuiltinRefit,
  driftThreshold,
  evaluateRefitNeed,
} from '@/lib/embedding/builtin-refit-policy'
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler'
import { getRepositories } from '@/lib/repositories/factory'
import { enqueueEmbeddingRefit } from '@/lib/background-jobs/queue-service'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockEnqueue = enqueueEmbeddingRefit as jest.MockedFunction<typeof enqueueEmbeddingRefit>

const AFTER_EPOCH = '2026-10-20T00:00:00.000Z'
const builtin = { id: 'p-tf', userId: 'u-1', provider: 'BUILTIN', isDefault: true }

function repos(opts: {
  profile?: Record<string, unknown> | null
  fittedAt?: string | null
  perCharacter?: Array<{ total: number; newSince: number }>
  jobs?: Array<{ status: string }>
}) {
  const per = opts.perCharacter ?? [{ total: 100, newSince: 0 }]
  const ids = per.map((_, i) => `c-${i}`)
  const r = {
    embeddingProfiles: {
      findAll: jest.fn().mockResolvedValue(opts.profile === null ? [] : [opts.profile ?? builtin]),
      findById: jest.fn().mockResolvedValue(opts.profile === null ? null : opts.profile ?? builtin),
      findDefault: jest.fn().mockResolvedValue(opts.profile === null ? null : opts.profile ?? builtin),
    },
    tfidfVocabularies: {
      findByProfileId: jest.fn().mockResolvedValue(
        opts.fittedAt === null ? null : { fittedAt: opts.fittedAt ?? AFTER_EPOCH },
      ),
    },
    memories: {
      findDistinctCharacterIds: jest.fn().mockResolvedValue(ids),
      countByCharacterId: jest.fn(async (id: string) => per[ids.indexOf(id)].total),
      countCreatedSince: jest.fn(async (id: string) => per[ids.indexOf(id)].newSince),
    },
    backgroundJobs: { findRecentByType: jest.fn().mockResolvedValue(opts.jobs ?? []) },
  }
  mockGetRepositories.mockReturnValue(r as never)
  return r
}

describe('evaluateRefitNeed', () => {
  it('refits a missing vocabulary', () => {
    expect(evaluateRefitNeed({ fittedAt: null, newSinceFit: 0, totalMemories: 0 })).toBe('unfitted')
  })

  it('refits a vocabulary fitted before the anchor-free text shape, once', () => {
    expect(evaluateRefitNeed({ fittedAt: '2026-10-13T15:00:00.000Z', newSinceFit: 0, totalMemories: 10 })).toBe('text-shape')
    expect(evaluateRefitNeed({ fittedAt: BUILTIN_TEXT_SHAPE_EPOCH, newSinceFit: 0, totalMemories: 10 })).toBeNull()
  })

  it('refits on drift: max(25, 10% of the corpus) new memories', () => {
    expect(driftThreshold(100)).toBe(REFIT_MIN_NEW_MEMORIES)
    expect(driftThreshold(1000)).toBe(100)
    expect(evaluateRefitNeed({ fittedAt: AFTER_EPOCH, newSinceFit: 24, totalMemories: 100 })).toBeNull()
    expect(evaluateRefitNeed({ fittedAt: AFTER_EPOCH, newSinceFit: 25, totalMemories: 100 })).toBe('drift')
    expect(evaluateRefitNeed({ fittedAt: AFTER_EPOCH, newSinceFit: 99, totalMemories: 1000 })).toBeNull()
    expect(evaluateRefitNeed({ fittedAt: AFTER_EPOCH, newSinceFit: 100, totalMemories: 1000 })).toBe('drift')
  })
})

describe('checkBuiltinRefit', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does nothing on a neural default profile', async () => {
    repos({ profile: { id: 'p-oa', userId: 'u-1', provider: 'OPENAI', isDefault: true } })
    await expect(checkBuiltinRefit()).resolves.toEqual({ profileId: 'p-oa', reason: null, enqueued: false })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does nothing when the vocabulary is current', async () => {
    repos({ perCharacter: [{ total: 60, newSince: 3 }, { total: 40, newSince: 2 }] })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: null, enqueued: false })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('enqueues a refit with reindex when the corpus has drifted across characters', async () => {
    repos({ perCharacter: [{ total: 60, newSince: 15 }, { total: 40, newSince: 10 }] })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: 'drift', enqueued: true })
    expect(mockEnqueue).toHaveBeenCalledWith('u-1', { profileId: 'p-tf', triggerReindex: true })
  })

  it('enqueues the one-time text-shape refit for a vocabulary fitted with anchor lines', async () => {
    repos({ fittedAt: '2026-10-09T00:00:00.000Z' })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: 'text-shape', enqueued: true })
  })

  it('does not stack a refit on one already in hand', async () => {
    repos({ fittedAt: '2026-10-09T00:00:00.000Z', jobs: [{ status: 'PENDING' }] })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: 'text-shape', enqueued: false })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('scheduleRefit (debounced, gated)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  async function fire() {
    await jest.advanceTimersByTimeAsync(5_000)
  }

  it('a manual edit on a current vocabulary enqueues nothing', async () => {
    repos({ perCharacter: [{ total: 245, newSince: 1 }] })
    await scheduleRefit('u-1')
    await fire()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('refits once the edits add up to drift', async () => {
    repos({ perCharacter: [{ total: 245, newSince: 25 }] })
    await scheduleRefit('u-1')
    await fire()
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('a due refit is not enqueued again while one is pending', async () => {
    repos({ fittedAt: '2026-10-09T00:00:00.000Z', jobs: [{ status: 'PROCESSING' }] })
    await scheduleRefit('u-1')
    await fire()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('a forced call refits regardless, and a later unforced call in the window keeps it forced', async () => {
    repos({ perCharacter: [{ total: 245, newSince: 0 }] })
    await scheduleRefit('u-1', 'p-tf', { force: true })
    await scheduleRefit('u-1', 'p-tf')
    await fire()
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith('u-1', { profileId: 'p-tf', triggerReindex: true })
  })

  it('ignores neural profiles', async () => {
    repos({ profile: { id: 'p-oa', userId: 'u-1', provider: 'OPENAI', isDefault: true }, fittedAt: null })
    await scheduleRefit('u-1', undefined, { force: true })
    await fire()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
