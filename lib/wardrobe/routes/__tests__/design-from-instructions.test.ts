/**
 * @jest-environment node
 *
 * Tests for the Import from Instructions handlers
 * (`/api/v1/wardrobe?action=design-from-instructions | design-defaults`).
 *
 * Runs in the `node` environment: the handler builds a `ReadableStream`. The
 * run itself, the location resolver, the API-key resolver and the web
 * capabilities are mocked — this is a route test, not a service test.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})
jest.mock('@/lib/services/wardrobe-design/wardrobe-design.service', () => ({
  runWardrobeInstructionDesign: jest.fn(async () => undefined),
  resolveWardrobeDesignReach: jest.fn(),
  wardrobeDesignUsesTools: jest.fn((reach: { stores: boolean; webSearch: boolean; webFetch: boolean }) =>
    reach.stores || reach.webSearch || reach.webFetch,
  ),
}))
jest.mock('@/lib/services/api-key.service', () => ({
  resolveConnectionProfileApiKey: jest.fn(async () => ({ ok: true, apiKey: 'sk-test' })),
  describeProfileApiKeyFailure: jest.fn(() => 'No API key configured for this profile.'),
}))
jest.mock('@/lib/tools/web-capabilities', () => ({
  resolveWebCapabilities: jest.fn(async () => ({ webSearchConfigured: true, curlConfigured: false })),
}))
jest.mock('@/lib/wardrobe/location', () => ({
  resolveWardrobeLocation: jest.fn(),
}))

import { handleWardrobeDesign, handleWardrobeDesignDefaults } from '../design-from-instructions'
import {
  resolveWardrobeDesignReach,
  runWardrobeInstructionDesign,
} from '@/lib/services/wardrobe-design/wardrobe-design.service'
import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import { resolveWardrobeLocation } from '@/lib/wardrobe/location'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROFILE_ID = '00000000-0000-4000-8000-000000000002'
const CHAR_ID = '00000000-0000-4000-8000-000000000003'

const LOCATION = { scope: 'character', mountPointId: 'mount-1', origin: { scope: 'character', id: CHAR_ID, name: 'Mara' } }

const profile = (over: Record<string, unknown> = {}) => ({
  id: PROFILE_ID,
  userId: USER_ID,
  provider: 'anthropic',
  modelName: 'claude',
  allowToolUse: true,
  allowWebSearch: true,
  ...over,
})

function makeRepos(over: Record<string, unknown> = {}) {
  return {
    connections: {
      findById: jest.fn(async () => profile()),
      findDefault: jest.fn(async () => profile()),
    },
    characters: { findByIdRaw: jest.fn(async () => ({ id: CHAR_ID, userId: USER_ID, archivedAt: null })) },
    ...over,
  }
}

const ctx = (repos = makeRepos()) => ({ user: { id: USER_ID }, repos }) as never

function req(body: unknown, signal: AbortSignal = new AbortController().signal) {
  const text = JSON.stringify(body)
  return { nextUrl: new URL('http://localhost/api/v1/wardrobe'), json: async () => body, text: async () => text, signal } as never
}

const body = (over: Record<string, unknown> = {}) => ({
  instructions: 'a business outfit',
  connectionProfileId: PROFILE_ID,
  target: { scope: 'character', id: CHAR_ID },
  ...over,
})

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
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
  jest.mocked(resolveWardrobeLocation).mockResolvedValue(LOCATION as never)
  jest.mocked(resolveWardrobeDesignReach).mockResolvedValue({
    stores: true, webSearch: true, webFetch: false, webWantedButUnavailable: false,
  })
})

describe('GET design-defaults', () => {
  it('returns the default profile and what of the web is reachable', async () => {
    const res = await handleWardrobeDesignDefaults(req(null), ctx())
    expect(await res.json()).toEqual({ defaultProfileId: PROFILE_ID, webSearchConfigured: true, curlConfigured: false })
  })

  it('returns a null profile when the user has no default', async () => {
    const repos = makeRepos({ connections: { findById: jest.fn(), findDefault: jest.fn(async () => null) } })
    const res = await handleWardrobeDesignDefaults(req(null), ctx(repos))
    expect((await res.json()).defaultProfileId).toBeNull()
  })
})

describe('POST design-from-instructions — refusals', () => {
  it('refuses an invalid body before anything is read', async () => {
    const res = await handleWardrobeDesign(req(body({ instructions: '' })), ctx())
    expect(res.status).toBe(400)
    expect(resolveWardrobeLocation).not.toHaveBeenCalled()
    expect(runWardrobeInstructionDesign).not.toHaveBeenCalled()
  })

  it('refuses an archived character, and one that belongs to someone else', async () => {
    const archived = makeRepos({
      characters: { findByIdRaw: jest.fn(async () => ({ id: CHAR_ID, userId: USER_ID, archivedAt: '2026-01-01T00:00:00.000Z' })) },
    })
    expect((await handleWardrobeDesign(req(body()), ctx(archived))).status).toBe(404)
    const foreign = makeRepos({
      characters: { findByIdRaw: jest.fn(async () => ({ id: CHAR_ID, userId: 'someone-else', archivedAt: null })) },
    })
    expect((await handleWardrobeDesign(req(body()), ctx(foreign))).status).toBe(404)
    expect(resolveWardrobeLocation).not.toHaveBeenCalled()
  })

  it('refuses a target that does not resolve, and never provisions one', async () => {
    jest.mocked(resolveWardrobeLocation).mockResolvedValue(null)
    const res = await handleWardrobeDesign(req(body({ target: { scope: 'project', id: CHAR_ID } })), ctx())
    expect(res.status).toBe(404)
    // A read probe: no `ensure` option is passed.
    expect(jest.mocked(resolveWardrobeLocation).mock.calls[0]).toHaveLength(4)
  })

  it("refuses a profile that is not the user's", async () => {
    const repos = makeRepos({ connections: { findById: jest.fn(async () => profile({ userId: 'someone-else' })), findDefault: jest.fn() } })
    expect((await handleWardrobeDesign(req(body()), ctx(repos))).status).toBe(404)
  })

  it('refuses a no-tools profile only when the run would build a tool', async () => {
    const repos = makeRepos({ connections: { findById: jest.fn(async () => profile({ allowToolUse: false })), findDefault: jest.fn() } })
    const refused = await handleWardrobeDesign(req(body()), ctx(repos))
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toMatch(/tool use switched off/)

    jest.mocked(resolveWardrobeDesignReach).mockResolvedValue({
      stores: false, webSearch: false, webFetch: false, webWantedButUnavailable: true,
    })
    const allowed = await handleWardrobeDesign(req(body({ searchStores: false })), ctx(repos))
    expect(allowed.status).toBe(200)
    await drain(allowed.body)
  })

  it('refuses a profile with no usable key', async () => {
    jest.mocked(resolveConnectionProfileApiKey).mockResolvedValueOnce({ ok: false, reason: 'missing' } as never)
    const res = await handleWardrobeDesign(req(body()), ctx())
    expect(res.status).toBe(400)
    expect(runWardrobeInstructionDesign).not.toHaveBeenCalled()
  })
})

describe('POST design-from-instructions — the stream', () => {
  it('runs the design against the resolved location and streams what it enqueues', async () => {
    jest.mocked(runWardrobeInstructionDesign).mockImplementationOnce(async (_opts, controller) => {
      controller.enqueue(new TextEncoder().encode('data: {"done":true}\n\n'))
    })
    const res = await handleWardrobeDesign(req(body({ searchWeb: false })), ctx())
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(await drain(res.body)).toBe('data: {"done":true}\n\n')

    const [opts] = jest.mocked(runWardrobeInstructionDesign).mock.calls[0]
    expect(opts.location).toBe(LOCATION)
    expect(opts.apiKey).toBe('sk-test')
    expect(opts.input).toEqual({
      instructions: 'a business outfit',
      searchStores: true,
      searchWeb: false,
      priorProposal: null,
      revision: null,
    })
  })

  it('a general target skips the character check', async () => {
    const repos = makeRepos()
    const res = await handleWardrobeDesign(req(body({ target: { scope: 'general' } })), ctx(repos))
    await drain(res.body)
    expect(repos.characters.findByIdRaw).not.toHaveBeenCalled()
    expect(jest.mocked(resolveWardrobeLocation).mock.calls[0].slice(0, 2)).toEqual(['general', null])
  })

  it('turns a throw from the run into an error frame and closes the stream', async () => {
    jest.mocked(runWardrobeInstructionDesign).mockRejectedValueOnce(new Error('boom'))
    const res = await handleWardrobeDesign(req(body()), ctx())
    expect(await drain(res.body)).toContain('Aurora could not finish the design.')
  })
})
