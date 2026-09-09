import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockStreamMessage = jest.fn()
const mockResolveProviderForDangerousContent = jest.fn()
const mockEncodeStatusEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => payload)
const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
})
const mockEncodeContentChunk = jest.fn((_encoder: TextEncoder, chunk: string) => chunk)
const mockProcessFileAttachmentFallback = jest.fn()

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: (...args: any[]) => mockStreamMessage(...args),
  encodeStatusEvent: (encoder: TextEncoder, payload: unknown) => mockEncodeStatusEvent(encoder, payload),
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => mockSafeEnqueue(controller, chunk),
  encodeContentChunk: (encoder: TextEncoder, chunk: string) => mockEncodeContentChunk(encoder, chunk),
  applyReasoningChunk: jest.fn(),
  flushReasoningSegment: jest.fn(),
  nextTurnSeq: (s: { nextTurnSeq?: number }) => {
    const n = s.nextTurnSeq ?? 0
    s.nextTurnSeq = n + 1
    return n
  },
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: (...args: any[]) => mockResolveProviderForDangerousContent(...args),
}))

const mockIsModerationFinishReason = jest.fn((_r?: string | null) => false)

jest.mock('@/lib/llm/moderation-finish-reason', () => ({
  describeModerationRefusal: jest.fn(() => null),
  isModerationFinishReason: (r?: string | null) => mockIsModerationFinishReason(r),
}))

// The reroute re-runs the attachment decision against the profile it actually
// ends up calling (bug 106). Only the describer is stubbed; the predicate that
// decides *whether* to describe is the real one, since that is the half the
// bug got wrong.
jest.mock('@/lib/chat/file-attachment-fallback', () => {
  const actual = jest.requireActual('@/lib/chat/file-attachment-fallback') as Record<string, unknown>
  return {
    ...actual,
    processFileAttachmentFallback: (...args: any[]) => mockProcessFileAttachmentFallback(...args),
  }
})

const {
  attemptEmptyResponseRecovery,
  getEmptyResponseReason,
} = require('@/lib/services/chat-message/provider-failover.service') as typeof import('@/lib/services/chat-message/provider-failover.service')

const { buildRouteTrail } =
  require('@/lib/services/chat-message/route-trail') as typeof import('@/lib/services/chat-message/route-trail')

const makeStream = (chunks: Array<Record<string, unknown>>) => (async function* () {
  for (const chunk of chunks) {
    yield chunk
  }
})()

describe('provider-failover.service', () => {
  const encoder = new TextEncoder()
  const controller = { enqueue: jest.fn() } as any
  const baseProfile = {
    id: 'safe-1',
    name: 'Safe Profile',
    provider: 'OPENAI',
    modelName: 'gpt-4.1',
    isDangerousCompatible: false,
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retries the same provider for non-dangerous empty responses and captures the streamed retry output', async () => {
    mockStreamMessage.mockReturnValueOnce(makeStream([
      { content: 'Recovered reply' },
      { done: true, usage: { totalTokens: 8 }, rawResponse: { retry: 1 } },
    ]))

    const state = {
      fullResponse: '',
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
      hasStartedStreaming: false,
      routeFailures: [],
      routeVia: 'primary' as const,
    }

    const result = await attemptEmptyResponseRecovery({
      state,
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: false,
      dangerSettings: { mode: 'OFF', uncensoredTextProfileId: 'unc-1' } as any,
      connectionProfile: baseProfile,
      formattedMessages: [{ role: 'user', content: 'Hello' }],
      modelParams: {},
      actualTools: [],
      useNativeWebSearch: false,
      userId: 'user-1',
      chatId: 'chat-1',
      character: { id: 'char-1', name: 'Alice' } as any,
      controller,
      encoder,
      preGeneratedAssistantMessageId: 'msg-1',
    })

    expect(result.sameProviderRetryAttempted).toBe(true)
    expect(result.uncensoredRetryAttempted).toBe(false)
    expect(state.fullResponse).toBe('Recovered reply')
    expect(controller.enqueue).toHaveBeenCalledWith('Recovered reply')
  })

  it('falls back to the uncensored provider when the safe provider stays empty', async () => {
    const uncensoredProfile = {
      id: 'unc-1',
      name: 'Uncensored Profile',
      provider: 'LOCAL',
      modelName: 'llama-uncensored',
      isDangerousCompatible: true,
    }

    mockStreamMessage
      .mockReturnValueOnce(makeStream([
        { done: true, usage: { totalTokens: 5 }, rawResponse: { retry: 'same' } },
      ]))
      .mockReturnValueOnce(makeStream([
        { content: 'Uncensored reply' },
        { done: true, usage: { totalTokens: 9 }, rawResponse: { retry: 'uncensored' } },
      ]))

    ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
      rerouted: true,
      connectionProfile: uncensoredProfile,
      apiKey: 'sk-uncensored',
      reason: 'rerouted to uncensored profile',
    })

    const state = {
      fullResponse: '',
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
      hasStartedStreaming: false,
      routeFailures: [],
      routeVia: 'primary' as const,
    }

    const result = await attemptEmptyResponseRecovery({
      state,
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: false,
      dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-1' } as any,
      connectionProfile: baseProfile,
      formattedMessages: [{ role: 'user', content: 'Hello' }],
      modelParams: {},
      actualTools: [],
      useNativeWebSearch: false,
      userId: 'user-1',
      chatId: 'chat-1',
      character: { id: 'char-1', name: 'Alice' } as any,
      controller,
      encoder,
      preGeneratedAssistantMessageId: 'msg-1',
    })

    expect(result.sameProviderRetryAttempted).toBe(true)
    expect(result.uncensoredRetryAttempted).toBe(true)
    expect(state.fullResponse).toBe('Uncensored reply')
    expect(state.effectiveProfile).toEqual(uncensoredProfile)
    expect(state.effectiveApiKey).toBe('sk-uncensored')
  })

  it('skips the same-provider retry for content already flagged as dangerous', async () => {
    const state = {
      fullResponse: '',
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
      hasStartedStreaming: false,
      routeFailures: [],
      routeVia: 'primary' as const,
    }

    const result = await attemptEmptyResponseRecovery({
      state,
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: true,
      dangerSettings: { mode: 'DETECT_ONLY', uncensoredTextProfileId: 'unc-1' } as any,
      connectionProfile: baseProfile,
      formattedMessages: [{ role: 'user', content: 'Hello' }],
      modelParams: {},
      actualTools: [],
      useNativeWebSearch: false,
      userId: 'user-1',
      chatId: 'chat-1',
      character: { id: 'char-1', name: 'Alice' } as any,
      controller,
      encoder,
      preGeneratedAssistantMessageId: 'msg-1',
    })

    expect(result.sameProviderRetryAttempted).toBe(false)
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  describe('the reroute re-decides this turn\'s attachments (bug 106)', () => {
    const imageAttachment = {
      id: 'file-1',
      filename: 'i-made-you-something.png',
      mimeType: 'image/png',
      size: 12345,
      data: 'BASE64BYTES',
    }

    const visionPrimary = {
      ...baseProfile,
      id: 'vision-1',
      name: 'Z.AI GLM',
      provider: 'Z_AI',
      modelName: 'glm-5.3-flash',
      supportsImageUpload: true,
    } as any

    const textOnlyUncensored = {
      id: 'unc-text',
      name: 'DeepSeek V4 Flash',
      provider: 'DEEPSEEK',
      modelName: 'deepseek-v4-flash-latest',
      supportsImageUpload: false,
      isDangerousCompatible: true,
    } as any

    const messagesWithImage = () => [
      { role: 'user', content: 'I made you something' as string, attachments: [imageAttachment] },
    ]

    const freshState = () => ({
      fullResponse: '',
      effectiveProfile: visionPrimary,
      effectiveApiKey: 'sk-vision',
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
      hasStartedStreaming: false,
      routeFailures: [],
      routeVia: 'primary' as const,
    })

    const repos = {
      connections: {
        findById: jest.fn(),
        findByUserId: jest.fn(async () => []),
        findApiKeyById: jest.fn(async () => null),
      },
      chatSettings: { findByUserId: jest.fn(async () => null) },
    } as any

    it('replaces bytes the substitute cannot read with their description', async () => {
      mockProcessFileAttachmentFallback.mockResolvedValue({
        type: 'image_description',
        imageDescription: 'A hand-lettered card reading "for you".',
        processingMetadata: { originalFilename: imageAttachment.filename },
      })

      mockStreamMessage
        .mockReturnValueOnce(makeStream([{ done: true }]))
        .mockReturnValueOnce(makeStream([
          { content: 'Thank you.' },
          { done: true },
        ]))

      ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
        rerouted: true,
        connectionProfile: textOnlyUncensored,
        apiKey: 'sk-unc',
        reason: 'configured uncensored profile',
      })

      const state = freshState()

      await attemptEmptyResponseRecovery({
        state,
        toolMessagesLength: 0,
        contentWasFlaggedDangerous: false,
        dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-text' } as any,
        connectionProfile: visionPrimary,
        formattedMessages: messagesWithImage(),
        modelParams: {},
        actualTools: [],
        useNativeWebSearch: false,
        userId: 'user-1',
        chatId: 'chat-1',
        character: { id: 'char-1', name: 'Abigail' } as any,
        controller,
        encoder,
        preGeneratedAssistantMessageId: 'msg-1',
        repos,
      })

      // The same-provider retry keeps the array it was built with; only the
      // reroute re-decides.
      const [firstCall] = (mockStreamMessage as jest.Mock).mock.calls[0] as any[]
      expect(firstCall.messages[0].attachments).toEqual([imageAttachment])

      const [rerouteCall] = (mockStreamMessage as jest.Mock).mock.calls[1] as any[]
      expect(rerouteCall.connectionProfile).toBe(textOnlyUncensored)
      expect(rerouteCall.messages[0].attachments).toBeUndefined()
      expect(rerouteCall.messages[0].content).toContain('A hand-lettered card')
      expect(rerouteCall.messages[0].content).toContain('I made you something')

      expect(state.fullResponse).toBe('Thank you.')
    })

    it('tells the router what the turn is carrying', async () => {
      mockStreamMessage.mockReturnValue(makeStream([{ done: true }]))
      ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
        rerouted: false,
        connectionProfile: visionPrimary,
        apiKey: 'sk-vision',
        reason: 'no uncensored provider available',
      })

      await attemptEmptyResponseRecovery({
        state: freshState(),
        toolMessagesLength: 0,
        contentWasFlaggedDangerous: false,
        dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-text' } as any,
        connectionProfile: visionPrimary,
        formattedMessages: messagesWithImage(),
        modelParams: {},
        actualTools: [],
        useNativeWebSearch: false,
        userId: 'user-1',
        chatId: 'chat-1',
        character: { id: 'char-1', name: 'Abigail' } as any,
        controller,
        encoder,
        repos,
      })

      expect(mockResolveProviderForDangerousContent).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'user-1', ['image/png'],
      )
    })

    it('leaves the array alone when the substitute can read the images too', async () => {
      // A vision model on a plugin that can actually put bytes on the wire —
      // both halves of bug 91's predicate, not just the operator's tick.
      const visionUncensored = {
        ...textOnlyUncensored,
        id: 'unc-vision',
        provider: 'ANTHROPIC',
        modelName: 'claude-opus-5',
        supportsImageUpload: true,
      }

      mockStreamMessage
        .mockReturnValueOnce(makeStream([{ done: true }]))
        .mockReturnValueOnce(makeStream([{ content: 'Lovely.' }, { done: true }]))

      ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
        rerouted: true,
        connectionProfile: visionUncensored,
        apiKey: 'sk-unc',
        reason: 'configured uncensored profile',
      })

      await attemptEmptyResponseRecovery({
        state: freshState(),
        toolMessagesLength: 0,
        contentWasFlaggedDangerous: false,
        dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-vision' } as any,
        connectionProfile: visionPrimary,
        formattedMessages: messagesWithImage(),
        modelParams: {},
        actualTools: [],
        useNativeWebSearch: false,
        userId: 'user-1',
        chatId: 'chat-1',
        character: { id: 'char-1', name: 'Abigail' } as any,
        controller,
        encoder,
        repos,
      })

      const [rerouteCall] = (mockStreamMessage as jest.Mock).mock.calls[1] as any[]
      expect(rerouteCall.messages[0].attachments).toEqual([imageAttachment])
      expect(mockProcessFileAttachmentFallback).not.toHaveBeenCalled()
    })
  })

  it('builds the expected empty-response reason for failover outcomes', () => {
    expect(getEmptyResponseReason({
      uncensoredRetryAttempted: true,
      sameProviderRetryAttempted: true,
      contentWasFlaggedDangerous: false,
    })).toContain('uncensored provider also returned empty')

    expect(getEmptyResponseReason({
      uncensoredRetryAttempted: false,
      sameProviderRetryAttempted: false,
      contentWasFlaggedDangerous: true,
    })).toContain('Concierge flagged this content as dangerous')
  })
})

/**
 * The route trail left on the message by the empty-response recovery: who was
 * asked, in what order, and on what evidence a refusal was called.
 */
describe('provider-failover.service — the route trail', () => {
  const encoder = new TextEncoder()
  const controller = { enqueue: jest.fn() } as any
  const baseProfile = {
    id: 'safe-1',
    name: 'Safe Profile',
    provider: 'OPENAI',
    modelName: 'gpt-4.1',
    isDangerousCompatible: false,
  } as any
  const uncensoredProfile = {
    id: 'unc-1',
    name: 'Uncensored Profile',
    provider: 'LOCAL',
    modelName: 'llama-uncensored',
    isDangerousCompatible: true,
  } as any

  const freshState = (overrides: Record<string, unknown> = {}) => ({
    fullResponse: '',
    effectiveProfile: baseProfile,
    effectiveApiKey: 'sk-safe',
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: null,
    thoughtSignature: undefined,
    hasStartedStreaming: false,
    routeFailures: [],
    routeVia: 'primary' as const,
    ...overrides,
  })

  const recover = (state: any, over: Record<string, unknown> = {}) => attemptEmptyResponseRecovery({
    state,
    toolMessagesLength: 0,
    contentWasFlaggedDangerous: false,
    dangerSettings: { mode: 'OFF', uncensoredTextProfileId: 'unc-1' } as any,
    connectionProfile: baseProfile,
    formattedMessages: [{ role: 'user', content: 'Hello' }],
    modelParams: {},
    actualTools: [],
    useNativeWebSearch: false,
    userId: 'user-1',
    chatId: 'chat-1',
    character: { id: 'char-1', name: 'Alice' } as any,
    controller,
    encoder,
    preGeneratedAssistantMessageId: 'msg-1',
    ...over,
  } as any)

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsModerationFinishReason.mockReturnValue(false)
  })

  it('writes nothing when the turn produced an answer of its own', async () => {
    const state = freshState({ fullResponse: 'All is well.' })

    await recover(state)

    expect(buildRouteTrail(state)).toBeNull()
  })

  it('records the empty primary, then the same-profile retry that answered', async () => {
    mockStreamMessage.mockReturnValueOnce(makeStream([
      { content: 'Recovered reply' },
      { done: true, rawResponse: { retry: 1 } },
    ]))
    const state = freshState()

    await recover(state)

    expect(state.routeVia).toBe('retry')
    expect(buildRouteTrail(state)).toEqual([
      expect.objectContaining({
        profileId: 'safe-1', via: 'primary', outcome: 'failed', trigger: 'empty-response',
      }),
      expect.objectContaining({
        profileId: 'safe-1', via: 'retry', outcome: 'answered',
      }),
    ])
  })

  it('calls an empty body on a flagged turn a refusal, inferred, and credits the Concierge\'s stand-in', async () => {
    mockStreamMessage.mockReturnValueOnce(makeStream([
      { content: 'Uncensored reply' },
      { done: true, rawResponse: { retry: 'uncensored' } },
    ]))
    ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
      rerouted: true,
      connectionProfile: uncensoredProfile,
      apiKey: 'sk-uncensored',
      reason: 'rerouted to uncensored profile',
    })
    const state = freshState()

    await recover(state, {
      contentWasFlaggedDangerous: true,
      dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-1' } as any,
    })

    expect(state.routeVia).toBe('concierge')
    expect(buildRouteTrail(state)).toEqual([
      expect.objectContaining({
        profileId: 'safe-1', via: 'primary', outcome: 'refused',
        trigger: 'moderation-refusal', evidence: 'inferred',
      }),
      expect.objectContaining({
        profileId: 'unc-1', profileName: 'Uncensored Profile', via: 'concierge', outcome: 'answered',
      }),
    ])
  })

  it('names the uncensored profile even when it too comes back empty', async () => {
    // Same-profile retry, then the uncensored reroute — both silent.
    mockStreamMessage
      .mockReturnValueOnce(makeStream([{ done: true, rawResponse: { retry: 'same' } }]))
      .mockReturnValueOnce(makeStream([{ done: true, rawResponse: { retry: 'uncensored' } }]))
    ;(mockResolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
      rerouted: true,
      connectionProfile: uncensoredProfile,
      apiKey: 'sk-uncensored',
      reason: 'rerouted to uncensored profile',
    })
    const state = freshState()

    await recover(state, {
      dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-1' } as any,
    })

    // The existing code never swaps `effectiveProfile` for an uncensored
    // profile that answers nothing, so this row is the ONLY record of it.
    expect(state.effectiveProfile.id).toBe('safe-1')
    expect(state.routeFailures.map((a: any) => [a.profileName, a.via, a.outcome])).toEqual([
      ['Safe Profile', 'primary', 'failed'],
      ['Safe Profile', 'retry', 'failed'],
      ['Uncensored Profile', 'concierge', 'failed'],
    ])
  })

  it('takes a provider\'s stated moderation stop as a refusal on the evidence of the finish reason', async () => {
    mockIsModerationFinishReason.mockReturnValue(true)
    const state = freshState({ rawResponse: { choices: [{ finish_reason: 'content_filter' }] } })

    await recover(state, { dangerSettings: { mode: 'OFF' } as any })

    expect(state.routeFailures[0]).toMatchObject({
      outcome: 'refused',
      trigger: 'moderation-refusal',
      evidence: 'finish-reason',
      detail: 'finish_reason: content_filter',
    })
  })

  it('carries `via: concierge` on the opening row when the pre-call reroute had already swapped the profile', async () => {
    mockStreamMessage.mockReturnValueOnce(makeStream([
      { content: 'Recovered reply' },
      { done: true },
    ]))
    const state = freshState({ effectiveProfile: uncensoredProfile, routeVia: 'concierge' as const })

    await recover(state)

    expect(state.routeFailures[0]).toMatchObject({ profileId: 'unc-1', via: 'concierge' })
  })
})
