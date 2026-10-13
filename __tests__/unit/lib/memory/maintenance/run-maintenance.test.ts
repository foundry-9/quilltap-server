/**
 * `runMaintenance` (memory refactor §3.9, Phase F):
 *  - phase order and skipping (settings, reason, explicit phases);
 *  - the cap measures demotable rows only, demotes exactly `demotable − cap`,
 *    lowest protection first;
 *  - demoted rows re-enter consolidation;
 *  - retirement by `supersededAt`;
 *  - the mirror waits for the commit in the job child;
 *  - a dry run plans exactly what a live run does, and writes nothing.
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
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { setTier: jest.fn(async (_c: string, ids: string[]) => ids.length) },
}))
jest.mock('@/lib/memory/retire', () => ({
  retireMemories: jest.fn(async (ids: string[]) => ({ retired: ids.length, retiredIds: ids })),
}))
jest.mock('@/lib/memory/commonplace-mirror', () => ({ mirrorCommonplaceForSubjects: jest.fn(async () => 1) }))
jest.mock('@/lib/memory/recall/archive', () => ({ invalidateFrozenArchive: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/memory/maintenance/ledger', () => ({ recordMaintenanceOutcome: jest.fn() }))
jest.mock('@/lib/memory/maintenance/consolidate', () => ({
  ...jest.requireActual('@/lib/memory/maintenance/consolidate'),
  runConsolidatePhase: jest.fn(),
}))
jest.mock('@/lib/memory/maintenance/fold-near-duplicates', () => ({
  ...jest.requireActual('@/lib/memory/maintenance/fold-near-duplicates'),
  foldNearDuplicateGroups: jest.fn(),
}))

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { resolveMemorySettings } from '@/lib/memory/settings'
import { memoryIndex } from '@/lib/memory/index-store'
import { retireMemories } from '@/lib/memory/retire'
import { mirrorCommonplaceForSubjects } from '@/lib/memory/commonplace-mirror'
import { invalidateFrozenArchive } from '@/lib/memory/recall/archive'
import { recordMaintenanceOutcome } from '@/lib/memory/maintenance/ledger'
import { runConsolidatePhase, bucketCandidates } from '@/lib/memory/maintenance/consolidate'
import { foldNearDuplicateGroups, planNearDuplicateFolds, FOLD_MAX_BUCKET_ROWS } from '@/lib/memory/maintenance/fold-near-duplicates'
import { runMaintenance, resolvePhases } from '@/lib/memory/maintenance/run'
import { planDemotion } from '@/lib/memory/maintenance/demote'
import { protection } from '@/lib/memory/scoring'
import { MAINTENANCE_PHASES } from '@/lib/memory/maintenance/types'

const HOLDER = 'holder-1'
const NOW = new Date('2026-10-13T12:00:00.000Z')
const DAY = 86_400_000

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY).toISOString()
}

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: HOLDER,
    aboutCharacterId: HOLDER,
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    reinforcementCount: 1,
    source: 'AUTO',
    tier: 'hot',
    kind: 'semantic',
    entities: [],
    relatedMemoryIds: [],
    supersededById: null,
    supersededAt: null,
    consolidatedFrom: [],
    consolidatedAt: null,
    embedding: null,
    createdAt: iso(60),
    updatedAt: iso(60),
    ...overrides,
  } as Memory
}

interface Settings {
  enabled?: boolean
  consolidationEnabled?: boolean
  cap?: number
  coldRetentionDays?: number | null
  phases?: { foldNearDuplicates: boolean; demote: boolean; retire: boolean }
}

function settings(s: Settings = {}) {
  const consolidation = {
    enabled: s.consolidationEnabled ?? false,
    connectionProfileId: null,
    clusterThreshold: 0.72,
    minClusterSize: 3,
    maxClusterSize: 30,
    matureAfterDays: 7,
    maxClustersPerRun: 40,
    watermark: 150,
    coldRetentionDays: s.coldRetentionDays ?? null,
  }
  return {
    admission: { nearDuplicate: 0.9, reinforce: 0.85, related: 0.7, dateGuardDays: 7, footnoteCap: 8 },
    maintenance: {
      enabled: s.enabled ?? true,
      perCharacterCap: s.cap ?? 3,
      perCharacterCapOverrides: {},
      phases: s.phases ?? { foldNearDuplicates: true, demote: true, retire: true },
      capFor: () => s.cap ?? 3,
      consolidation,
      coldRetentionDays: consolidation.coldRetentionDays,
    },
  }
}

let corpus: Memory[]

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  corpus = []
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findByIdRaw: jest.fn(async () => ({ id: HOLDER, name: 'Friday', userId: 'user-1', archivedAt: null })),
      findById: jest.fn(async () => ({ id: HOLDER, name: 'Friday', userId: 'user-1' })),
    },
    memories: {
      findByCharacterIdInBatches: jest.fn(async function* () {
        yield corpus
      }),
    },
  } as never)
  jest.mocked(resolveMemorySettings).mockResolvedValue(settings() as never)
  jest.mocked(runConsolidatePhase).mockResolvedValue({
    report: { stats: { digestsCreated: 0, digestsUpdated: 0, membersSuperseded: 0, rowsMarkedConsidered: 0 } },
    plan: {},
    belowMinConsidered: [],
    touchedSubjects: [],
  } as never)
})

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('phase order and skipping', () => {
  it('always reports the five phases in order', async () => {
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual' }, { now: NOW })
    expect(report.phases.map((p) => p.phase)).toEqual([...MAINTENANCE_PHASES])
  })

  it('an automatic run obeys the enabled switches; a manual one does not', () => {
    const off = settings({ enabled: false, consolidationEnabled: false, coldRetentionDays: 30 })
    const auto = resolvePhases({ reason: 'scheduled' }, off as never)
    expect(auto.get('fold-near-duplicates')).toBe('maintenance-disabled')
    expect(auto.get('consolidate')).toBe('consolidation-disabled')
    expect(auto.get('demote')).toBe('maintenance-disabled')
    expect(auto.get('retire')).toBe('maintenance-disabled')
    expect(auto.get('mirror')).toBeNull()

    const manual = resolvePhases({ reason: 'manual' }, off as never)
    expect([...manual.values()]).toEqual([null, null, null, null, null])
  })

  it('per-phase toggles govern automatic runs, named phases included; a hand-asked phase overrides them', () => {
    const s = settings({ phases: { foldNearDuplicates: false, demote: false, retire: true } })
    expect(resolvePhases({ reason: 'scheduled' }, s as never).get('fold-near-duplicates')).toBe('phase-disabled')
    // A watermark run always names its phases; the toggles still apply (PR 97 review).
    const watermark = resolvePhases({ reason: 'watermark', phases: ['fold-near-duplicates', 'demote', 'retire'] }, s as never)
    expect(watermark.get('fold-near-duplicates')).toBe('phase-disabled')
    expect(watermark.get('demote')).toBe('phase-disabled')
    expect(resolvePhases({ reason: 'manual', phases: ['fold-near-duplicates'] }, s as never).get('fold-near-duplicates')).toBeNull()
  })

  it('a merged job exempts only the phases asked for by hand', () => {
    const off = settings({ enabled: false, consolidationEnabled: false, coldRetentionDays: 30 })
    const plan = resolvePhases({ reason: 'manual', exemptPhases: ['demote'] }, off as never)
    expect(plan.get('demote')).toBeNull()
    expect(plan.get('consolidate')).toBe('consolidation-disabled')
    expect(plan.get('fold-near-duplicates')).toBe('maintenance-disabled')
    expect(plan.get('retire')).toBe('maintenance-disabled')
  })

  it('retire needs a retention window; unrequested phases say so', () => {
    const plan = resolvePhases({ reason: 'manual', phases: ['demote'] }, settings({ coldRetentionDays: null }) as never)
    expect(plan.get('demote')).toBeNull()
    expect(plan.get('retire')).toBe('not-requested')
    const unscoped = resolvePhases({ reason: 'manual' }, settings({ coldRetentionDays: null }) as never)
    expect(unscoped.get('retire')).toBe('no-retention-window')
  })

  it('the mirror reports nothing-touched when consolidation changed no bucket', async () => {
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual' }, { now: NOW })
    expect(report.phases.find((p) => p.phase === 'mirror')).toMatchObject({ status: 'skipped', skippedBecause: 'nothing-touched' })
    expect(mirrorCommonplaceForSubjects).not.toHaveBeenCalled()
  })

  it('leaves an archived character alone', async () => {
    jest.mocked(getRepositories().characters.findByIdRaw).mockResolvedValue({ id: HOLDER, name: 'Friday', archivedAt: '2026-01-01' } as never)
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual' }, { now: NOW })
    expect(report.skippedReason).toBe('archived')
    expect(report.phases.every((p) => p.status === 'skipped')).toBe(true)
    expect(getRepositories().memories.findByCharacterIdInBatches).not.toHaveBeenCalled()
  })
})

describe('demote: the cap measures demotable rows only (bug 210, decision 3)', () => {
  function overCap(): Memory[] {
    return [
      // Five hot AUTO rows of rising protection.
      mem('weak', { importance: 0.1, reinforcedImportance: 0.1, createdAt: iso(300) }),
      mem('soft', { importance: 0.3, reinforcedImportance: 0.3, createdAt: iso(200) }),
      mem('mid', { importance: 0.5, reinforcedImportance: 0.5, createdAt: iso(100) }),
      mem('firm', { importance: 0.8, reinforcedImportance: 0.8, reinforcementCount: 6, createdAt: iso(10) }),
      mem('strong', { importance: 0.9, reinforcedImportance: 0.9, reinforcementCount: 12, relatedMemoryIds: ['a', 'b', 'c'], createdAt: iso(5) }),
      // Never counted, never demoted.
      mem('manual-1', { source: 'MANUAL', importance: 0.1 }),
      mem('manual-2', { source: 'MANUAL', importance: 0.1 }),
      mem('digest', { source: 'CONSOLIDATED', importance: 0.1 }),
      mem('already-cold', { tier: 'cold' }),
    ]
  }

  it('demotes exactly demotable − cap, lowest protection first', async () => {
    corpus = overCap()
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['demote'] }, { now: NOW })

    expect(report.demote).toMatchObject({ cap: 3, hotTotal: 8, demotable: 5, protected: 3, excess: 2, demoted: 2 })
    const expected = corpus
      .filter((m) => m.source === 'AUTO' && m.tier === 'hot')
      .sort((a, b) => protection(a, { nowMs: NOW.getTime() }).score - protection(b, { nowMs: NOW.getTime() }).score)
      .slice(0, 2)
      .map((m) => m.id)
    expect(report.demote!.demotedIds).toEqual(expected)
    expect(expected).toEqual(['weak', 'soft'])
    expect(memoryIndex.setTier).toHaveBeenCalledWith(HOLDER, ['weak', 'soft'], 'cold')
  })

  it('does nothing when the demotable rows fit, however many protected rows there are', () => {
    const rows = [mem('a'), mem('b'), ...Array.from({ length: 50 }, (_, i) => mem(`m${i}`, { source: 'MANUAL' }))]
    const plan = planDemotion(rows, 3, NOW.getTime())
    expect(plan).toMatchObject({ demotable: 2, protected: 50, excess: 0, demoted: 0 })
  })

  it('a demoted row re-enters consolidation as a candidate (bug 211)', async () => {
    corpus = overCap()
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['demote'] }, { now: NOW })
    const after = corpus.map((m) => (report.demote!.demotedIds.includes(m.id) ? { ...m, tier: 'cold' as const } : m))
      .map((m) => ({ ...m, embedding: new Float32Array([1, 0]) }))
    const { stats, buckets } = bucketCandidates(after, HOLDER, NOW.getTime() - 7 * DAY)
    expect(stats.demotedCandidates).toBe(3) // weak, soft, and the row that was already cold
    expect(buckets.get('self')!.rows.map((m) => m.id)).toEqual(expect.arrayContaining(['weak', 'soft']))
    // A superseded cold row stays with its digest.
    const superseded = bucketCandidates([mem('s', { tier: 'cold', supersededById: 'd', embedding: new Float32Array([1, 0]) })], HOLDER, NOW.getTime())
    expect(superseded.stats.candidates).toBe(0)
  })
})

describe('retire: by supersededAt, AUTO only (bug 225)', () => {
  it('retires superseded cold AUTO rows past the window and keeps the rest', async () => {
    jest.mocked(resolveMemorySettings).mockResolvedValue(settings({ coldRetentionDays: 30 }) as never)
    corpus = [
      mem('expired', { tier: 'cold', supersededById: 'd', supersededAt: iso(40), updatedAt: iso(1) }),
      mem('recent', { tier: 'cold', supersededById: 'd', supersededAt: iso(10) }),
      mem('demoted', { tier: 'cold', supersededById: null, updatedAt: iso(400) }),
      mem('manual', { tier: 'cold', source: 'MANUAL', supersededById: 'd', supersededAt: iso(400) }),
    ]
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['retire'] }, { now: NOW })
    expect(retireMemories).toHaveBeenCalledWith(['expired'], { reason: 'retention' })
    expect(report.retire).toEqual({ retentionDays: 30, retired: 1, retiredIds: ['expired'] })
  })
})

describe('fold-near-duplicates', () => {
  const v = new Float32Array([1, 0, 0])
  function dupes(): Memory[] {
    return [
      mem('keep', { embedding: v, importance: 0.9, reinforcedImportance: 0.9 }),
      mem('dup', { embedding: v }),
      mem('manual-dup', { embedding: v, source: 'MANUAL' }),
      mem('other-occasion', { embedding: v, occurredAt: iso(30) }),
      mem('other-subject', { embedding: v, aboutCharacterId: 'someone-else' }),
    ].map((m) => (m.id === 'other-occasion' ? m : { ...m, occurredAt: iso(1) }))
  }

  it('folds only same-subject, same-occasion AUTO rows; the fold runs in the parent, then the corpus follows', async () => {
    corpus = dupes()
    jest.mocked(foldNearDuplicateGroups).mockResolvedValue({
      survivors: [{ ...corpus[0], reinforcementCount: 2 }],
      retiredIds: ['dup'],
      groupsFailed: 0,
    })
    const report = await runMaintenance(
      { characterId: HOLDER, reason: 'manual', phases: ['fold-near-duplicates', 'demote'], settings: { cap: 100 } },
      { now: NOW },
    )
    expect(report.fold!.groups).toEqual([{ survivorId: 'keep', absorbedIds: ['dup'], minCosine: expect.any(Number) }])
    expect(report.fold!.folded).toBe(1)
    expect(foldNearDuplicateGroups).toHaveBeenCalledWith({ characterId: HOLDER, groups: report.fold!.groups, userId: 'user-1' })
    // The demotion that follows sees the corpus without the folded row.
    expect(report.demote!.demotable).toBe(3)
  })
})

describe('fold-near-duplicates: the profile\'s scale', () => {
  // cos ≈ 0.85: under the neural near-duplicate bar (0.90), over the TF-IDF one (0.80).
  const a = new Float32Array([1, 0])
  const b = new Float32Array([0.85, Math.sqrt(1 - 0.85 * 0.85)])

  it('folds at the TF-IDF threshold when the default profile is Built-in, not otherwise', async () => {
    const run = async (provider: string) => {
      corpus = [mem('x', { embedding: a, importance: 0.9 }), mem('y', { embedding: b })]
      ;(getRepositories() as unknown as { embeddingProfiles: unknown }).embeddingProfiles = {
        findDefault: jest.fn(async () => ({ provider })),
      }
      return runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['fold-near-duplicates'], dryRun: true }, { now: NOW })
    }
    expect((await run('OPENAI')).fold!.groups).toEqual([])
    expect((await run('BUILTIN')).fold!.groups).toHaveLength(1)
  })
})

describe('fold-near-duplicates: the comparison is bounded per bucket', () => {
  it('compares the newest rows of an oversized bucket and defers the rest', async () => {
    const v = new Float32Array([1, 0, 0])
    const rows = Array.from({ length: FOLD_MAX_BUCKET_ROWS + 5 }, (_, i) =>
      mem(`r${i}`, { embedding: v, createdAt: new Date(NOW.getTime() - i * 60_000).toISOString() }),
    )
    const plan = await planNearDuplicateFolds(rows, { nearDuplicate: 0.9, dateGuardDays: 7 }, NOW.getTime())
    expect(plan.deferred).toBe(5)
    const touched = new Set(plan.groups.flatMap((g) => [g.survivorId, ...g.absorbedIds]))
    expect(touched.size).toBe(FOLD_MAX_BUCKET_ROWS)
    expect(touched.has(`r${FOLD_MAX_BUCKET_ROWS + 4}`)).toBe(false)
  })
})

describe('dry run equals live (invariant 10)', () => {
  it('plans the same phases and counts, and writes nothing', async () => {
    jest.mocked(resolveMemorySettings).mockResolvedValue(settings({ coldRetentionDays: 30 }) as never)
    const v = new Float32Array([1, 0, 0])
    const base = [
      mem('keep', { embedding: v, importance: 0.9, reinforcedImportance: 0.9 }),
      mem('dup', { embedding: v }),
      mem('weak', { importance: 0.1, createdAt: iso(300), embedding: new Float32Array([0, 1, 0]) }),
      mem('soft', { importance: 0.2, createdAt: iso(250), embedding: new Float32Array([0, 0, 1]) }),
      mem('mid', { importance: 0.4, createdAt: iso(200), embedding: new Float32Array([0.6, 0.8, 0]) }),
      mem('old-member', { tier: 'cold', supersededById: 'd', supersededAt: iso(90) }),
    ]
    jest.mocked(foldNearDuplicateGroups).mockImplementation(async (req) => ({
      survivors: [base.find((m) => m.id === req.groups[0].survivorId)!],
      retiredIds: req.groups.flatMap((g) => g.absorbedIds),
      groupsFailed: 0,
    }))

    corpus = base.map((m) => ({ ...m }))
    const dry = await runMaintenance({ characterId: HOLDER, reason: 'manual', dryRun: true }, { now: NOW })
    expect(memoryIndex.setTier).not.toHaveBeenCalled()
    expect(retireMemories).not.toHaveBeenCalled()
    expect(foldNearDuplicateGroups).not.toHaveBeenCalled()
    expect(invalidateFrozenArchive).not.toHaveBeenCalled()
    expect(recordMaintenanceOutcome).not.toHaveBeenCalled()

    corpus = base.map((m) => ({ ...m }))
    const live = await runMaintenance({ characterId: HOLDER, reason: 'manual' }, { now: NOW })

    expect(live.fold!.groups).toEqual(dry.fold!.groups)
    expect(live.fold!.folded).toBe(dry.fold!.folded)
    expect(live.demote).toEqual(dry.demote)
    expect(live.retire).toEqual(dry.retire)
    expect(live.phases.map((p) => [p.phase, p.status])).toEqual(dry.phases.map((p) => [p.phase, p.status]))
    // The live run in the parent announces itself once its writes have landed.
    expect(invalidateFrozenArchive).toHaveBeenCalledWith(HOLDER)
    expect(recordMaintenanceOutcome).toHaveBeenCalledTimes(1)
  })
})

describe('mirror after commit (bug 208)', () => {
  beforeEach(() => {
    jest.mocked(runConsolidatePhase).mockResolvedValue({
      report: { stats: { digestsCreated: 1, digestsUpdated: 0, membersSuperseded: 2, rowsMarkedConsidered: 0 } },
      plan: {},
      belowMinConsidered: [],
      touchedSubjects: ['laura'],
    } as never)
  })

  it('in the parent the mirror is written once the writes have landed', async () => {
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['consolidate', 'mirror'] }, { now: NOW })
    expect(mirrorCommonplaceForSubjects).toHaveBeenCalledWith(HOLDER, ['laura'], NOW.toISOString())
    expect(report.mirror).toEqual({ subjects: ['laura'], filesWritten: 1, deferredToCommit: false })
  })

  it('in the job child the run writes no vault file and announces nothing', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    const report = await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['consolidate', 'mirror'] }, { now: NOW })
    expect(mirrorCommonplaceForSubjects).not.toHaveBeenCalled()
    expect(report.mirror).toEqual({ subjects: ['laura'], filesWritten: 0, deferredToCommit: true })
    expect(invalidateFrozenArchive).not.toHaveBeenCalled()
    expect(recordMaintenanceOutcome).not.toHaveBeenCalled()
  })

  it('a dry run writes no vault file', async () => {
    await runMaintenance({ characterId: HOLDER, reason: 'manual', phases: ['consolidate', 'mirror'], dryRun: true }, { now: NOW })
    expect(mirrorCommonplaceForSubjects).not.toHaveBeenCalled()
  })
})
