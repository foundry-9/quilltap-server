/**
 * The parent-side maintenance ledger and its triggers (memory refactor §3.9):
 *  - `shouldEnqueue` — the one trigger question: cap watermark (90%), the
 *    15-minute demotion throttle, the hour's backoff after an ineffective
 *    demotion, the consolidation watermark and its six-hour throttle;
 *  - the ledger seeds from recent job rows, so a restart does not forget;
 *  - `maybeEnqueueMaintenance` measures, asks, and enqueues once per
 *    character per debounce;
 *  - the scheduler enqueues one job per live character holding memories, and
 *    skips its startup tick after a recent scheduled run;
 *  - the handler hands its summary back and fails, writing nothing, under the
 *    test flag.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/settings', () => ({ resolveMemorySettings: jest.fn() }))
const mockEnqueue = jest.fn(async () => 'job-new')
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueMemoryMaintenance: (...args: unknown[]) => mockEnqueue(...(args as [])),
}))
jest.mock('@/lib/memory/maintenance/run', () => ({
  runMaintenance: jest.fn(),
  summarizeMaintenance: jest.fn((r: unknown) => ({ summarized: r, phases: [] })),
}))
jest.mock('@/lib/background-jobs/child/child-repositories-proxy', () => ({ setJobResult: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { resolveMemorySettings } from '@/lib/memory/settings'
import {
  shouldEnqueue,
  recordMaintenanceOutcome,
  resetMaintenanceLedgerForTests,
  getMaintenanceLedgerStatus,
  DEMOTE_THROTTLE_MS,
  INEFFECTIVE_BACKOFF_MS,
  CONSOLIDATE_THROTTLE_MS,
  WATERMARK_CHECK_DEBOUNCE_MS,
  type WatermarkReading,
} from '@/lib/memory/maintenance/ledger'
import { maybeEnqueueMaintenance, maybeEnqueueMaintenanceAfterCommit } from '@/lib/memory/maintenance/triggers'
import { runScheduledMemoryMaintenance, runStartupTick } from '@/lib/memory/maintenance/scheduler'
import { runMaintenance } from '@/lib/memory/maintenance/run'
import { setJobResult } from '@/lib/background-jobs/child/child-repositories-proxy'
import { handleMemoryMaintenance, MAINTENANCE_FAIL_AFTER_PLAN_ENV } from '@/lib/background-jobs/handlers/memory-maintenance'
import type { MaintenanceSummary } from '@/lib/memory/maintenance/types'

const T0 = Date.parse('2026-10-13T12:00:00.000Z')

let recentJobs: unknown[]
let repos: any

function reading(overrides: Partial<WatermarkReading> = {}): WatermarkReading {
  return {
    demotable: 1900,
    cap: 2000,
    unconsidered: 10,
    consolidationWatermark: 150,
    maintenanceEnabled: true,
    consolidationEnabled: true,
    ...overrides,
  }
}

function summary(overrides: Partial<MaintenanceSummary> = {}): MaintenanceSummary {
  return {
    characterId: 'char-a',
    reason: 'watermark',
    dryRun: false,
    finishedAt: new Date(T0).toISOString(),
    durationMs: 10,
    phases: [
      { phase: 'fold-near-duplicates', status: 'ran', durationMs: 1 },
      { phase: 'consolidate', status: 'skipped', skippedBecause: 'not-requested', durationMs: 0 },
      { phase: 'demote', status: 'ran', durationMs: 1 },
      { phase: 'retire', status: 'ran', durationMs: 1 },
      { phase: 'mirror', status: 'skipped', skippedBecause: 'not-requested', durationMs: 0 },
    ],
    demote: { cap: 2000, hotTotal: 2100, demotable: 2100, protected: 0, excess: 100, demoted: 100, highestScoreDemoted: 0.2 },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMaintenanceLedgerForTests()
  recentJobs = []
  repos = {
    backgroundJobs: { findRecentByType: jest.fn(async () => recentJobs) },
    memories: {
      countCapBreakdown: jest.fn(async () => ({ hotTotal: 1900, demotable: 1900, protected: 0, cold: 0 })),
      countUnconsideredHot: jest.fn(async () => 10),
      findDistinctCharacterIds: jest.fn(async () => ['char-a', 'char-gone', 'char-b']),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) =>
        id === 'char-gone' ? { id, userId: 'user-1', archivedAt: '2026-01-01' } : { id, userId: 'user-1', archivedAt: null },
      ),
    },
  }
  jest.mocked(getRepositories).mockReturnValue(repos)
  jest.mocked(resolveMemorySettings).mockResolvedValue({
    maintenance: {
      enabled: true,
      capFor: () => 2000,
      consolidation: { enabled: true, watermark: 150 },
    },
  } as never)
})

describe('shouldEnqueue', () => {
  it('scheduled and manual runs are always due, for every phase', async () => {
    expect(await shouldEnqueue('char-a', 'scheduled')).toHaveLength(5)
    expect(await shouldEnqueue('char-a', 'manual')).toHaveLength(5)
  })

  it('the cap watermark trips at 90% and asks for fold → demote → retire', async () => {
    expect(await shouldEnqueue('char-a', 'watermark', reading({ demotable: 1799 }), T0)).toBeNull()
    expect(await shouldEnqueue('char-a', 'watermark', reading({ demotable: 1800 }), T0)).toEqual([
      'fold-near-duplicates',
      'demote',
      'retire',
    ])
  })

  it('a recent demotion throttles the cap watermark for 15 minutes', async () => {
    recordMaintenanceOutcome(summary())
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + DEMOTE_THROTTLE_MS - 1)).toBeNull()
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + DEMOTE_THROTTLE_MS)).not.toBeNull()
  })

  it('an ineffective demotion backs the cap watermark off for an hour', async () => {
    // Twelve thousand over, five moved: practically a no-op.
    recordMaintenanceOutcome(summary({ demote: { cap: 5000, hotTotal: 17000, demotable: 17000, protected: 0, excess: 12000, demoted: 5, highestScoreDemoted: 0.6 } }))
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + DEMOTE_THROTTLE_MS + 1)).toBeNull()
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + INEFFECTIVE_BACKOFF_MS)).not.toBeNull()
    const [status] = await getMaintenanceLedgerStatus('char-a')
    expect(status.lastDemotion).toMatchObject({ demoted: 5, excess: 12000, effective: false })
  })

  it('the consolidation watermark asks for consolidate and mirror, at most every six hours', async () => {
    const r = reading({ demotable: 0, unconsidered: 151 })
    expect(await shouldEnqueue('char-a', 'watermark', r, T0)).toEqual(['consolidate', 'mirror'])
    recordMaintenanceOutcome(summary({
      phases: [{ phase: 'consolidate', status: 'ran', durationMs: 1 }],
      demote: undefined,
    }))
    expect(await shouldEnqueue('char-a', 'watermark', r, T0 + CONSOLIDATE_THROTTLE_MS - 1)).toBeNull()
    expect(await shouldEnqueue('char-a', 'watermark', r, T0 + CONSOLIDATE_THROTTLE_MS)).toEqual(['consolidate', 'mirror'])
  })

  it('disabled switches never trip their watermark', async () => {
    const r = reading({ demotable: 5000, unconsidered: 5000, maintenanceEnabled: false, consolidationEnabled: false })
    expect(await shouldEnqueue('char-a', 'watermark', r, T0)).toBeNull()
  })

  it('a dry run records nothing', async () => {
    recordMaintenanceOutcome(summary({ dryRun: true }))
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + 1)).not.toBeNull()
  })

  it('seeds from recent job rows, so a restart does not forget a run', async () => {
    recentJobs = [
      {
        status: 'COMPLETED',
        updatedAt: new Date(T0).toISOString(),
        payload: { characterId: 'char-a', reason: 'watermark', phases: ['fold-near-duplicates', 'demote', 'retire'] },
      },
    ]
    expect(await shouldEnqueue('char-a', 'watermark', reading(), T0 + 60_000)).toBeNull()
    expect(repos.backgroundJobs.findRecentByType).toHaveBeenCalledWith('MEMORY_MAINTENANCE', 100)
  })
})

describe('maybeEnqueueMaintenance', () => {
  it('measures, enqueues the due phases, and holds the debounce', async () => {
    const enqueued = await maybeEnqueueMaintenance(['char-a'], T0)
    expect(enqueued).toEqual(['char-a'])
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', {
      characterId: 'char-a',
      reason: 'watermark',
      phases: ['fold-near-duplicates', 'demote', 'retire'],
    })
    // Inside the debounce nothing is even measured.
    await maybeEnqueueMaintenance(['char-a'], T0 + WATERMARK_CHECK_DEBOUNCE_MS - 1)
    expect(repos.memories.countCapBreakdown).toHaveBeenCalledTimes(1)
    // Past it, the enqueue itself throttles the demotion.
    await maybeEnqueueMaintenance(['char-a'], T0 + WATERMARK_CHECK_DEBOUNCE_MS)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('does nothing when both switches are off', async () => {
    jest.mocked(resolveMemorySettings).mockResolvedValue({
      maintenance: { enabled: false, capFor: () => 2000, consolidation: { enabled: false, watermark: 150 } },
    } as never)
    expect(await maybeEnqueueMaintenance(['char-a'], T0)).toEqual([])
    expect(repos.memories.countCapBreakdown).not.toHaveBeenCalled()
  })

  it('the commit hook looks at created memories, never at a maintenance job\'s own batch', async () => {
    const writes = [{ method: 'memories.create', args: [{ characterId: 'char-a' }] }]
    await maybeEnqueueMaintenanceAfterCommit('MEMORY_MAINTENANCE', writes)
    expect(repos.memories.countCapBreakdown).not.toHaveBeenCalled()
    await maybeEnqueueMaintenanceAfterCommit('MEMORY_EXTRACTION', writes)
    expect(repos.memories.countCapBreakdown).toHaveBeenCalledWith('char-a')
  })
})

describe('scheduler', () => {
  it('enqueues one scheduled job per live character holding memories', async () => {
    const result = await runScheduledMemoryMaintenance()
    expect(result).toEqual({ charactersScanned: 3, jobsEnqueued: 2 })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { characterId: 'char-a', reason: 'scheduled' })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { characterId: 'char-b', reason: 'scheduled' })
  })

  it('skips the startup tick when a scheduled run completed within 20 hours', async () => {
    recentJobs = [{ id: 'j', status: 'COMPLETED', updatedAt: new Date(T0 - 3_600_000).toISOString(), payload: { reason: 'scheduled' } }]
    await runStartupTick(T0)
    expect(mockEnqueue).not.toHaveBeenCalled()
    recentJobs = [{ id: 'j', status: 'COMPLETED', updatedAt: new Date(T0 - 21 * 3_600_000).toISOString(), payload: { reason: 'scheduled' } }]
    await runStartupTick(T0)
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
  })
})

describe('MEMORY_MAINTENANCE handler', () => {
  const job = { id: 'job-1', userId: 'user-1', payload: { characterId: 'char-a', reason: 'watermark', phases: ['demote'] } } as never

  afterEach(() => {
    delete process.env[MAINTENANCE_FAIL_AFTER_PLAN_ENV]
  })

  it('runs the requested phases and hands the summary back to the parent', async () => {
    jest.mocked(runMaintenance).mockResolvedValue({ characterId: 'char-a' } as never)
    await handleMemoryMaintenance(job)
    expect(runMaintenance).toHaveBeenCalledWith(
      { characterId: 'char-a', reason: 'watermark', phases: ['demote'] },
      { userId: 'user-1', timeBudgetMs: 7 * 60 * 1000 },
    )
    expect(setJobResult).toHaveBeenCalledWith({ summarized: { characterId: 'char-a' }, phases: [] })
  })

  it('fails after planning under the test flag, so its batch never commits', async () => {
    process.env[MAINTENANCE_FAIL_AFTER_PLAN_ENV] = '1'
    jest.mocked(runMaintenance).mockResolvedValue({ characterId: 'char-a' } as never)
    await expect(handleMemoryMaintenance(job)).rejects.toThrow('test flag')
    expect(setJobResult).not.toHaveBeenCalled()
  })
})
