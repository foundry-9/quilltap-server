/**
 * /api/v1/memories — consolidation surfaces:
 *  - POST ?action=consolidate (dry run runs in-process and returns the report;
 *    a real run enqueues a job; input is validated; the dry run is bounded)
 *  - GET/POST ?action=consolidation-config and ?action=extraction-mode-config
 *  - GET list honours ?tier= and ?source=CONSOLIDATED
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

const mockRunConsolidation = jest.fn()
jest.mock('@/lib/memory/consolidation', () => ({
  runConsolidation: (...args: unknown[]) => mockRunConsolidation(...args),
}))

const mockEnqueue = jest.fn()
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueMemoryConsolidation: (...args: unknown[]) => mockEnqueue(...args),
  enqueueEmbeddingGenerate: jest.fn(),
  enqueueMemoryHousekeeping: jest.fn(),
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

jest.mock('@/lib/memory/memory-service', () => ({}))
jest.mock('@/lib/memory/housekeeping', () => ({}))
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
    mockRunConsolidation.mockResolvedValue({ clusters: [], dryRun: true })
    const res: any = await POST(req({ characterId: CHAR_ID, dryRun: true, clusterThreshold: 0.8 }))
    expect(res.body).toEqual({ success: true, dryRun: true, report: { clusters: [], dryRun: true } })
    expect(mockEnqueue).not.toHaveBeenCalled()
    const [id, opts] = mockRunConsolidation.mock.calls[0]
    expect(id).toBe(CHAR_ID)
    expect(opts).toMatchObject({
      dryRun: true,
      maxClustersPerRun: 10,
      userId: 'user-1',
      timeBudgetMs: 120000,
      trigger: 'manual',
      settings: { clusterThreshold: 0.8 },
    })
  })

  it('caps a dry run at 40 clusters', async () => {
    mockAction = 'consolidate'
    mockRunConsolidation.mockResolvedValue({ clusters: [] })
    await POST(req({ characterId: CHAR_ID, dryRun: true, maxClustersPerRun: 500 }))
    expect(mockRunConsolidation.mock.calls[0][1].maxClustersPerRun).toBe(40)
  })

  it('a real run enqueues a job and returns its id', async () => {
    mockAction = 'consolidate'
    mockEnqueue.mockResolvedValue('job-9')
    const res: any = await POST(req({ characterId: CHAR_ID, maxClustersPerRun: 100 }))
    expect(res.body).toEqual({ success: true, dryRun: false, jobId: 'job-9' })
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { characterId: CHAR_ID, maxClustersPerRun: 100, trigger: 'manual' })
    expect(mockRunConsolidation).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    mockAction = 'consolidate'
    const res: any = await POST(req({ characterId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    const res2: any = await POST(req({ characterId: CHAR_ID, clusterThreshold: 3 }))
    expect(res2.status).toBe(400)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockRunConsolidation).not.toHaveBeenCalled()
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
