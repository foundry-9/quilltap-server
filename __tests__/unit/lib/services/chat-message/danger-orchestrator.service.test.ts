import { resolveMessageDangerState } from '@/lib/services/chat-message/danger-orchestrator.service'
import * as gatekeeperService from '@/lib/services/dangerous-content/gatekeeper.service'
import * as providerRoutingService from '@/lib/services/dangerous-content/provider-routing.service'
import * as streamingService from '@/lib/services/chat-message/streaming.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  classifyContent: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  encodeStatusEvent: jest.fn((_encoder: TextEncoder, payload: unknown) => payload),
  safeEnqueue: jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
    controller.enqueue(chunk)
  }),
}))

describe('danger-orchestrator.service', () => {
  const encoder = new TextEncoder()
  const controller = { enqueue: jest.fn() } as any

  const baseProfile = {
    id: 'profile-1',
    name: 'Safe Profile',
    provider: 'OPENAI',
    modelName: 'gpt-4.1',
    isDangerousCompatible: false,
  } as any

  // The real resolver runs: each test states the global Concierge settings
  // and the chat's state, and the policy follows.
  const conciergeOn = (preScreen: Record<string, unknown> = {}) => ({
    conciergeSettings: {
      enabled: true,
      preScreen: { enabled: true, threshold: 0.7, scanTextChat: true, scanImagePrompts: true, scanImageGeneration: false, summaryClassification: false, ...preScreen },
    },
  }) as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the original profile unchanged when the Concierge is off duty', async () => {

    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: { conciergeSettings: { enabled: false, preScreen: { enabled: true, scanTextChat: true } } } as any,
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'Hello world',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

    expect(result.dangerFlags).toBeUndefined()
    expect(result.effectiveProfile).toBe(baseProfile)
    expect(result.effectiveApiKey).toBe('sk-safe')
    expect(result.conciergePolicy.source).toBe('off-duty')
    expect(gatekeeperService.classifyContent).not.toHaveBeenCalled()
  })

  it('does not pre-screen a Moderated chat when the pre-screen is off', async () => {
    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: conciergeOn({ enabled: false }),
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'Hello world',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

    expect(result.dangerFlags).toBeUndefined()
    expect(result.effectiveProfile).toBe(baseProfile)
    expect(gatekeeperService.classifyContent).not.toHaveBeenCalled()
    expect(providerRoutingService.resolveProviderForDangerousContent).not.toHaveBeenCalled()
  })

  it('synthesizes flags for Unmoderated chats and routes them direct to the uncensored desk', async () => {
    const uncensoredProfile = {
      id: 'profile-2',
      name: 'Uncensored',
      provider: 'LOCAL',
      modelName: 'llama-uncensored',
      isDangerousCompatible: true,
    }

    ;(providerRoutingService.resolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
      rerouted: true,
      connectionProfile: uncensoredProfile,
      apiKey: 'sk-uncensored',
      reason: 'matched uncensored profile',
    })

    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { conciergeMode: 'unmoderated', isDangerousChat: true, dangerCategories: ['nsfw'] } as any,
      chatSettings: conciergeOn(),
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'dangerous request',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

    expect(result.effectiveProfile).toEqual(uncensoredProfile)
    expect(result.effectiveApiKey).toBe('sk-uncensored')
    expect(result.dangerFlags).toEqual([
      expect.objectContaining({
        category: 'nsfw',
        wasRerouted: true,
        reroutedProvider: 'LOCAL',
        reroutedModel: 'llama-uncensored',
      }),
    ])
    expect(result.conciergePolicy.routeDirect).toBe(true)
    expect(providerRoutingService.resolveProviderForDangerousContent).toHaveBeenCalledWith(
      baseProfile,
      'sk-safe',
      expect.objectContaining({ routeDirect: true, state: 'unmoderated' }),
      'user-1',
    )
    expect(gatekeeperService.classifyContent).not.toHaveBeenCalled()
  })

  it('classifies dangerous content, emits status events, and records a classification system message', async () => {
    const repos = { chats: { addMessage: jest.fn().mockResolvedValue(undefined) } } as any

    ;(providerRoutingService.resolveProviderForDangerousContent as jest.Mock).mockResolvedValue({
      rerouted: false,
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      reason: 'no uncensored profile',
    })
    ;(gatekeeperService.classifyContent as jest.Mock).mockResolvedValue({
      isDangerous: true,
      score: 0.92,
      categories: [{ category: 'violence', score: 0.92, label: 'Violence' }],
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    })

    const result = await resolveMessageDangerState({
      repos,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: conciergeOn(),
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'graphic scene',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

    expect(gatekeeperService.classifyContent).toHaveBeenCalledWith(
      'graphic scene',
      expect.anything(),
      'user-1',
      expect.objectContaining({ preScreen: expect.objectContaining({ enabled: true, scanTextChat: true }) }),
      'chat-1',
    )
    // A flag on a Moderated chat may fail over, so the router is asked.
    expect(providerRoutingService.resolveProviderForDangerousContent).toHaveBeenCalled()
    expect(result.effectiveProfile).toBe(baseProfile)
    expect(result.dangerFlags).toEqual([
      expect.objectContaining({ category: 'violence', score: 0.92 }),
    ])
    expect(streamingService.safeEnqueue).toHaveBeenCalled()
    expect(repos.chats.addMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        systemEventType: 'DANGER_CLASSIFICATION',
        provider: 'OPENAI',
        modelName: 'gpt-4.1-mini',
      })
    )
  })

  it('fails open when classification throws and keeps the original provider', async () => {
    ;(gatekeeperService.classifyContent as jest.Mock).mockRejectedValue(new Error('classifier offline'))

    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: conciergeOn(),
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'graphic scene',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

    expect(result.effectiveProfile).toBe(baseProfile)
    expect(result.effectiveApiKey).toBe('sk-safe')
    expect(result.dangerFlags).toBeUndefined()
  })
})
