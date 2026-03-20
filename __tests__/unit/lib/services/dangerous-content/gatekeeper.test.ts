/**
 * Unit tests for lib/services/dangerous-content/gatekeeper.service.ts
 * Tests content classification via moderation providers and cheap LLM fallback
 */

import { classifyContent, mapModerationResult, parseClassificationResponse } from '@/lib/services/dangerous-content/gatekeeper.service'
import { createLLMProvider } from '@/lib/llm'
import { getRepositories } from '@/lib/repositories/factory'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { moderationProviderRegistry } from '@/lib/plugins/moderation-provider-registry'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ModerationResult } from '@/lib/plugins/interfaces/moderation-provider-plugin'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/plugins/moderation-provider-registry', () => ({
  moderationProviderRegistry: {
    getDefaultProvider: jest.fn().mockReturnValue(null),
  },
}))

const mockSettings: DangerousContentSettings = {
  mode: 'DETECT_ONLY',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

const mockCheapLLMSelection: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
  connectionProfileId: 'profile-1',
  isLocal: false,
}

describe('mapModerationResult', () => {
  it('maps OpenAI moderation categories to Concierge categories', () => {
    const moderationResult: ModerationResult = {
      flagged: true,
      categories: [
        { category: 'sexual', score: 0.9, flagged: true },
        { category: 'violence', score: 0.2, flagged: false },
      ],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(true)
    expect(result.score).toBe(0.9)
    expect(result.categories).toHaveLength(2)
    expect(result.categories[0].category).toBe('nsfw')
    expect(result.categories[0].score).toBe(0.9)
    expect(result.categories[0].label).toBe('Sexual/NSFW content')
    expect(result.categories[1].category).toBe('violence')
    expect(result.categories[1].score).toBe(0.2)
  })

  it('filters categories below relevance floor (0.01)', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [
        { category: 'sexual', score: 0.0001, flagged: false },
        { category: 'violence', score: 0.05, flagged: false },
      ],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].category).toBe('violence')
  })

  it('handles multiple categories mapping to same Concierge category (takes max score)', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [
        { category: 'sexual', score: 0.6, flagged: false },
        { category: 'sexual/minors', score: 0.8, flagged: true },
      ],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].category).toBe('nsfw')
    expect(result.categories[0].score).toBe(0.8)
  })

  it('marks as dangerous when score exceeds threshold', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.8, flagged: false }],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(true)
  })

  it('marks as safe when all scores below threshold', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [{ category: 'violence', score: 0.5, flagged: false }],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(false)
  })

  it('marks as dangerous when provider flags regardless of score', () => {
    const moderationResult: ModerationResult = {
      flagged: true,
      categories: [{ category: 'violence', score: 0.05, flagged: true }],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(true)
  })

  it('returns empty categories and score 0 for clean content', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toHaveLength(0)
  })
})

describe('parseClassificationResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      isDangerous: true,
      score: 0.85,
      categories: [{ category: 'violence', score: 0.85, label: 'Violence or graphic content' }],
    })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(true)
    expect(result.score).toBe(0.85)
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].category).toBe('violence')
  })

  it('strips markdown code fences from response', () => {
    const response = '```json\n{"isDangerous": false, "score": 0.1, "categories": []}\n```'

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.1)
  })

  it('strips plain code fences', () => {
    const response = '```\n{"isDangerous": false, "score": 0.1, "categories": []}\n```'

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(false)
  })

  it('marks as dangerous when score meets threshold', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.7,
      categories: [],
    })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(true)
  })

  it('marks as dangerous when LLM explicitly says so', () => {
    const response = JSON.stringify({
      isDangerous: true,
      score: 0.5,
      categories: [],
    })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(true)
  })

  it('uses max score from categories when higher than overall score', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.3,
      categories: [{ category: 'violence', score: 0.9, label: 'Violence' }],
    })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(true)
    expect(result.score).toBe(0.9)
  })

  it('fails safe with empty categories on invalid JSON', () => {
    const response = 'not valid json'

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toHaveLength(0)
  })

  it('handles missing categories array gracefully', () => {
    const response = JSON.stringify({ isDangerous: false, score: 0.1 })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.isDangerous).toBe(false)
    expect(result.categories).toHaveLength(0)
  })

  it('handles malformed category objects', () => {
    const response = JSON.stringify({
      isDangerous: false,
      score: 0.1,
      categories: [{ category: 'violence' }], // missing score
    })

    const result = parseClassificationResponse(response, 0.7)

    expect(result.categories[0].score).toBe(0)
  })
})

describe('classifyContent', () => {
  const userId = 'user-1'
  const chatId = 'chat-1'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('cache behavior', () => {
    it('returns cached result for same content without calling provider', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
          findByUserId: jest.fn().mockResolvedValue([]),
        },
      }

      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)
      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)

      const content = 'This is safe content for cache test 1'

      // First call
      const result1 = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1)

      // Second call with same content
      const result2 = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1) // Still 1, not called again
      expect(result2).toEqual(result1)
    })

    it('uses different cache entries for different content', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
          findByUserId: jest.fn().mockResolvedValue([]),
        },
      }

      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)
      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)

      const content1 = 'This is safe content for cache test 2a'
      const content2 = 'This is safe content for cache test 2b'

      await classifyContent(content1, mockCheapLLMSelection, userId, mockSettings, chatId)
      await classifyContent(content2, mockCheapLLMSelection, userId, mockSettings, chatId)

      expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(2)
    })
  })

  describe('moderation provider path', () => {
    it('uses moderation provider when available', async () => {
      const mockProvider = {
        metadata: { providerName: 'OPENAI' },
        moderate: jest.fn().mockResolvedValue({
          flagged: true,
          categories: [{ category: 'sexual', score: 0.9, flagged: true }],
        }),
      }

      const mockRepos = {
        connections: {
          findByUserId: jest.fn().mockResolvedValue([
            { id: 'c1', provider: 'OPENAI', apiKeyId: 'key-1' },
          ]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockProvider)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const content = 'Some dangerous content for provider test 1'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockProvider.moderate).toHaveBeenCalledWith(content, 'sk-test-key')
      expect(result.isDangerous).toBe(true)
      expect(logLLMCall).toHaveBeenCalled()
    })

    it('falls back to LLM when moderation provider has no API key', async () => {
      const mockProvider = {
        metadata: { providerName: 'OPENAI' },
        moderate: jest.fn(),
      }

      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findByUserId: jest.fn().mockResolvedValue([]), // No OPENAI profile
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockProvider)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Some content for provider test 2'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockProvider.moderate).not.toHaveBeenCalled()
      expect(mockLLMProvider.sendMessage).toHaveBeenCalled()
      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0.1)
      expect(result.categories).toHaveLength(0)
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    })

    it('falls back to LLM when no moderation provider available', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Some content for provider test 3'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockLLMProvider.sendMessage).toHaveBeenCalled()
      expect(result.isDangerous).toBe(false)
    })
  })

  describe('cheap LLM fallback', () => {
    it('uses cheap LLM when no moderation provider', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            isDangerous: true,
            score: 0.8,
            categories: [{ category: 'violence', score: 0.8, label: 'Violence' }],
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Dangerous content for llm test 1'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(mockLLMProvider.sendMessage).toHaveBeenCalled()
      expect(result.isDangerous).toBe(true)
      expect(result.score).toBe(0.8)
    })

    it('returns fail-safe when no API key for cheap LLM', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue(null), // No profile
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const content = 'Content for llm test 2'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(result).toEqual({ isDangerous: false, score: 0, categories: [] })
    })

    it('uses local LLM when isLocal is true', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const localSelection: CheapLLMSelection = {
        provider: 'OLLAMA',
        modelName: 'llama2',
        connectionProfileId: 'local-1',
        isLocal: true,
      }

      const content = 'Content for local llm test'

      const result = await classifyContent(content, localSelection, userId, mockSettings, chatId)

      expect(mockLLMProvider.sendMessage).toHaveBeenCalled()
      expect(result.isDangerous).toBe(false)
    })
  })

  describe('custom prompt injection', () => {
    it('appends customClassificationPrompt to system prompt', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const customSettings = {
        ...mockSettings,
        customClassificationPrompt: 'Custom instruction here',
      }

      const content = 'Content for custom prompt test'

      await classifyContent(content, mockCheapLLMSelection, userId, customSettings, chatId)

      const callArgs = mockLLMProvider.sendMessage.mock.calls[0][0]
      const systemMessage = callArgs.messages.find((m: any) => m.role === 'system')
      expect(systemMessage.content).toContain('Custom instruction here')
    })
  })

  describe('error handling and fail-safe', () => {
    it('returns fail-safe when LLM provider throws', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockRejectedValue(new Error('API error')),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Content for error test 1'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(result).toEqual({ isDangerous: false, score: 0, categories: [] })
    })

    it('returns fail-safe when moderation provider throws', async () => {
      const mockProvider = {
        metadata: { providerName: 'OPENAI' },
        moderate: jest.fn().mockRejectedValue(new Error('Provider error')),
      }

      const mockRepos = {
        connections: {
          findByUserId: jest.fn().mockResolvedValue([
            { id: 'c1', provider: 'OPENAI', apiKeyId: 'key-1' },
          ]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockProvider)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const content = 'Content for error test 2'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(result).toEqual({ isDangerous: false, score: 0, categories: [] })
    })

    it('returns fail-safe when JSON parsing fails in response', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'not valid json at all',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Content for error test 3'

      const result = await classifyContent(
        content,
        mockCheapLLMSelection,
        userId,
        mockSettings,
        chatId
      )

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toHaveLength(0)
      expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    })
  })

  describe('logging', () => {
    it('logs classification results via moderation provider', async () => {
      const mockProvider = {
        metadata: { providerName: 'OPENAI' },
        moderate: jest.fn().mockResolvedValue({
          flagged: false,
          categories: [],
        }),
      }

      const mockRepos = {
        connections: {
          findByUserId: jest.fn().mockResolvedValue([
            { id: 'c1', provider: 'OPENAI', apiKeyId: 'key-1' },
          ]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockProvider)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const content = 'Content for logging test 1'

      await classifyContent(content, mockCheapLLMSelection, userId, mockSettings, chatId)

      expect(logLLMCall).toHaveBeenCalled()
      const logCall = (logLLMCall as jest.Mock).mock.calls[0][0]
      expect(logCall.type).toBe('DANGER_CLASSIFICATION')
      expect(logCall.provider).toBe('OPENAI')
    })

    it('logs classification results via cheap LLM', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        },
      }

      ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
      ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

      const content = 'Content for logging test 2'

      await classifyContent(content, mockCheapLLMSelection, userId, mockSettings, chatId)

      expect(logLLMCall).toHaveBeenCalled()
      const logCall = (logLLMCall as jest.Mock).mock.calls[0][0]
      expect(logCall.type).toBe('DANGER_CLASSIFICATION')
      expect(logCall.provider).toBe('OPENAI')
      expect(logCall.modelName).toBe('gpt-4o-mini')
    })
  })
})
