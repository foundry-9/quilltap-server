import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockStreamMessage = jest.fn()
const mockResolveProviderForDangerousContent = jest.fn()
const mockEncodeStatusEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => payload)
const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
})
const mockEncodeContentChunk = jest.fn((_encoder: TextEncoder, chunk: string) => chunk)

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
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: (...args: any[]) => mockResolveProviderForDangerousContent(...args),
}))

const {
  attemptEmptyResponseRecovery,
  getEmptyResponseReason,
} = require('@/lib/services/chat-message/provider-failover.service') as typeof import('@/lib/services/chat-message/provider-failover.service')

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

    const result = await attemptEmptyResponseRecovery({
      fullResponse: '',
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: false,
      dangerSettings: { mode: 'OFF', uncensoredTextProfileId: 'unc-1' } as any,
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
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
      hasStartedStreaming: false,
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
    })

    expect(result.sameProviderRetryAttempted).toBe(true)
    expect(result.uncensoredRetryAttempted).toBe(false)
    expect(result.fullResponse).toBe('Recovered reply')
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

    const result = await attemptEmptyResponseRecovery({
      fullResponse: '',
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: false,
      dangerSettings: { mode: 'AUTO_ROUTE', uncensoredTextProfileId: 'unc-1' } as any,
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
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
      hasStartedStreaming: false,
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
    })

    expect(result.sameProviderRetryAttempted).toBe(true)
    expect(result.uncensoredRetryAttempted).toBe(true)
    expect(result.fullResponse).toBe('Uncensored reply')
    expect(result.effectiveProfile).toEqual(uncensoredProfile)
    expect(result.effectiveApiKey).toBe('sk-uncensored')
  })

  it('skips the same-provider retry for content already flagged as dangerous', async () => {
    const result = await attemptEmptyResponseRecovery({
      fullResponse: '',
      toolMessagesLength: 0,
      contentWasFlaggedDangerous: true,
      dangerSettings: { mode: 'DETECT_ONLY', uncensoredTextProfileId: 'unc-1' } as any,
      effectiveProfile: baseProfile,
      effectiveApiKey: 'sk-safe',
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
      hasStartedStreaming: false,
      usage: null,
      cacheUsage: null,
      attachmentResults: null,
      rawResponse: null,
      thoughtSignature: undefined,
    })

    expect(result.sameProviderRetryAttempted).toBe(false)
    expect(mockStreamMessage).not.toHaveBeenCalled()
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
