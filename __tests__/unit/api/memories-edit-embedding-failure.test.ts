/**
 * PUT /api/v1/memories/[id]: when the edited text cannot be re-embedded the
 * edit is refused with 502 and a clear message, rather than a 200 over a
 * stale vector.
 */

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler:
    (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
    async (req: any, { params }: { params: Promise<any> }) =>
      handler(req, mockCtx, await params),
}))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: any, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ status: 404, body: { error: `${what} not found` } }),
  badRequest: (msg: string) => ({ status: 400, body: { error: msg } }),
  serverError: (msg: string) => ({ status: 500, body: { error: msg } }),
  errorResponse: (msg: string, status = 500) => ({ status, body: { error: msg } }),
}))

const mockEditMemory = jest.fn()
jest.mock('@/lib/memory/memory-edit', () => ({ editMemory: (...args: unknown[]) => mockEditMemory(...args) }))
jest.mock('@/lib/memory/memory-gate', () => ({ deleteMemoryWithUnlink: jest.fn() }))
jest.mock('@/lib/embedding/embedding-job-scheduler', () => ({
  scheduleRefit: jest.fn(async () => undefined),
  handleEntityDeletion: jest.fn(),
}))

import { PUT } from '@/app/api/v1/memories/[id]/route'
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler'

const CHAR_ID = '11111111-1111-4111-8111-111111111111'
const MEMORY_ID = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      memories: { findById: jest.fn(async () => ({ id: MEMORY_ID, characterId: CHAR_ID })) },
      characters: { findById: jest.fn(async () => ({ id: CHAR_ID })) },
    },
  }
})

describe('PUT /api/v1/memories/[id] with a failing embedder', () => {
  it('answers 502 with the reason and schedules no refit', async () => {
    mockEditMemory.mockResolvedValue({ ok: false, reason: 'embedding-failed', message: 'provider down' })
    const res: any = await PUT({ json: async () => ({ content: 'new words' }) } as any, {
      params: Promise.resolve({ id: MEMORY_ID }),
    } as any)
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/not saved.*embedded/i)
    expect(res.body.error).toContain('provider down')
    expect(scheduleRefit).not.toHaveBeenCalled()
  })
})
