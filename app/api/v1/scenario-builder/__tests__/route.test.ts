/**
 * @jest-environment node
 *
 * Tests for the Scenario Builder route
 * (`/api/v1/scenario-builder?action=build|capabilities`).
 *
 * Runs in the `node` environment: the route builds a `ReadableStream`, which
 * jsdom does not provide. `createContextHandler` is stubbed to hand the
 * fabricated `{ user, repos }` straight to the real `withCollectionActionDispatch`
 * (kept real via `requireActual` so `?action=` routing itself is exercised).
 * `runScenarioBuilder` / `resolveScenarioBuilderCapabilities` and the API-key
 * resolver are mocked — this is a route test, not a service test.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  logger.child = jest.fn(() => logger)
  return { logger }
})

jest.mock('@/lib/api/middleware', () => {
  const actual = jest.requireActual('@/lib/api/middleware')
  return {
    ...actual,
    createContextHandler:
      (handler: (req: any, ctx: any) => Promise<any>) =>
      async (req: any, ctx: any) =>
        handler(req, ctx),
  }
})

jest.mock('@/lib/services/scenario-builder/scenario-builder.service', () => ({
  runScenarioBuilder: jest.fn(async () => undefined),
  resolveScenarioBuilderCapabilities: jest.fn(async () => ({
    webSearchConfigured: true,
    curlConfigured: false,
  })),
}))

jest.mock('@/lib/services/api-key.service', () => ({
  resolveConnectionProfileApiKey: jest.fn(async () => ({ ok: true, apiKey: 'sk-test' })),
  describeProfileApiKeyFailure: jest.fn(() => 'No API key configured for this profile.'),
}))

import { GET as GET_, POST as POST_ } from '@/app/api/v1/scenario-builder/route'

// The mocked `createContextHandler` (see above) forwards a second `ctx`
// argument that the real middleware's public type doesn't expose — it is
// only ever `handler(req, ctx)` under the hood. Recast for the tests below.
const GET = GET_ as unknown as (req: unknown, ctx: unknown) => Promise<Response & { json(): Promise<any> }>
const POST = POST_ as unknown as (req: unknown, ctx: unknown) => Promise<Response & { json(): Promise<any> }>

import {
  runScenarioBuilder,
  resolveScenarioBuilderCapabilities,
} from '@/lib/services/scenario-builder/scenario-builder.service'
import {
  resolveConnectionProfileApiKey,
  describeProfileApiKeyFailure,
} from '@/lib/services/api-key.service'

const runBuilder = runScenarioBuilder as jest.MockedFunction<typeof runScenarioBuilder>
const resolveCapabilities = resolveScenarioBuilderCapabilities as jest.MockedFunction<
  typeof resolveScenarioBuilderCapabilities
>
const resolveApiKey = resolveConnectionProfileApiKey as jest.MockedFunction<
  typeof resolveConnectionProfileApiKey
>
const describeApiKeyFailure = describeProfileApiKeyFailure as jest.MockedFunction<
  typeof describeProfileApiKeyFailure
>

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROFILE_ID = '00000000-0000-4000-8000-000000000002'
const CHAR_ID_1 = '00000000-0000-4000-8000-000000000003'
const CHAR_ID_2 = '00000000-0000-4000-8000-000000000004'
const CHAT_ID = '00000000-0000-4000-8000-000000000005'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    userId: USER_ID,
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    allowToolUse: true,
    allowWebSearch: true,
    ...overrides,
  }
}

function makeRepos(overrides: Record<string, unknown> = {}) {
  return {
    connections: { findById: jest.fn(async () => profile()) },
    characters: { findById: jest.fn(async (id: string) => ({ id })) },
    chats: { findById: jest.fn(async () => null) },
    ...overrides,
  }
}

function ctx(repos: ReturnType<typeof makeRepos> = makeRepos(), userId = USER_ID) {
  return { user: { id: userId }, repos } as never
}

/** A minimal NextRequest-alike: `nextUrl` drives `?action=` dispatch. */
function req(body: unknown, opts: { action?: string; signal?: AbortSignal } = {}) {
  const url = new URL('http://localhost/api/v1/scenario-builder')
  if (opts.action) url.searchParams.set('action', opts.action)
  return {
    nextUrl: url,
    json: async () => body,
    signal: opts.signal ?? new AbortController().signal,
  } as never
}

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'in-world',
    location: 'the Lantern Inn',
    time: 'a rainy evening',
    connectionProfileId: PROFILE_ID,
    characterIds: [],
    ...overrides,
  }
}

/** Read a `ReadableStream<Uint8Array>` body to its full decoded text. */
async function drainText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

beforeEach(() => {
  jest.clearAllMocks()
  runBuilder.mockResolvedValue(undefined)
  resolveCapabilities.mockResolvedValue({ webSearchConfigured: true, curlConfigured: false })
  resolveApiKey.mockResolvedValue({ ok: true, apiKey: 'sk-test' } as never)
  describeApiKeyFailure.mockReturnValue('No API key configured for this profile.')
})

describe('POST /api/v1/scenario-builder?action=build — request schema', () => {
  it('rejects priorDraft without revision', async () => {
    const res = await POST(req(buildBody({ priorDraft: 'A draft.' }), { action: 'build' }), ctx())
    expect(res.status).toBe(400)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('rejects revision without priorDraft', async () => {
    const res = await POST(req(buildBody({ revision: 'Make it rain.' }), { action: 'build' }), ctx())
    expect(res.status).toBe(400)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('accepts both priorDraft and revision together', async () => {
    const res = await POST(
      req(buildBody({ priorDraft: 'A draft.', revision: 'Make it rain.' }), { action: 'build' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    expect(runBuilder).toHaveBeenCalledTimes(1)
  })

  it('accepts a request with neither priorDraft nor revision', async () => {
    const res = await POST(req(buildBody(), { action: 'build' }), ctx())
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/scenario-builder?action=build — profile checks', () => {
  it('404s when the profile does not exist', async () => {
    const repos = makeRepos({ connections: { findById: jest.fn(async () => null) } })
    const res = await POST(req(buildBody(), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(404)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it("404s when the profile belongs to a different user", async () => {
    const repos = makeRepos({
      connections: { findById: jest.fn(async () => profile({ userId: 'someone-else' })) },
    })
    const res = await POST(req(buildBody(), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(404)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('400s when the profile has tool use switched off', async () => {
    const repos = makeRepos({
      connections: { findById: jest.fn(async () => profile({ allowToolUse: false })) },
    })
    const res = await POST(req(buildBody(), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/tool use switched off/i)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('400s when the API key cannot be resolved', async () => {
    resolveApiKey.mockResolvedValue({ ok: false, reason: 'missing' } as never)
    const res = await POST(req(buildBody(), { action: 'build' }), ctx())
    expect(res.status).toBe(400)
    expect(runBuilder).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/scenario-builder?action=build — cast scoping', () => {
  it('drops cast ids the user cannot read from the ids handed to runScenarioBuilder', async () => {
    const findById = jest.fn(async (id: string) => (id === CHAR_ID_1 ? { id } : null))
    const repos = makeRepos({ characters: { findById } })

    await POST(req(buildBody({ characterIds: [CHAR_ID_1, CHAR_ID_2] }), { action: 'build' }), ctx(repos))

    expect(runBuilder).toHaveBeenCalledTimes(1)
    const options = runBuilder.mock.calls[0][0] as { input: { characterIds: string[] } }
    expect(options.input.characterIds).toEqual([CHAR_ID_1])
  })

  it('drops a cast id whose lookup throws', async () => {
    const findById = jest.fn(async (id: string) => {
      if (id === CHAR_ID_2) throw new Error('vault unavailable')
      return { id }
    })
    const repos = makeRepos({ characters: { findById } })

    await POST(req(buildBody({ characterIds: [CHAR_ID_1, CHAR_ID_2] }), { action: 'build' }), ctx(repos))

    const options = runBuilder.mock.calls[0][0] as { input: { characterIds: string[] } }
    expect(options.input.characterIds).toEqual([CHAR_ID_1])
  })
})

describe('POST /api/v1/scenario-builder?action=build — chatId', () => {
  it('400s for a help chat', async () => {
    const repos = makeRepos({
      chats: { findById: jest.fn(async () => ({ id: CHAT_ID, userId: USER_ID, chatType: 'help' })) },
    })
    const res = await POST(req(buildBody({ chatId: CHAT_ID }), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(400)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('404s for a chat owned by someone else', async () => {
    const repos = makeRepos({
      chats: { findById: jest.fn(async () => ({ id: CHAT_ID, userId: 'someone-else', chatType: 'salon' })) },
    })
    const res = await POST(req(buildBody({ chatId: CHAT_ID }), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(404)
    expect(runBuilder).not.toHaveBeenCalled()
  })

  it('404s for a chat that does not exist', async () => {
    const repos = makeRepos({ chats: { findById: jest.fn(async () => null) } })
    const res = await POST(req(buildBody({ chatId: CHAT_ID }), { action: 'build' }), ctx(repos))
    expect(res.status).toBe(404)
  })

  it('accepts a salon chat and an autonomous room', async () => {
    for (const chatType of ['salon', 'autonomous']) {
      runBuilder.mockClear()
      const repos = makeRepos({
        chats: { findById: jest.fn(async () => ({ id: CHAT_ID, userId: USER_ID, chatType })) },
      })
      const res = await POST(req(buildBody({ chatId: CHAT_ID }), { action: 'build' }), ctx(repos))
      expect(res.status).toBe(200)
      expect(runBuilder).toHaveBeenCalledTimes(1)
    }
  })
})

describe('POST /api/v1/scenario-builder?action=build — streaming', () => {
  it('returns a text/event-stream response whose body carries what runScenarioBuilder enqueued', async () => {
    runBuilder.mockImplementation(async (_opts, controller) => {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, scenario: 'Rain on the cobbles.' })}\n\n`))
    })

    const res = await POST(req(buildBody(), { action: 'build' }), ctx())

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const text = await drainText((res as unknown as { body: ReadableStream<Uint8Array> | null }).body)
    expect(text).toContain('Rain on the cobbles.')
  })

  it('passes the request signal through to runScenarioBuilder, and aborting it aborts that signal', async () => {
    let capturedSignal: AbortSignal | undefined
    runBuilder.mockImplementation(async (_opts, _controller, signal) => {
      capturedSignal = signal
    })

    const controller = new AbortController()
    const res = await POST(req(buildBody(), { action: 'build', signal: controller.signal }), ctx())
    // Drain so the stream's start() callback (which calls runScenarioBuilder) has run.
    await drainText((res as unknown as { body: ReadableStream<Uint8Array> | null }).body)

    expect(capturedSignal).toBe(controller.signal)
    expect(capturedSignal?.aborted).toBe(false)

    controller.abort()
    expect(capturedSignal?.aborted).toBe(true)
  })
})

describe('GET /api/v1/scenario-builder?action=capabilities', () => {
  it('returns the resolved capabilities', async () => {
    resolveCapabilities.mockResolvedValue({ webSearchConfigured: true, curlConfigured: true })

    const res = await GET(req(undefined, { action: 'capabilities' }), ctx())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ webSearchConfigured: true, curlConfigured: true })
    expect(resolveCapabilities).toHaveBeenCalledWith(expect.anything(), USER_ID)
  })

  it('500s when the capability lookup throws', async () => {
    resolveCapabilities.mockRejectedValue(new Error('plugin registry unavailable'))

    const res = await GET(req(undefined, { action: 'capabilities' }), ctx())

    expect(res.status).toBe(500)
  })
})
