/**
 * /api/v1/memories — manual create (bug 218) and item read (bug 219):
 *  - POST forces source MANUAL and witnessedContext 'manual', ignores skipGate,
 *    resolves projectId (explicit or from the chat), and returns 201 only on
 *    insert — 200 with the existing row when the gate reinforced / absorbed.
 *  - GET /memories/[id] does not stamp lastAccessedAt.
 */

let mockCtx: any
let mockAction: string | null = null

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => async (req: any) => handler(req, mockCtx),
  createContextParamsHandler:
    (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
    async (req: any, { params }: { params: Promise<any> }) =>
      handler(req, mockCtx, await params),
  dispatchAction: (_req: unknown, handlers: Record<string, () => Promise<unknown>>, fallback?: () => Promise<unknown>) => {
    if (mockAction === null) return fallback ? fallback() : { status: 400 }
    const h = handlers[mockAction]
    return h ? h() : { status: 400 }
  },
}))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: any, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ status: 404, body: { error: `${what} not found` } }),
  badRequest: (msg: string) => ({ status: 400, body: { error: msg } }),
  serverError: (msg: string) => ({ status: 500, body: { error: msg } }),
  validationError: (err: unknown) => ({ status: 400, body: { error: 'Validation error', err } }),
  successResponse: (data: any) => ({ status: 200, body: data }),
}))

const mockCreateMemoryWithGate = jest.fn()
jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: (...args: unknown[]) => mockCreateMemoryWithGate(...args),
}))

jest.mock('@/lib/embedding/embedding-job-scheduler', () => ({
  scheduleRefit: jest.fn(async () => undefined),
  handleEntityDeletion: jest.fn(),
}))

jest.mock('@/lib/memory/memory-gate', () => ({ deleteMemoryWithUnlink: jest.fn() }))
jest.mock('@/lib/memory/consolidation', () => ({}))
jest.mock('@/lib/background-jobs/queue-service', () => ({}))
jest.mock('@/lib/instance-settings', () => ({}))
jest.mock('@/lib/memory/housekeeping', () => ({}))
jest.mock('@/lib/memory/anchor-gate-probe', () => ({}))
jest.mock('@/lib/embedding/embedding-service', () => ({}))
jest.mock('@/lib/background-jobs/processor', () => ({}))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({}))

import { POST } from '@/app/api/v1/memories/route'
import { GET as GET_ITEM } from '@/app/api/v1/memories/[id]/route'

const CHAR_ID = '11111111-1111-4111-8111-111111111111'
const CHAT_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MEMORY_ID = '55555555-5555-4555-8555-555555555555'

function req(body?: unknown): any {
  return { nextUrl: { searchParams: new URLSearchParams() }, json: async () => body }
}

const baseBody = { characterId: CHAR_ID, content: 'Alice likes tea', summary: 'Tea' }

beforeEach(() => {
  jest.clearAllMocks()
  mockAction = null
  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      characters: { findById: jest.fn(async (id: string) => (id === CHAR_ID ? { id, name: 'Ariadne' } : null)) },
      chats: { findById: jest.fn(async (id: string) => (id === CHAT_ID ? { id, projectId: PROJECT_ID } : null)) },
      projects: {
        findById: jest.fn(async (id: string) =>
          id === PROJECT_ID || id === OTHER_PROJECT_ID ? { id } : null
        ),
      },
      memories: {
        findById: jest.fn(async (id: string) =>
          id === MEMORY_ID ? { id, characterId: CHAR_ID, tags: [], lastAccessedAt: null } : null
        ),
        updateAccessTime: jest.fn(async () => undefined),
      },
      tags: { findAll: jest.fn(async () => []) },
    },
  }
  mockCreateMemoryWithGate.mockResolvedValue({ memory: { id: 'new-row' }, action: 'INSERT' })
})

describe('POST /api/v1/memories (manual create, bug 218)', () => {
  it('forces MANUAL source and manual provenance, and ignores skipGate', async () => {
    const res: any = await POST(req({ ...baseBody, source: 'AUTO', skipGate: true }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ memory: { id: 'new-row' }, action: 'INSERT' })
    const [data, opts] = mockCreateMemoryWithGate.mock.calls[0]
    expect(data.source).toBe('MANUAL')
    expect(data.witnessedContext).toBe('manual')
    expect(data.projectId).toBeNull()
    expect(opts).toEqual({ userId: 'user-1', promoteOnMatch: true })
    expect(opts.skipGate).toBeUndefined()
  })

  it('derives projectId from the supplied chat', async () => {
    await POST(req({ ...baseBody, chatId: CHAT_ID }))
    const [data] = mockCreateMemoryWithGate.mock.calls[0]
    expect(data.chatId).toBe(CHAT_ID)
    expect(data.projectId).toBe(PROJECT_ID)
  })

  it('an explicit projectId wins over the chat', async () => {
    await POST(req({ ...baseBody, chatId: CHAT_ID, projectId: OTHER_PROJECT_ID }))
    expect(mockCreateMemoryWithGate.mock.calls[0][0].projectId).toBe(OTHER_PROJECT_ID)
  })

  it('404s an unknown project or chat without writing', async () => {
    const r1: any = await POST(req({ ...baseBody, projectId: MEMORY_ID }))
    expect(r1.status).toBe(404)
    const r2: any = await POST(req({ ...baseBody, chatId: MEMORY_ID }))
    expect(r2.status).toBe(404)
    expect(mockCreateMemoryWithGate).not.toHaveBeenCalled()
  })

  it('passes kind, occurredAt and entities through', async () => {
    await POST(req({ ...baseBody, kind: 'episodic', occurredAt: '2026-10-01T18:00:00Z', entities: ['Kettle'] }))
    expect(mockCreateMemoryWithGate.mock.calls[0][0]).toMatchObject({
      kind: 'episodic',
      occurredAt: '2026-10-01T18:00:00Z',
      entities: ['Kettle'],
    })
  })

  it('returns 201 for INSERT_RELATED', async () => {
    mockCreateMemoryWithGate.mockResolvedValue({ memory: { id: 'new-row' }, action: 'INSERT_RELATED' })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(201)
  })

  it.each(['REINFORCE', 'SKIP_NEAR_DUPLICATE'])('returns 200 with the existing row on %s', async (action) => {
    mockCreateMemoryWithGate.mockResolvedValue({ memory: { id: 'existing-row' }, action })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ memory: { id: 'existing-row' }, action })
  })

  it('500s when the embedding failed and nothing was written', async () => {
    mockCreateMemoryWithGate.mockResolvedValue({ memory: null, action: 'SKIP_EMBEDDING_FAILED' })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(500)
  })

  it('400s a malformed body', async () => {
    const res: any = await POST(req({ ...baseBody, characterId: 'nope' }))
    expect(res.status).toBe(400)
    expect(mockCreateMemoryWithGate).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/memories/[id] (bug 219)', () => {
  it('returns the memory without stamping lastAccessedAt', async () => {
    const res: any = await GET_ITEM(req(), { params: Promise.resolve({ id: MEMORY_ID }) } as any)
    expect(res.status).toBe(200)
    expect(res.body.memory.id).toBe(MEMORY_ID)
    expect(mockCtx.repos.memories.updateAccessTime).not.toHaveBeenCalled()
  })
})
