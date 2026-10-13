/**
 * /api/v1/memories — manual create (bug 218) and item read (bug 219):
 *  - POST forces source MANUAL and witnessedContext 'manual', ignores skipGate,
 *    resolves projectId (explicit or from the chat), admits the candidate
 *    through `admitCandidate`, and returns 201 only on insert — 200 with the
 *    existing row when admission reinforced / absorbed.
 *  - GET /memories/[id] does not stamp lastAccessedAt.
 *  - A refusal says why (bug 236): blank text is a 400 before admission, an
 *    embedding failure a 502, never a 500 blaming the embedding profile.
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
  errorResponse: (msg: string, status = 500) => ({ status, body: { error: msg } }),
  validationError: (err: unknown) => ({ status: 400, body: { error: 'Validation error', err } }),
  successResponse: (data: any) => ({ status: 200, body: data }),
}))

const mockAdmit = jest.fn()
jest.mock('@/lib/memory/recall/search', () => ({}))
jest.mock('@/lib/memory/index-store/backfill', () => ({}))
jest.mock('@/lib/memory/admission', () => ({
  admitCandidate: (...args: unknown[]) => mockAdmit(...args),
  admissionInserted: (o: { action: { kind: string } }) => o.action.kind === 'insert' || o.action.kind === 'insert-linked',
}))

jest.mock('@/lib/embedding/embedding-job-scheduler', () => ({
  scheduleRefit: jest.fn(async () => undefined),
  handleEntityDeletion: jest.fn(),
}))

jest.mock('@/lib/memory/consolidation', () => ({}))
jest.mock('@/lib/background-jobs/queue-service', () => ({}))
jest.mock('@/lib/instance-settings', () => ({}))
jest.mock('@/lib/memory/housekeeping', () => ({}))
jest.mock('@/lib/memory/anchor-gate-probe', () => ({}))
jest.mock('@/lib/embedding/embedding-service', () => ({}))
jest.mock('@/lib/background-jobs/processor', () => ({}))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({}))

import { POST } from '@/app/api/v1/memories/route'
import { toAdmissionRow } from '@/lib/memory/candidate'
import { GET as GET_ITEM } from '@/app/api/v1/memories/[id]/route'

const CHAR_ID = '11111111-1111-4111-8111-111111111111'
const CHAT_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MEMORY_ID = '55555555-5555-4555-8555-555555555555'

function req(body?: unknown): any {
  return { nextUrl: { searchParams: new URLSearchParams() }, json: async () => body }
}

/** The row admission was asked to admit on call `i`. */
function admittedRow(i = 0) {
  const [candidate, resolved] = mockAdmit.mock.calls[i]
  return toAdmissionRow(candidate, resolved)
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
  mockAdmit.mockResolvedValue({ memory: { id: 'new-row' }, action: { kind: 'insert' } })
})

describe('POST /api/v1/memories (manual create, bug 218)', () => {
  it('forces MANUAL source and manual provenance, and ignores skipGate', async () => {
    const res: any = await POST(req({ ...baseBody, source: 'AUTO', skipGate: true }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ memory: { id: 'new-row' }, action: 'insert' })
    const data = admittedRow()
    expect(data.source).toBe('MANUAL')
    expect(data.witnessedContext).toBe('manual')
    expect(data.projectId).toBeNull()
    expect(mockAdmit.mock.calls[0][2]).toEqual({ userId: 'user-1' })
  })

  it('derives projectId from the supplied chat', async () => {
    await POST(req({ ...baseBody, chatId: CHAT_ID }))
    const data = admittedRow()
    expect(data.chatId).toBe(CHAT_ID)
    expect(data.projectId).toBe(PROJECT_ID)
  })

  it('an explicit projectId wins over the chat', async () => {
    await POST(req({ ...baseBody, chatId: CHAT_ID, projectId: OTHER_PROJECT_ID }))
    expect(admittedRow().projectId).toBe(OTHER_PROJECT_ID)
  })

  it('404s an unknown project or chat without writing', async () => {
    const r1: any = await POST(req({ ...baseBody, projectId: MEMORY_ID }))
    expect(r1.status).toBe(404)
    const r2: any = await POST(req({ ...baseBody, chatId: MEMORY_ID }))
    expect(r2.status).toBe(404)
    expect(mockAdmit).not.toHaveBeenCalled()
  })

  it('passes kind, occurredAt and entities through', async () => {
    await POST(req({ ...baseBody, kind: 'episodic', occurredAt: '2026-10-01T18:00:00Z', entities: ['Kettle'] }))
    expect(admittedRow()).toMatchObject({
      kind: 'episodic',
      occurredAt: '2026-10-01T18:00:00Z',
      entities: ['Kettle'],
    })
  })

  it('returns 201 for insert-linked', async () => {
    mockAdmit.mockResolvedValue({ memory: { id: 'new-row' }, action: { kind: 'insert-linked', linkTo: ['x'], reason: 'band' } })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(201)
  })

  it.each(['reinforce', 'absorb', 'promote-and-reinforce'])('returns 200 with the existing row on %s', async (kind) => {
    mockAdmit.mockResolvedValue({ memory: { id: 'existing-row' }, action: { kind, into: 'existing-row' } })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ memory: { id: 'existing-row' }, action: kind })
  })

  it('502s when the embedding failed and nothing was written (bug 236)', async () => {
    mockAdmit.mockResolvedValue({ memory: null, action: { kind: 'reject', reason: 'embedding-failed' } })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/could not be embedded/)
  })

  it.each([
    ['content', { content: '   ' }],
    ['summary', { summary: '\n\t ' }],
  ])('400s blank %s without asking admission (bug 236)', async (_field, patch) => {
    const res: any = await POST(req({ ...baseBody, ...patch }))
    expect(res.status).toBe(400)
    expect(mockAdmit).not.toHaveBeenCalled()
  })

  it('400s an admission refusal for empty text, never blaming the embedding (bug 236)', async () => {
    mockAdmit.mockResolvedValue({ memory: null, action: { kind: 'reject', reason: 'empty' } })
    const res: any = await POST(req(baseBody))
    expect(res.status).toBe(400)
    expect(res.body.error).not.toMatch(/embed/i)
  })

  it('trims surrounding whitespace before admission', async () => {
    await POST(req({ ...baseBody, content: '  Alice likes tea \n', summary: ' Tea ' }))
    expect(admittedRow()).toMatchObject({ content: 'Alice likes tea', summary: 'Tea' })
  })

  it('400s a malformed body', async () => {
    const res: any = await POST(req({ ...baseBody, characterId: 'nope' }))
    expect(res.status).toBe(400)
    expect(mockAdmit).not.toHaveBeenCalled()
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
