/**
 * The attention strip's five conditions, in their fixed order, read from the
 * same endpoints the cards use.
 */

import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { findTroubledProfiles, useAttentionChips } from '@/components/settings/AttentionStrip'
import { DEFAULT_CONCIERGE_SETTINGS } from '@/components/settings/chat-settings/types'

const mockContext = { current: {} as Record<string, unknown> }
jest.mock('@/components/settings/chat-settings/ChatSettingsProvider', () => ({
  useChatSettingsContext: () => mockContext.current,
}))
jest.mock('@/components/ui/icon', () => ({ Icon: () => null }))

interface Fixture {
  apiKeys?: unknown[]
  providers?: unknown[]
  remaining?: number
  failed?: number
  pluginErrors?: unknown[]
}

// jest.setup.ts assigns `global.fetch` directly, so jest-fetch-mock's helpers
// are a no-op here; stub fetch ourselves and restore it after each test.
const realFetch = global.fetch
let fetchStub: jest.Mock

function route(f: Fixture) {
  fetchStub = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/api/v1/api-keys')
      ? { apiKeys: f.apiKeys ?? [] }
      : url.includes('/api/v1/providers')
        ? { providers: f.providers ?? [{ name: 'OPENAI', configRequirements: { requiresApiKey: true } }] }
        : url.includes('backfill-embeddings')
          ? { progress: { remaining: f.remaining ?? 0, inFlight: 0 } }
          : url.includes('tasks-queue')
            ? { stats: { failed: f.failed ?? 0 } }
            : url.includes('/api/v1/plugins')
              ? { plugins: [], errors: f.pluginErrors ?? [] }
              : {}
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
  })
  global.fetch = fetchStub as unknown as typeof fetch
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    settings: { conciergeSettings: DEFAULT_CONCIERGE_SETTINGS },
    loading: false,
    loadingProfiles: false,
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    ...overrides,
  }
}

async function chipsFor(f: Fixture, ctx = context()) {
  route(f)
  mockContext.current = ctx
  const { result } = renderHook(() => useAttentionChips(), { wrapper: createQueryWrapper().wrapper })
  await waitFor(() => expect(result.current.ready).toBe(true))
  await waitFor(() => expect(fetchStub.mock.calls.length).toBeGreaterThanOrEqual(5))
  return result
}

describe('findTroubledProfiles', () => {
  const providers = [
    { name: 'OPENAI', configRequirements: { requiresApiKey: true } },
    { name: 'OLLAMA', configRequirements: { requiresApiKey: false } },
  ]

  it('flags a vanished key, a required key never given, and an absent provider plugin', () => {
    const troubled = findTroubledProfiles({
      apiKeys: [{ id: 'k1', provider: 'OPENAI' }],
      providers,
      connectionProfiles: [
        { id: 'ok', name: 'Fine', provider: 'OPENAI', apiKeyId: 'k1' },
        { id: 'gone', name: 'Gone', provider: 'OPENAI', apiKeyId: 'k-deleted' },
        { id: 'none', name: 'Keyless', provider: 'OPENAI', apiKeyId: null },
        { id: 'local', name: 'Local', provider: 'OLLAMA' },
        { id: 'orphan', name: 'Orphan', provider: 'MISTRAL', apiKeyId: 'k1' },
      ],
      imageProfiles: [{ id: 'img', name: 'Painter', provider: 'OPENAI', apiKeyId: 'k-deleted' }],
      embeddingProfiles: [{ id: 'emb', name: 'Builtin', provider: 'BUILTIN' }],
    })
    expect(troubled.map((p) => p.id)).toEqual(['gone', 'none', 'orphan', 'img'])
  })

  it('says nothing until the keys have loaded', () => {
    expect(
      findTroubledProfiles({
        apiKeys: undefined,
        providers,
        connectionProfiles: [{ id: 'gone', name: 'Gone', provider: 'OPENAI', apiKeyId: 'x' }],
        imageProfiles: [],
        embeddingProfiles: [],
      }),
    ).toEqual([])
  })
})

describe('useAttentionChips', () => {
  afterEach(() => {
    global.fetch = realFetch
  })

  it('lights nothing in a healthy house', async () => {
    const result = await chipsFor({})
    expect(result.current.chips).toEqual([])
  })

  it('lights all five in the fixed order, each pointing at its card', async () => {
    const result = await chipsFor(
      { remaining: 3, failed: 1, pluginErrors: [{ plugin: 'x' }] },
      context({
        settings: { conciergeSettings: { ...DEFAULT_CONCIERGE_SETTINGS, enabled: false } },
        connectionProfiles: [{ id: 'p', name: 'Prim', provider: 'OPENAI', apiKeyId: 'gone' }],
      }),
    )
    await waitFor(() => expect(result.current.chips).toHaveLength(5))
    expect(result.current.chips.map((c) => [c.id, c.card, c.group])).toEqual([
      ['profile-key', 'providers', 'connections'],
      ['concierge-off-duty', 'on-duty', 'moderation'],
      ['memory-backfill', 'memory-backfill', 'context-memory'],
      ['failed-task', 'tasks-queue', 'data-maintenance'],
      ['plugin-error', 'plugins', 'data-maintenance'],
    ])
    expect(result.current.chips[0].label).toBe('“Prim” is missing its key or provider')
    expect(result.current.chips[0].provider).toBe('OPENAI')
    expect(result.current.chips[2].label).toBe('3 memories await an embedding')
  })
})
