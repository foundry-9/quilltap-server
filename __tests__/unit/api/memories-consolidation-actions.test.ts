/**
 * /api/v1/memories — consolidation surfaces:
 *  - POST ?action=consolidate (dry run runs in-process and returns the report;
 *    a real run enqueues a job; input is validated; the dry run is bounded)
 *  - GET/POST ?action=consolidation-config and ?action=extraction-mode-config
 *  - GET list honours ?tier= and ?source=CONSOLIDATED
 *  - a real consolidate carries clusterThreshold into the job (bug 223)
 *  - GET ?action=character-memory-counts reports the cap breakdown (bug 210)
 *  - POST ?action=housekeep-sweep fans out per character (bug 221)
 *  - POST ?action=maintain (dry run in-process; real runs enqueue per character)
 *  - GET ?action=maintenance-status reads the parent's ledger
 *
 * Since Phase F every one of these runs through `runMaintenance` / the one
 * MEMORY_MAINTENANCE job.
 */

let mockCtx: any
let mockAction: string | null = null

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => async (req: any) => handler(req, mockCtx),
  dispatchAction: (_req: unknown, handlers: Record<string, () => Promise<unknown>>, fallback?: () => Promise<unknown>) => {
    if (mockAction === null) return fallback ? fallback() : { status: 400 }
    const h = handlers[mockAction]
    return h ? h() : { status: 400 }
  },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ status: 404, body: { error: `${what} not found` } }),
  badRequest: (msg: string) => ({ status: 400, body: { error: msg } }),
  serverError: (msg: string) => ({ status: 500, body: { error: msg } }),
  validationError: (err: unknown) => ({ status: 400, body: { error: 'Validation error', err } }),
  successResponse: (data: any) => ({ status: 200, body: data }),
}))

const mockRunMaintenance = jest.fn()
const mockLedger = jest.fn()
jest.mock('@/lib/memory/maintenance', () => ({
  runMaintenance: (...args: unknown[]) => mockRunMaintenance(...args),
  getMaintenanceLedgerStatus: (...args: unknown[]) => mockLedger(...args),
  MAINTENANCE_PHASES: ['fold-near-duplicates', 'consolidate', 'demote', 'retire', 'mirror'],
}))

const mockEnqueue = jest.fn()
const mockSweep = jest.fn()
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueMemoryMaintenance: (...args: unknown[]) => mockEnqueue(...args),
  enqueueEmbeddingGenerate: jest.fn(),
  enqueueMemoryMaintenanceForUser: (...args: unknown[]) => mockSweep(...args),
  enqueueMemoryRegenerateAll: jest.fn(),
}))

let storedConsolidation: any
let storedMode: any
jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionConcurrency: jest.fn(),
  setMemoryExtractionConcurrency: jest.fn(),
  getMemoryExtractionLimits: jest.fn(),
  setMemoryExtractionLimits: jest.fn(),
  getMemoryRecallSettings: jest.fn(),
  setMemoryRecallSettings: jest.fn(),
  getMemoryConsolidationSettings: jest.fn(async () => storedConsolidation),
  setMemoryConsolidationSettings: jest.fn(async (patch: any) => { storedConsolidation = { ...storedConsolidation, ...patch } }),
  getMemoryExtractionModeSettings: jest.fn(async () => storedMode),
  setMemoryExtractionModeSettings: jest.fn(async (patch: any) => { storedMode = { ...storedMode, ...patch } }),
}))

jest.mock('@/lib/memory/recall/search', () => ({}))
jest.mock('@/lib/memory/index-store/backfill', () => ({}))
jest.mock('@/lib/memory/anchor-gate-probe', () => ({}))
jest.mock('@/lib/embedding/embedding-job-scheduler', () => ({}))
jest.mock('@/lib/embedding/embedding-service', () => ({}))
jest.mock('@/lib/background-jobs/processor', () => ({}))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({}))

import { GET, POST } from '@/app/api/v1/memories/route'

const CHAR_ID = '11111111-1111-4111-8111-111111111111'

function req(body?: unknown, search = ''): any {
  return {
    nextUrl: { searchParams: new URLSearchParams(search) },
    json: async () => body,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAction = null
  storedConsolidation = { enabled: false, connectionProfileId: null, clusterThreshold: 0.72, coldRetentionDays: null }
  storedMode = { otherPass: 'hybrid', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 }
  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      characters: { findById: jest.fn(async (id: string) => (id === CHAR_ID ? { id, name: 'Ariadne' } : null)) },
      memories: {
        findByCharacterIdPaginated: jest.fn(async () => ({ memories: [], totalCount: 0 })),
      },
      tags: { findAll: jest.fn(async () => []) },
    },
  }
})

describe('POST ?action=consolidate', () => {
  it('dry run runs in-process with a bounded cluster count and returns the report', async () => {
    mockAction = 'consolidate'
    mockRunMaintenance.mockResolvedValue({ consolidation: { clusters: [], dryRun: true } })
    const res: any = await POST(req({ characterId: CHAR_ID, dryRun: true, clusterThreshold: 0.8 }))
    expect(res.body).toEqual({ success: true, dryRun: true, report: { clusters: [], dryRun: true } })
    expect(mockEnqueue).not.toHaveBeenCalled()
    const [request, ctx] = mockRunMaintenance.mock.calls[0]
    expect(request).toEqual({
      characterId: CHAR_ID,
      reason: 'manual',
      dryRun: true,
      phases: ['consolidate'],
      settings: { maxClustersPerRun: 10, consolidation: { clusterThreshold: 0.8 } },
    })
    expect(ctx).toEqual({ userId: 'user-1', timeBudgetMs: 120000 })
  })

  it('caps a dry run at 40 clusters', async () => {
    mockAction = 'consolidate'
    mockRunMaintenance.mockResolvedValue({ consolidation: { clusters: [] } })
    await POST(req({ characterId: CHAR_ID, dryRun: true, maxClustersPerRun: 500 }))
    expect(mockRunMaintenance.mock.calls[0][0].settings.maxClustersPerRun).toBe(40)
  })

  it('a dry run that never reached the phase (archived character) is a 400, not a null report', async () => {
    mockAction = 'consolidate'
    mockRunMaintenance.mockResolvedValue({ skippedReason: 'archived' })
    const res: any = await POST(req({ characterId: CHAR_ID, dryRun: true }))
    expect(res.status).toBe(400)
  })

  it('a real run enqueues a job and returns its id', async () => {
    mockAction = 'consolidate'
    mockEnqueue.mockResolvedValue('job-9')
    const res: any = await POST(req({ characterId: CHAR_ID, maxClustersPerRun: 100 }))
    expect(res.body).toEqual({ success: true, dryRun: false, jobId: 'job-9' })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', {
      characterId: CHAR_ID,
      reason: 'manual',
      phases: ['consolidate', 'mirror'],
      settings: { maxClustersPerRun: 100 },
    })
    expect(mockRunMaintenance).not.toHaveBeenCalled()
  })

  it('bug 223: a real run carries the requested clusterThreshold into the job', async () => {
    mockAction = 'consolidate'
    mockEnqueue.mockResolvedValue('job-10')
    await POST(req({ characterId: CHAR_ID, clusterThreshold: 0.65 }))
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', {
      characterId: CHAR_ID,
      reason: 'manual',
      phases: ['consolidate', 'mirror'],
      settings: { consolidation: { clusterThreshold: 0.65 } },
    })
  })

  it('rejects a malformed body', async () => {
    mockAction = 'consolidate'
    const res: any = await POST(req({ characterId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    const res2: any = await POST(req({ characterId: CHAR_ID, clusterThreshold: 3 }))
    expect(res2.status).toBe(400)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockRunMaintenance).not.toHaveBeenCalled()
  })

  it('404s an unknown character', async () => {
    mockAction = 'consolidate'
    const res: any = await POST(req({ characterId: '22222222-2222-4222-8222-222222222222' }))
    expect(res.status).toBe(404)
  })
})

describe('consolidation / extraction-mode settings round-trip', () => {
  it('writes a partial patch and reads the merged result back', async () => {
    mockAction = 'consolidation-config'
    const written: any = await POST(req({ enabled: true, coldRetentionDays: 90 }))
    expect(written.body.settings).toMatchObject({ enabled: true, coldRetentionDays: 90, clusterThreshold: 0.72 })
    const read: any = await GET(req(undefined))
    expect(read.body.settings.enabled).toBe(true)
    // null clears a nullable field
    await POST(req({ coldRetentionDays: null }))
    expect(storedConsolidation.coldRetentionDays).toBeNull()
  })

  it('rejects out-of-range consolidation values', async () => {
    mockAction = 'consolidation-config'
    const res: any = await POST(req({ clusterThreshold: 2 }))
    expect(res.status).toBe(400)
  })

  it('round-trips the extraction grain and rejects an unknown mode', async () => {
    mockAction = 'extraction-mode-config'
    const ok: any = await POST(req({ otherPass: 'fold', foldCandidatesPerSubject: 5 }))
    expect(ok.body.settings).toMatchObject({ otherPass: 'fold', foldCandidatesPerSubject: 5, perTurnOtherFloor: 0.75 })
    const read: any = await GET(req(undefined))
    expect(read.body.settings.otherPass).toBe('fold')
    const bad: any = await POST(req({ otherPass: 'sometimes' }))
    expect(bad.status).toBe(400)
  })
})

describe('GET list: tier and source filters', () => {
  it('passes tier=cold and source=CONSOLIDATED to the paginated query', async () => {
    mockAction = null
    await GET(req(undefined, `characterId=${CHAR_ID}&limit=20&tier=cold&source=CONSOLIDATED`))
    expect(mockCtx.repos.memories.findByCharacterIdPaginated).toHaveBeenCalledWith(
      CHAR_ID,
      expect.objectContaining({ tier: 'cold', source: 'CONSOLIDATED' }),
    )
  })

  it('ignores an unknown tier value', async () => {
    mockAction = null
    await GET(req(undefined, `characterId=${CHAR_ID}&limit=20&tier=lukewarm`))
    expect(mockCtx.repos.memories.findByCharacterIdPaginated.mock.calls[0][1].tier).toBeUndefined()
  })
})

describe('GET ?action=character-memory-counts (bug 210)', () => {
  it('reports hotTotal / demotable / protected / cold and sorts by the demotable count', async () => {
    mockAction = 'character-memory-counts'
    mockCtx.repos.characters.findByUserId = jest.fn(async () => [
      { id: 'a', name: 'Ariadne' },
      { id: 'b', name: 'Bertram' },
    ])
    mockCtx.repos.memories.countCapBreakdown = jest.fn(async (id: string) =>
      id === 'a'
        ? { hotTotal: 2300, demotable: 1400, protected: 900, cold: 50 }
        : { hotTotal: 1600, demotable: 1600, protected: 0, cold: 0 },
    )
    const res: any = await GET(req(undefined, 'action=character-memory-counts'))
    const body = res.body ?? (await res.json())
    expect(body.characters).toEqual([
      { id: 'b', name: 'Bertram', memoryCount: 1600, hotTotal: 1600, demotable: 1600, protected: 0, cold: 0 },
      { id: 'a', name: 'Ariadne', memoryCount: 2350, hotTotal: 2300, demotable: 1400, protected: 900, cold: 50 },
    ])
  })
})

describe('POST ?action=housekeep-sweep (bug 221)', () => {
  it('fans out one job per character and returns every id', async () => {
    mockAction = 'housekeep-sweep'
    mockSweep.mockResolvedValue(['job-a', 'job-b'])
    const res: any = await POST(req({}))
    const body = res.body ?? (await res.json())
    expect(mockSweep).toHaveBeenCalledWith('user-1', { reason: 'manual', phases: ['demote', 'retire'] })
    expect(body).toEqual({ success: true, jobId: 'job-a', jobIds: ['job-a', 'job-b'] })
  })
})

describe('POST ?action=housekeep (the demote and retire phases)', () => {
  it('runs demote + retire in-process at the requested cap and reports in the old shape', async () => {
    mockAction = 'housekeep'
    mockCtx.repos.memories.countCapBreakdown = jest.fn(async () => ({ hotTotal: 7, demotable: 5, protected: 2, cold: 4 }))
    mockRunMaintenance.mockResolvedValue({
      demote: { cap: 3, hotTotal: 7, demotable: 5, protected: 2, excess: 2, demoted: 2, demotedIds: ['x', 'y'], highestScoreDemoted: 0.2 },
      retire: { retentionDays: 30, retired: 1, retiredIds: ['z'] },
    })
    const res: any = await POST(req({ characterId: CHAR_ID, maxMemories: 100, dryRun: true, maxAgeMonths: 6 }))
    const body = res.body ?? (await res.json())
    expect(mockRunMaintenance.mock.calls[0][0]).toEqual({
      characterId: CHAR_ID,
      reason: 'manual',
      dryRun: true,
      phases: ['demote', 'retire'],
      settings: { cap: 100 },
    })
    expect(body.result).toMatchObject({
      demoted: 2,
      deleted: 1,
      kept: 5,
      hotTotal: 7,
      demotable: 5,
      protected: 2,
      capUsed: 3,
      coldCount: 4,
      demotedIds: ['x', 'y'],
      deletedIds: ['z'],
    })
    expect(body.result.details).toHaveLength(3)
  })
})

describe('POST ?action=maintain', () => {
  it('a dry run for one character runs in-process and returns the report', async () => {
    mockAction = 'maintain'
    mockRunMaintenance.mockResolvedValue({ characterId: CHAR_ID, phases: [] })
    const res: any = await POST(req({ characterId: CHAR_ID, dryRun: true, phases: ['demote'] }))
    const body = res.body ?? (await res.json())
    expect(body).toEqual({ success: true, dryRun: true, report: { characterId: CHAR_ID, phases: [] } })
    expect(mockRunMaintenance.mock.calls[0][0]).toMatchObject({ characterId: CHAR_ID, dryRun: true, phases: ['demote'], reason: 'manual' })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('a user-wide dry run is allowed for LLM-free phases and refused when it would consolidate', async () => {
    mockAction = 'maintain'
    mockCtx.repos.characters.findByUserId = jest.fn(async () => [{ id: 'a' }, { id: 'b', archivedAt: '2026-01-01' }, { id: 'c' }])
    mockRunMaintenance.mockImplementation(async (r: { characterId: string }) => ({ characterId: r.characterId }))
    const ok: any = await POST(req({ dryRun: true, phases: ['fold-near-duplicates'] }))
    const body = ok.body ?? (await ok.json())
    expect(body.reports.map((r: { characterId: string }) => r.characterId)).toEqual(['a', 'c'])

    const refused: any = await POST(req({ dryRun: true }))
    expect(refused.status).toBe(400)
  })

  it('a real run enqueues one job, or one per character when none is named', async () => {
    mockAction = 'maintain'
    mockEnqueue.mockResolvedValue('job-1')
    const one: any = await POST(req({ characterId: CHAR_ID, phases: ['consolidate'] }))
    expect((one.body ?? (await one.json())).jobIds).toEqual(['job-1'])
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { characterId: CHAR_ID, reason: 'manual', phases: ['consolidate'] })

    mockSweep.mockResolvedValue(['j-a', 'j-b'])
    const all: any = await POST(req({}))
    expect((all.body ?? (await all.json())).jobIds).toEqual(['j-a', 'j-b'])
    expect(mockSweep).toHaveBeenCalledWith('user-1', { reason: 'manual' })
  })

  it('rejects an unknown phase', async () => {
    mockAction = 'maintain'
    const res: any = await POST(req({ characterId: CHAR_ID, phases: ['tidy-up'] }))
    expect(res.status).toBe(400)
  })
})

describe('GET ?action=maintenance-status', () => {
  it('returns the ledger, for one character or all', async () => {
    mockAction = 'maintenance-status'
    mockLedger.mockResolvedValue([{ characterId: CHAR_ID, lastRun: {} }])
    const res: any = await GET(req(undefined, `action=maintenance-status&characterId=${CHAR_ID}`))
    const body = res.body ?? (await res.json())
    expect(mockLedger).toHaveBeenCalledWith(CHAR_ID)
    expect(body).toEqual({ success: true, ledger: [{ characterId: CHAR_ID, lastRun: {} }] })
  })
})
