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
  LEXICAL_TEXT_SHAPE_VERSION,
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

const FITTED = '2026-10-13T20:00:00.000Z'
const CURRENT = LEXICAL_TEXT_SHAPE_VERSION
const builtin = { id: 'p-tf', userId: 'u-1', provider: 'BUILTIN', isDefault: true }

function repos(opts: {
  profile?: Record<string, unknown> | null
  fittedAt?: string | null
  textShapeVersion?: number
  perCharacter?: Array<{ total: number; newSince: number }>
  jobs?: Array<{ status: string }>
}) {
  const per = opts.perCharacter ?? [{ total: 100, newSince: 0 }]
  const total = per.reduce((n, c) => n + c.total, 0)
  const newSince = per.reduce((n, c) => n + c.newSince, 0)
  // Jobs the "queue" holds: the given ones plus any refit this test enqueues.
  const active: Array<{ status: string }> = [...(opts.jobs ?? [])]
  mockEnqueue.mockImplementation(async () => {
    active.push({ status: 'PENDING' })
    return 'job-1'
  })
  const r = {
    embeddingProfiles: {
      findInstanceDefault: jest.fn().mockResolvedValue(opts.profile === null ? null : opts.profile ?? builtin),
      findById: jest.fn().mockResolvedValue(opts.profile === null ? null : opts.profile ?? builtin),
      findDefault: jest.fn().mockResolvedValue(opts.profile === null ? null : opts.profile ?? builtin),
    },
    tfidfVocabularies: {
      findByProfileId: jest.fn().mockResolvedValue(
        opts.fittedAt === null
          ? null
          : { fittedAt: opts.fittedAt ?? FITTED, textShapeVersion: opts.textShapeVersion ?? CURRENT },
      ),
    },
    memories: {
      countCorpusSince: jest.fn(async (since: string | null) => ({ total, createdSince: since ? newSince : 0 })),
    },
    backgroundJobs: {
      findActiveByType: jest.fn(async (type: string) => (type === 'EMBEDDING_REFIT' ? [...active] : [])),
    },
  }
  mockGetRepositories.mockReturnValue(r as never)
  return r
}

describe('evaluateRefitNeed', () => {
  it('refits a missing vocabulary', () => {
    expect(evaluateRefitNeed({ fittedAt: null, newSinceFit: 0, totalMemories: 0 })).toBe('unfitted')
  })

  it('refits a vocabulary stamped with an older text shape, whatever its date', () => {
    expect(evaluateRefitNeed({ fittedAt: FITTED, textShapeVersion: 0, newSinceFit: 0, totalMemories: 10 })).toBe('text-shape')
    expect(evaluateRefitNeed({ fittedAt: FITTED, newSinceFit: 0, totalMemories: 10 })).toBe('text-shape')
    expect(evaluateRefitNeed({ fittedAt: '2099-01-01T00:00:00.000Z', textShapeVersion: 0, newSinceFit: 0, totalMemories: 10 })).toBe('text-shape')
    expect(evaluateRefitNeed({ fittedAt: '2020-01-01T00:00:00.000Z', textShapeVersion: CURRENT, newSinceFit: 0, totalMemories: 10 })).toBeNull()
  })

  it('refits on drift: max(25, 10% of the corpus) new memories', () => {
    expect(driftThreshold(100)).toBe(REFIT_MIN_NEW_MEMORIES)
    expect(driftThreshold(1000)).toBe(100)
    expect(evaluateRefitNeed({ fittedAt: FITTED, textShapeVersion: CURRENT, newSinceFit: 24, totalMemories: 100 })).toBeNull()
    expect(evaluateRefitNeed({ fittedAt: FITTED, textShapeVersion: CURRENT, newSinceFit: 25, totalMemories: 100 })).toBe('drift')
    expect(evaluateRefitNeed({ fittedAt: FITTED, textShapeVersion: CURRENT, newSinceFit: 99, totalMemories: 1000 })).toBeNull()
    expect(evaluateRefitNeed({ fittedAt: FITTED, textShapeVersion: CURRENT, newSinceFit: 100, totalMemories: 1000 })).toBe('drift')
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
    repos({ textShapeVersion: 0 })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: 'text-shape', enqueued: true })
  })

  it('does not enqueue a refit there is nothing to fit', async () => {
    repos({ fittedAt: null, perCharacter: [] })
    await expect(checkBuiltinRefit()).resolves.toMatchObject({ reason: 'unfitted', enqueued: false })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('serialises the check: boot, the sweep and a debounced edit firing together enqueue one refit', async () => {
    jest.useFakeTimers()
    try {
      repos({ textShapeVersion: 0 })
      await scheduleRefit('u-1')
      const timerFired = jest.advanceTimersByTimeAsync(5_000)
      const results = await Promise.all([checkBuiltinRefit(), checkBuiltinRefit()])
      await timerFired
      expect(mockEnqueue).toHaveBeenCalledTimes(1)
      expect(results.filter((r) => r.enqueued)).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not stack a refit on one already in hand', async () => {
    repos({ textShapeVersion: 0, jobs: [{ status: 'PENDING' }] })
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
    repos({ textShapeVersion: 0, jobs: [{ status: 'PROCESSING' }] })
    await scheduleRefit('u-1')
    await fire()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('a forced call is held by a pending refit but not by a running one', async () => {
    repos({ jobs: [{ status: 'PENDING' }] })
    await scheduleRefit('u-1', 'p-tf', { force: true })
    await fire()
    expect(mockEnqueue).not.toHaveBeenCalled()

    repos({ jobs: [{ status: 'PROCESSING' }] })
    await scheduleRefit('u-1', 'p-tf', { force: true })
    await fire()
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
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
