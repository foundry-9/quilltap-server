/**
 * A thrown text refusal reroutes like an empty one (Concierge overhaul, phase
 * 1): the refusal is recorded on the trail as a refusal, the uncensored
 * understudy is asked when the Concierge policy allows failover, and only then the profile's chain —
 * cleared for the content.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockStreamMessageImpl = jest.fn<(opts: Record<string, unknown>) => AsyncGenerator<any>>()
const mockResolveUnderstudy = jest.fn<(lookup: Record<string, unknown>) => Promise<unknown>>()
const mockAnnounce = jest.fn<(params: Record<string, unknown>) => Promise<null>>(async () => null)

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (opts: Record<string, unknown>) => mockStreamMessageImpl(opts),
  encodeContentChunk: (_e: unknown, text: string) => text,
  encodeStatusEvent: (_e: unknown, payload: unknown) => payload,
  safeEnqueue: jest.fn(),
  applyReasoningChunk: jest.fn(),
  flushReasoningSegment: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredTextUnderstudy: (lookup: Record<string, unknown>) => mockResolveUnderstudy(lookup),
}))

const mockReadCurrentConciergeState = jest.fn(async (_chatId: unknown, snapshot?: string | null) => snapshot ?? 'moderated')
jest.mock('@/lib/services/dangerous-content/current-state', () => ({
  readCurrentConciergeState: (chatId: unknown, snapshot?: string | null) => mockReadCurrentConciergeState(chatId, snapshot),
}))

jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: (params: Record<string, unknown>) => mockAnnounce(params),
}))

const { attemptHardErrorFailover } =
  require('@/lib/services/chat-message/provider-failover.service') as typeof import('@/lib/services/chat-message/provider-failover.service')
const { buildRouteTrail } =
  require('@/lib/services/chat-message/route-trail') as typeof import('@/lib/services/chat-message/route-trail')

import type { ConnectionProfile } from '@/lib/schemas/types'
import type { StreamingState } from '@/lib/services/chat-message/types'
import { resolveConciergeSettings, type ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: 'p-primary', userId: 'u1', name: 'Primary', provider: 'OPENAI',
    transport: 'api', courierDeltaMode: true, apiKeyId: 'k1', baseUrl: null,
    modelName: 'gpt-4o', parameters: {}, isDefault: false, isCheap: false,
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

function answering(text: string) {
  return async function* () {
    yield { content: text }
    yield { done: true }
  }
}

/** On duty, Moderated: a refusal may fail over to the uncensored desk. */
const autoRoute = resolveConciergeSettings({ conciergeSettings: { enabled: true } } as any)
/** Off duty: no failover. */
const offDuty = resolveConciergeSettings({ conciergeSettings: { enabled: false } } as any)

function opts(state: StreamingState, profiles: ConnectionProfile[], error: unknown, conciergePolicy?: ResolvedConciergePolicy) {
  return {
    state,
    error,
    conciergePolicy,
    repos: makeRepos(profiles),
    context: {
      userId: 'u1', purpose: 'chat' as const, dangerous: false,
      needsVision: false, needsTools: false, alreadyTried: [],
    },
    formattedMessages: [{ role: 'user', content: 'a portrait in a bikini' }],
    modelParams: {},
    actualTools: [],
    useNativeWebSearch: false,
    chatId: 'chat-1',
    character: { id: 'ch-1', name: 'Alice' },
    controller: { enqueue: jest.fn() } as any,
    encoder: new TextEncoder(),
  }
}

const policyError = () => Object.assign(
  new Error('400 Your request was rejected as a result of our safety system.'),
  { status: 400, code: 'content_policy_violation' },
)

describe('attemptHardErrorFailover — thrown refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records the refusal, asks the uncensored understudy first, and credits the Concierge', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const chainUnderstudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const uncensored = makeProfile({ id: 'p-uncensored', name: 'Frank Desk', provider: 'GROK', isDangerousCompatible: true })
    const state = makeState(primary)
    mockResolveUnderstudy.mockResolvedValue({ profile: uncensored, apiKey: 'sk-frank' })
    mockStreamMessageImpl.mockImplementation(answering('Here she is.') as never)

    const result = await attemptHardErrorFailover(opts(state, [primary, chainUnderstudy, uncensored], policyError(), autoRoute))

    expect(result.recovered).toBe(true)
    expect(state.effectiveProfile.id).toBe('p-uncensored')
    expect(state.fullResponse).toBe('Here she is.')
    // The chain's own understudy was never called: the uncensored desk answered first.
    expect(mockStreamMessageImpl).toHaveBeenCalledTimes(1)
    expect(mockResolveUnderstudy).toHaveBeenCalledWith(expect.objectContaining({
      exclude: expect.arrayContaining(['p-primary']),
    }))
    expect(buildRouteTrail(state)!.map((a) => [a.profileName, a.via, a.outcome, a.trigger, a.evidence])).toEqual([
      ['Primary', 'primary', 'refused', 'moderation-refusal', 'provider-code'],
      ['Frank Desk', 'concierge', 'answered', undefined, undefined],
    ])
  })

  it('walks the chain, cleared for the content, when the uncensored understudy also fails', async () => {
    const primary = makeProfile({ fallbackProfileId: 'p-understudy' })
    const chainUnderstudy = makeProfile({ id: 'p-understudy', name: 'Understudy' })
    const uncensored = makeProfile({ id: 'p-uncensored', name: 'Frank Desk' })
    const state = makeState(primary)
    mockResolveUnderstudy.mockResolvedValue({ profile: uncensored, apiKey: 'sk-frank' })
    let call = 0
    mockStreamMessageImpl.mockImplementation(((_o: Record<string, unknown>) => {
      call += 1
      if (call === 1) {
        return (async function* () { throw new Error('503 Service Unavailable') })()
      }
      return answering('The understudy obliges.')()
    }) as never)

    const result = await attemptHardErrorFailover(opts(state, [primary, chainUnderstudy, uncensored], policyError(), autoRoute))

    expect(result.recovered).toBe(true)
    expect(state.effectiveProfile.id).toBe('p-understudy')
    expect(buildRouteTrail(state)!.map((a) => [a.profileName, a.outcome])).toEqual([
      ['Primary', 'refused'],
      ['Frank Desk', 'failed'],
      ['Understudy', 'answered'],
    ])
  })

  it('announces refusal-no-understudy when there is nobody to ask, then walks the chain', async () => {
    const primary = makeProfile()
    const state = makeState(primary)
    mockResolveUnderstudy.mockResolvedValue(null)

    const result = await attemptHardErrorFailover(opts(state, [primary], policyError(), autoRoute))

    expect(result.recovered).toBe(false)
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      kind: 'refusal-no-understudy',
      details: expect.objectContaining({ purpose: 'text', refusingProvider: 'OPENAI' }),
    }))
  })

  it('does not ask the uncensored desk when the policy does not allow failover', async () => {
    const primary = makeProfile()
    const state = makeState(primary)

    await attemptHardErrorFailover(opts(state, [primary], policyError(), offDuty))

    expect(mockResolveUnderstudy).not.toHaveBeenCalled()
    expect(state.routeFailures[0]).toMatchObject({ outcome: 'refused', trigger: 'moderation-refusal' })
  })

  it('reads the state at refusal time: a chat locked while the provider was thinking is not rerouted', async () => {
    const primary = makeProfile()
    const state = makeState(primary)
    mockReadCurrentConciergeState.mockResolvedValueOnce('locked')

    await attemptHardErrorFailover({ ...opts(state, [primary], policyError(), autoRoute), conciergeState: 'moderated' })

    expect(mockReadCurrentConciergeState).toHaveBeenCalledWith('chat-1', 'moderated')
    expect(mockResolveUnderstudy).not.toHaveBeenCalled()
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'refusal-not-permitted',
      details: expect.objectContaining({ reason: 'locked' }),
    }))
  })

  it('never asks the uncensored desk on a Locked chat, even with the Concierge on duty, and says why', async () => {
    const primary = makeProfile()
    const state = makeState(primary)

    await attemptHardErrorFailover({ ...opts(state, [primary], policyError(), autoRoute), conciergeState: 'locked' })

    expect(mockResolveUnderstudy).not.toHaveBeenCalled()
    expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'refusal-not-permitted',
      details: expect.objectContaining({ purpose: 'text', reason: 'locked' }),
    }))
    expect(state.routeFailures[0]).toMatchObject({ outcome: 'refused', trigger: 'moderation-refusal' })
  })
})
