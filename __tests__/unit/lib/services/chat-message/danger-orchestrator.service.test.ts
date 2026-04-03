import { resolveMessageDangerState } from '@/lib/services/chat-message/danger-orchestrator.service'
import * as resolverService from '@/lib/services/dangerous-content/resolver.service'
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

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the original profile unchanged when Concierge mode is OFF', async () => {
    ;(resolverService.resolveDangerousContentSettings as jest.Mock).mockReturnValue({
      settings: { mode: 'OFF', scanTextChat: true },
      source: 'global',
    })

    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: {} as any,
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
    expect(gatekeeperService.classifyContent).not.toHaveBeenCalled()
  })

  it('synthesizes flags for permanently dangerous chats and reroutes in AUTO_ROUTE mode', async () => {
    const uncensoredProfile = {
      id: 'profile-2',
      name: 'Uncensored',
      provider: 'LOCAL',
      modelName: 'llama-uncensored',
      isDangerousCompatible: true,
    }

    ;(resolverService.resolveDangerousContentSettings as jest.Mock).mockReturnValue({
      settings: { mode: 'AUTO_ROUTE', scanTextChat: true },
      source: 'global',
    })
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
      chat: { isDangerousChat: true, dangerCategories: ['nsfw'] } as any,
      chatSettings: {} as any,
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
    expect(gatekeeperService.classifyContent).not.toHaveBeenCalled()
  })

  it('classifies dangerous content, emits status events, and records a classification system message', async () => {
    const repos = { chats: { addMessage: jest.fn().mockResolvedValue(undefined) } } as any

    ;(resolverService.resolveDangerousContentSettings as jest.Mock).mockReturnValue({
      settings: { mode: 'DETECT_ONLY', scanTextChat: true },
      source: 'global',
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
      chatSettings: {} as any,
      character: { id: 'char-1', name: 'Alice' } as any,
      isContinueMode: false,
      content: 'graphic scene',
      cheapLLMSelection: { provider: 'OPENAI', modelName: 'gpt-4.1-mini', isLocal: false },
      connectionProfile: baseProfile,
      apiKey: 'sk-safe',
      controller,
      encoder,
    })

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
    ;(resolverService.resolveDangerousContentSettings as jest.Mock).mockReturnValue({
      settings: { mode: 'AUTO_ROUTE', scanTextChat: true },
      source: 'global',
    })
    ;(gatekeeperService.classifyContent as jest.Mock).mockRejectedValue(new Error('classifier offline'))

    const result = await resolveMessageDangerState({
      repos: { chats: { addMessage: jest.fn() } } as any,
      chatId: 'chat-1',
      userId: 'user-1',
      chat: { isDangerousChat: false, dangerCategories: [] } as any,
      chatSettings: {} as any,
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
