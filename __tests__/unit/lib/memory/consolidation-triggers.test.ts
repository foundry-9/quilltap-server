/** @jest-environment node */
import {
  characterIdsFromMemoryWrites,
  maybeEnqueueConsolidationForCharacters,
  maybeEnqueueConsolidationAfterCommit,
  runScheduledConsolidation,
  resetConsolidationTriggerStateForTests,
  WATERMARK_CHECK_DEBOUNCE_MS,
  WATERMARK_RUN_THROTTLE_MS,
} from '@/lib/memory/consolidation-triggers'
import { getRepositories } from '@/lib/repositories/factory'
import { getMemoryConsolidationSettings } from '@/lib/instance-settings'
import { enqueueMemoryConsolidation } from '@/lib/background-jobs/queue-service'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child } }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryConsolidationSettings: jest.fn() }))
jest.mock('@/lib/background-jobs/queue-service', () => ({ enqueueMemoryConsolidation: jest.fn() }))

const NOW = Date.parse('2026-10-08T12:00:00Z')
const repos = {
  memories: { countUnconsideredHot: jest.fn(), findDistinctCharacterIds: jest.fn() },
  characters: { findByIdRaw: jest.fn() },
  backgroundJobs: { findRecentByType: jest.fn() },
}
const enqueue = enqueueMemoryConsolidation as jest.Mock
const settingsMock = getMemoryConsolidationSettings as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  resetConsolidationTriggerStateForTests()
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
  settingsMock.mockResolvedValue({ enabled: true, watermark: 10 })
  repos.memories.countUnconsideredHot.mockResolvedValue(50)
  repos.memories.findDistinctCharacterIds.mockResolvedValue([])
  repos.characters.findByIdRaw.mockResolvedValue({ id: 'c1', userId: 'u1', archivedAt: null })
  repos.backgroundJobs.findRecentByType.mockResolvedValue([])
  enqueue.mockResolvedValue('job-x')
})

describe('characterIdsFromMemoryWrites', () => {
  it('collects distinct characterIds from memories.create only', () => {
    const ids = characterIdsFromMemoryWrites([
      { method: 'memories.create', args: [{ characterId: 'a' }] },
      { method: 'memories.create', args: [{ characterId: 'a' }] },
      { method: 'memories.create', args: [{ characterId: 'b' }] },
      { method: 'memories.update', args: [{ characterId: 'z' }] },
      { method: 'memories.create', args: [{ characterId: '' }] },
      { method: 'memories.create', args: [{ characterId: 5 }] },
      { method: 'memories.create', args: ['nope'] },
      { method: 'memories.create', args: [] },
      { method: 'memories.create', args: [null] },
    ])
    expect(ids).toEqual(['a', 'b'])
  })
})

describe('maybeEnqueueConsolidationForCharacters', () => {
  it('returns early for an empty list without reading settings', async () => {
    expect(await maybeEnqueueConsolidationForCharacters([], NOW)).toEqual([])
    expect(settingsMock).not.toHaveBeenCalled()
  })

  it('does nothing when consolidation is disabled', async () => {
    settingsMock.mockResolvedValue({ enabled: false, watermark: 10 })
    expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual([])
    expect(repos.memories.countUnconsideredHot).not.toHaveBeenCalled()
  })

  it('enqueues a watermark run when the count exceeds the watermark', async () => {
    expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual(['c1'])
    expect(enqueue).toHaveBeenCalledWith('u1', { characterId: 'c1', trigger: 'watermark' })
  })

  it('does not enqueue at exactly the watermark', async () => {
    repos.memories.countUnconsideredHot.mockResolvedValue(10)
    expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('debounces repeat checks inside the window and re-checks after it', async () => {
    repos.memories.countUnconsideredHot.mockResolvedValue(1)
    await maybeEnqueueConsolidationForCharacters(['c1'], NOW)
    await maybeEnqueueConsolidationForCharacters(['c1'], NOW + WATERMARK_CHECK_DEBOUNCE_MS - 1)
    expect(repos.memories.countUnconsideredHot).toHaveBeenCalledTimes(1)
    await maybeEnqueueConsolidationForCharacters(['c1'], NOW + WATERMARK_CHECK_DEBOUNCE_MS)
    expect(repos.memories.countUnconsideredHot).toHaveBeenCalledTimes(2)
  })

  it('debounces per character', async () => {
    repos.memories.countUnconsideredHot.mockResolvedValue(1)
    await maybeEnqueueConsolidationForCharacters(['c1'], NOW)
    await maybeEnqueueConsolidationForCharacters(['c1', 'c2'], NOW + 1000)
    expect(repos.memories.countUnconsideredHot.mock.calls.map((c) => c[0])).toEqual(['c1', 'c2'])
  })

  describe('throttle on recent runs', () => {
    const recentJob = (over: Record<string, unknown> = {}) => ({
      status: 'COMPLETED',
      payload: { characterId: 'c1' },
      updatedAt: new Date(NOW - 60_000).toISOString(),
      ...over,
    })

    it.each(['COMPLETED', 'PROCESSING', 'PENDING'])('skips when a %s run is inside the window', async (status) => {
      repos.backgroundJobs.findRecentByType.mockResolvedValue([recentJob({ status })])
      expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual([])
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('ignores a failed run, a dry run, another character, and a stale run', async () => {
      repos.backgroundJobs.findRecentByType.mockResolvedValue([
        recentJob({ status: 'FAILED' }),
        recentJob({ payload: { characterId: 'c1', dryRun: true } }),
        recentJob({ payload: { characterId: 'other' } }),
        recentJob({ updatedAt: new Date(NOW - WATERMARK_RUN_THROTTLE_MS - 1).toISOString() }),
        recentJob({ updatedAt: undefined }),
        recentJob({ payload: undefined }),
      ])
      expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual(['c1'])
    })
  })

  it('skips a missing or archived character', async () => {
    repos.characters.findByIdRaw.mockResolvedValueOnce(null)
    expect(await maybeEnqueueConsolidationForCharacters(['c1'], NOW)).toEqual([])
    repos.characters.findByIdRaw.mockResolvedValueOnce({ id: 'c2', userId: 'u', archivedAt: '2026-01-01' })
    expect(await maybeEnqueueConsolidationForCharacters(['c2'], NOW)).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('never throws: swallows repository failures and returns what it had enqueued', async () => {
    repos.memories.countUnconsideredHot.mockResolvedValueOnce(50).mockRejectedValueOnce(new Error('db gone'))
    await expect(maybeEnqueueConsolidationForCharacters(['c1', 'c2'], NOW)).resolves.toEqual(['c1'])
  })

  it('swallows a settings failure', async () => {
    settingsMock.mockRejectedValue(new Error('x'))
    await expect(maybeEnqueueConsolidationForCharacters(['c1'], NOW)).resolves.toEqual([])
  })
})

describe('maybeEnqueueConsolidationAfterCommit', () => {
  const writes = [{ method: 'memories.create', args: [{ characterId: 'c1' }] }]

  it('never re-triggers on consolidation jobs', async () => {
    await maybeEnqueueConsolidationAfterCommit('MEMORY_CONSOLIDATION', writes)
    expect(settingsMock).not.toHaveBeenCalled()
  })

  it('does nothing when the batch wrote no memories', async () => {
    await maybeEnqueueConsolidationAfterCommit('MEMORY_EXTRACTION', [{ method: 'chats.update', args: [] }])
    expect(settingsMock).not.toHaveBeenCalled()
  })

  it('runs the watermark check for characters in the batch', async () => {
    await maybeEnqueueConsolidationAfterCommit('MEMORY_EXTRACTION', writes)
    expect(enqueue).toHaveBeenCalledWith('u1', { characterId: 'c1', trigger: 'watermark' })
  })

  it('also runs when the job type is undefined', async () => {
    await maybeEnqueueConsolidationAfterCommit(undefined, writes)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})

describe('runScheduledConsolidation', () => {
  it('does nothing when disabled', async () => {
    settingsMock.mockResolvedValue({ enabled: false })
    expect(await runScheduledConsolidation()).toEqual({ charactersEnqueued: 0, charactersScanned: 0 })
    expect(repos.memories.findDistinctCharacterIds).not.toHaveBeenCalled()
  })

  it('enqueues only live characters with at least two unconsidered rows, tolerating per-character errors', async () => {
    repos.memories.findDistinctCharacterIds.mockResolvedValue(['gone', 'archived', 'few', 'ok', 'boom', 'ok2'])
    repos.characters.findByIdRaw.mockImplementation(async (id: string) => {
      if (id === 'gone') return null
      if (id === 'archived') return { id, userId: 'u', archivedAt: 'x' }
      if (id === 'boom') throw new Error('vault broken')
      return { id, userId: `user-${id}`, archivedAt: null }
    })
    repos.memories.countUnconsideredHot.mockImplementation(async (id: string) => (id === 'few' ? 1 : 2))

    const result = await runScheduledConsolidation()
    expect(result).toEqual({ charactersEnqueued: 2, charactersScanned: 6 })
    expect(enqueue).toHaveBeenCalledWith('user-ok', { characterId: 'ok', trigger: 'scheduled' })
    expect(enqueue).toHaveBeenCalledWith('user-ok2', { characterId: 'ok2', trigger: 'scheduled' })
  })

  it('counts an enqueue failure as scanned but not enqueued', async () => {
    repos.memories.findDistinctCharacterIds.mockResolvedValue(['c1'])
    enqueue.mockRejectedValue(new Error('queue down'))
    expect(await runScheduledConsolidation()).toEqual({ charactersEnqueued: 0, charactersScanned: 1 })
  })
})
