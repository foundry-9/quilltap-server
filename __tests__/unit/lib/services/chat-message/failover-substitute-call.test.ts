/**
 * One substitute call (refactor 4.13, spec 1).
 *
 * Every stand-in — the same-profile retry, the Concierge's uncensored
 * understudy, each step of the fallback chain — is called by `callSubstitute`.
 * These pin what that buys:
 *
 *  - #181: a stand-in on another provider is sent tools in its own shape.
 *  - #182: a stand-in whose answer is only a tool call has answered.
 *  - A16: a client that goes away mid-substitute stops the walk; it is not a
 *    provider failure.
 *  - §8 decision 1: a stand-in whose tool mode differs from the turn's is
 *    passed over, never called with a system prompt built for another mode.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  ANTHROPIC_TOOLS,
  OPENAI_TOOLS,
  formatToolsForFixture,
} from '@/__tests__/helpers/failover-tools'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'

const streamCalls: Array<Record<string, unknown>> = []
let streamScripts: Array<() => AsyncGenerator<Record<string, unknown>>> = []

function scripted(opts: Record<string, unknown>): AsyncGenerator<Record<string, unknown>> {
  const idx = streamCalls.length
  streamCalls.push(opts)
  const script = streamScripts[idx]
  if (!script) throw new Error(`no script for stream call ${idx}`)
  return script()
}

// A closed controller makes `enqueue` throw, as a real ReadableStream's does.
// `safeEnqueue` is the real one's behaviour: swallow it and say so.
const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  try {
    controller.enqueue(chunk)
    return true
  } catch {
    return false
  }
})

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  detectToolCallsInResponse: (raw: unknown) => ((raw as { toolCalls?: unknown[] } | null)?.toolCalls ?? []),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (opts: Record<string, unknown>) => scripted(opts),
  encodeContentChunk: (_e: unknown, text: string) => ({ content: text }),
  encodeStatusEvent: (_e: unknown, payload: unknown) => ({ status: payload }),
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => mockSafeEnqueue(controller, chunk),
  applyReasoningChunk: jest.fn(),
  flushReasoningSegment: jest.fn(),
}))

const mockResolveUnderstudy = jest.fn<(lookup: Record<string, unknown>) => Promise<unknown>>()
jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredTextUnderstudy: (lookup: Record<string, unknown>) => mockResolveUnderstudy(lookup),
}))

jest.mock('@/lib/services/dangerous-content/current-state', () => ({
  readCurrentConciergeState: async (_chatId: unknown, snapshot?: string | null) => snapshot ?? 'moderated',
  readCurrentConciergeOnDuty: async (_userId: unknown, snapshot: boolean) => snapshot,
}))

jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: async () => null,
}))

jest.mock('@/lib/services/dangerous-content/refusal-ledger', () => ({
  recordModerationRefusal: async () => ({ count: 1, switched: false }),
}))

const { attemptHardErrorFailover, attemptEmptyResponseRecovery } =
  require('@/lib/services/chat-message/provider-failover.service') as typeof import('@/lib/services/chat-message/provider-failover.service')
const { buildRouteTrail } =
  require('@/lib/services/chat-message/route-trail') as typeof import('@/lib/services/chat-message/route-trail')

import { APIKeyError } from '@/lib/llm/errors'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { StreamingState } from '@/lib/services/chat-message/types'

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p-primary', userId: 'u1', name: 'Primary', provider: 'ANTHROPIC',
    transport: 'api', courierDeltaMode: true, apiKeyId: 'k1', baseUrl: null,
    modelName: 'claude-sonnet', parameters: { temperature: 0.3 }, isDefault: false, isCheap: false,
    allowWebSearch: false, useNativeWebSearch: false, allowToolUse: true,
    pseudoToolMode: 'auto', multiCharacterPrefill: null,
    fallbackProfileId: null, allowTierFallback: false,
    modelClass: 'Standard', maxContext: null, maxTokens: null,
    isDangerousCompatible: false, supportsImageUpload: false, tags: [], sortIndex: 0,
    totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0, messageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ConnectionProfile
}

function makeState(profile: ConnectionProfile): StreamingState {
  return {
    fullResponse: '', effectiveProfile: profile, effectiveApiKey: 'primary-key',
    usage: null, cacheUsage: null, attachmentResults: null, rawResponse: null,
    hasStartedStreaming: false, routeFailures: [], routeVia: 'primary',
    reasoningContent: '', reasoningSegments: [], reasoningFlushedLen: 0,
  } as unknown as StreamingState
}

function makeRepos(profiles: ConnectionProfile[]) {
  return {
    connections: {
      findById: async (id: string) => profiles.find((p) => p.id === id) ?? null,
      findByUserId: async (userId: string) => profiles.filter((p) => p.userId === userId),
      findApiKeyById: async (id: string) => ({ key_value: `key-for-${id}` }),
    },
  }
}

const answering = (text: string) => async function* () {
  yield { content: text }
  yield { done: true, rawResponse: { text } }
}
const callingATool = () => async function* () {
  yield { done: true, rawResponse: { toolCalls: [{ name: 'search', arguments: { query: 'the moor' } }] } }
}
const empty = () => async function* () {
  yield { done: true, rawResponse: {} }
}

const liveController = () => ({ enqueue: jest.fn() }) as any
const closedController = () => ({
  enqueue: jest.fn(() => { throw new TypeError('Invalid state: Controller is already closed') }),
}) as any

function hardErrorOpts(state: StreamingState, profiles: ConnectionProfile[], overrides: Record<string, unknown> = {}) {
  return {
    state,
    error: new APIKeyError('ANTHROPIC'),
    repos: makeRepos(profiles),
    context: {
      userId: 'u1', purpose: 'chat' as const, dangerous: false,
      needsVision: false, needsTools: true, alreadyTried: [],
    },
    formattedMessages: [{ role: 'user', content: 'What lies on the moor?' }],
    modelParams: { temperature: 0.3 },
    actualTools: ANTHROPIC_TOOLS,
    useNativeWebSearch: false,
    resolvedToolMode: 'native' as const,
    formatToolsFor: formatToolsForFixture,
    chatId: 'chat-1',
    character: { id: 'ch-1', name: 'Alice' },
    controller: liveController(),
    encoder: new TextEncoder(),
    ...overrides,
  }
}

describe('callSubstitute, through its three sites', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    streamCalls.length = 0
    streamScripts = []
  })

  describe('#181 — a stand-in gets tools in its own provider\'s shape', () => {
    it('the chain sends an OpenAI understudy OpenAI-shaped tools, not the Anthropic primary\'s', async () => {
      const primary = makeProfile({ fallbackProfileId: 'p-openai' })
      const understudy = makeProfile({ id: 'p-openai', name: 'OpenAI Understudy', provider: 'OPENAI', modelName: 'gpt-4o', parameters: { temperature: 0.9 } })
      const state = makeState(primary)
      streamScripts = [answering('The moor is quiet tonight.')]

      const result = await attemptHardErrorFailover(hardErrorOpts(state, [primary, understudy]))

      expect(result.recovered).toBe(true)
      expect(streamCalls).toHaveLength(1)
      expect(streamCalls[0].connectionProfile).toBe(understudy)
      expect(streamCalls[0].tools).toEqual(OPENAI_TOOLS)
      // Its own params, not the primary's.
      expect(streamCalls[0].modelParams).toEqual({ temperature: 0.9 })
    })

    it('the swap leaves the stand-in\'s own call shape on the state for the tool loops', async () => {
      const primary = makeProfile({ fallbackProfileId: 'p-openai' })
      const understudy = makeProfile({ id: 'p-openai', name: 'OpenAI Understudy', provider: 'OPENAI' })
      const state = makeState(primary)
      streamScripts = [answering('Here.')]

      await attemptHardErrorFailover(hardErrorOpts(state, [primary, understudy]))

      expect(state.effectiveProfile).toBe(understudy)
      expect(state.effectiveCall).toMatchObject({
        tools: OPENAI_TOOLS,
        toolMode: 'native',
        messages: [{ role: 'user', content: 'What lies on the moor?' }],
      })
    })

    it('the Concierge\'s uncensored reroute is sent tools in its own shape too', async () => {
      const primary = makeProfile()
      const uncensored = makeProfile({ id: 'p-uncensored', name: 'Frank Desk', provider: 'OPENAI_COMPATIBLE', isDangerousCompatible: true })
      mockResolveUnderstudy.mockResolvedValue({ profile: uncensored, apiKey: 'unc-key' })
      const state = makeState(primary)
      streamScripts = [answering('Frankly put.')]

      const refusal = Object.assign(new Error('400 rejected by our safety system'), { status: 400, code: 'content_policy_violation' })
      const result = await attemptHardErrorFailover({
        ...hardErrorOpts(state, [primary, uncensored]),
        error: refusal,
        conciergePolicy: resolveConciergeSettings({ conciergeSettings: { enabled: true } } as any),
      })

      expect(result.recovered).toBe(true)
      expect(streamCalls[0].connectionProfile).toBe(uncensored)
      expect(streamCalls[0].tools).toEqual(OPENAI_TOOLS)
    })
  })

  describe('#182 — a tool call is an answer', () => {
    it('the chain accepts an understudy whose only answer is a tool call, and calls nobody else', async () => {
      const primary = makeProfile({ fallbackProfileId: 'p-openai', allowTierFallback: false })
      const understudy = makeProfile({ id: 'p-openai', name: 'OpenAI Understudy', provider: 'OPENAI', fallbackProfileId: 'p-third' })
      const third = makeProfile({ id: 'p-third', name: 'Third', provider: 'OPENAI' })
      const state = makeState(primary)
      streamScripts = [callingATool(), answering('should never be asked')]

      const result = await attemptHardErrorFailover(hardErrorOpts(state, [primary, understudy, third]))

      expect(result.recovered).toBe(true)
      expect(streamCalls).toHaveLength(1)
      expect(state.effectiveProfile).toBe(understudy)
      expect(state.fullResponse).toBe('')
      expect(buildRouteTrail(state)).toEqual([
        expect.objectContaining({ profileId: 'p-primary', outcome: 'failed' }),
        expect.objectContaining({ profileId: 'p-openai', outcome: 'answered' }),
      ])
    })

    it('the same-profile retry of an empty body accepts a tool call and reports the recovery', async () => {
      const primary = makeProfile({ provider: 'OPENAI' })
      const state = makeState(primary)
      streamScripts = [callingATool()]

      const recovery = await attemptEmptyResponseRecovery({
        state,
        toolMessagesLength: 0,
        contentWasFlaggedDangerous: false,
        conciergePolicy: resolveConciergeSettings({ conciergeSettings: { enabled: false } } as any),
        connectionProfile: primary,
        formattedMessages: [{ role: 'user', content: 'Search the moor.' }],
        modelParams: {},
        actualTools: OPENAI_TOOLS,
        useNativeWebSearch: false,
        resolvedToolMode: 'native',
        formatToolsFor: formatToolsForFixture,
        userId: 'u1',
        chatId: 'chat-1',
        character: { id: 'ch-1', name: 'Alice' },
        controller: liveController(),
        encoder: new TextEncoder(),
        repos: makeRepos([primary]) as any,
        fallbackContext: { dangerous: false, needsVision: false, needsTools: true },
      })

      expect(recovery.recovered).toBe(true)
      expect(recovery.chainFallbackAttempted).toBe(false)
      expect(streamCalls).toHaveLength(1)
      expect(state.routeVia).toBe('retry')
    })
  })

  describe('A16 — the client going away is not a provider failure', () => {
    it('stops the walk: no further candidate is called and nothing is recorded against the stand-in', async () => {
      const primary = makeProfile({ fallbackProfileId: 'p-openai' })
      const understudy = makeProfile({ id: 'p-openai', name: 'OpenAI Understudy', provider: 'OPENAI', fallbackProfileId: 'p-third' })
      const third = makeProfile({ id: 'p-third', name: 'Third', provider: 'OPENAI' })
      const state = makeState(primary)
      streamScripts = [answering('Half a sent'), answering('should never be asked')]

      const result = await attemptHardErrorFailover({
        ...hardErrorOpts(state, [primary, understudy, third]),
        controller: closedController(),
      })

      expect(result.recovered).toBe(false)
      expect(result.clientGone).toBe(true)
      expect(streamCalls).toHaveLength(1)
      expect(state.routeFailures.map((f) => f.profileId)).toEqual(['p-primary'])
      // Whatever arrived stays for the partial preserver.
      expect(state.fullResponse).toBe('Half a sent')
    })
  })

  describe('§8 decision 1 — a stand-in in another tool mode is passed over', () => {
    it('never calls it, and records why against it', async () => {
      const primary = makeProfile({ fallbackProfileId: 'p-textblock' })
      const textBlock = makeProfile({ id: 'p-textblock', name: 'Text Block', provider: 'OPENAI', pseudoToolMode: 'text-block' })
      const state = makeState(primary)

      const result = await attemptHardErrorFailover(hardErrorOpts(state, [primary, textBlock]))

      expect(result.recovered).toBe(false)
      expect(streamCalls).toHaveLength(0)
      expect(result.attempts).toEqual([
        expect.objectContaining({ profileId: 'p-primary', trigger: 'auth' }),
        expect.objectContaining({ profileId: 'p-textblock', trigger: 'provider-error' }),
      ])
      expect(state.routeFailures).toEqual([
        expect.objectContaining({ profileId: 'p-primary', outcome: 'failed' }),
        expect.objectContaining({ profileId: 'p-textblock', outcome: 'failed' }),
      ])
    })
  })

  it('an empty stand-in is still empty: no prose and no tool call moves on', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-openai' })
    const understudy = makeProfile({ id: 'p-openai', name: 'OpenAI Understudy', provider: 'OPENAI' })
    const state = makeState(primary)
    streamScripts = [empty()]

    const result = await attemptHardErrorFailover(hardErrorOpts(state, [primary, understudy]))

    expect(result.recovered).toBe(false)
    expect(result.attempts.map((a) => a.trigger)).toEqual(['auth', 'empty-response'])
    expect(state.effectiveProfile).toBe(primary)
    expect(state.effectiveCall).toBeUndefined()
  })
})
