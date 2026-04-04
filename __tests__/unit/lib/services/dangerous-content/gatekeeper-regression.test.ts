/**
 * Regression tests for the Concierge Gatekeeper service
 *
 * Covers the DETECT_ONLY empty response bug where an empty LLM response
 * should fail safe (isDangerous: false) rather than crashing or blocking,
 * along with related edge cases in parsing, moderation mapping, caching,
 * and provider fallback behavior.
 */

import {
  classifyContent,
  parseClassificationResponse,
  mapModerationResult,
} from '@/lib/services/dangerous-content/gatekeeper.service'
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

// ---------------------------------------------------------------------------
// Regression: DETECT_ONLY empty response bug
// ---------------------------------------------------------------------------

describe('DETECT_ONLY empty response regression', () => {
  describe('parseClassificationResponse with empty/malformed input', () => {
    it('returns safe result (isDangerous: false) for empty string', () => {
      const result = parseClassificationResponse('', 0.7)

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for whitespace-only string', () => {
      const result = parseClassificationResponse('   \n\t  ', 0.7)

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for malformed JSON (truncated)', () => {
      const result = parseClassificationResponse('{"isDangerous": true, "sco', 0.7)

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for malformed JSON (random text)', () => {
      const result = parseClassificationResponse(
        'I cannot classify this content because it violates my guidelines.',
        0.7
      )

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for JSON with null fields', () => {
      const result = parseClassificationResponse(
        JSON.stringify({ isDangerous: null, score: null, categories: null }),
        0.7
      )

      // null isDangerous should not trigger dangerous flag
      expect(result.isDangerous).toBe(false)
      // null score should default to 0
      expect(result.score).toBe(0)
      // null categories should default to empty array
      expect(result.categories).toEqual([])
    })

    it('returns safe result for empty JSON object', () => {
      const result = parseClassificationResponse('{}', 0.7)

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for JSON array instead of object', () => {
      const result = parseClassificationResponse('[]', 0.7)

      // JSON.parse succeeds but fields are missing; should fail safe
      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })

    it('returns safe result for code fence wrapping empty content', () => {
      const result = parseClassificationResponse('```json\n\n```', 0.7)

      expect(result.isDangerous).toBe(false)
      expect(result.score).toBe(0)
      expect(result.categories).toEqual([])
    })
  })

  describe('classifyContent with empty LLM response in DETECT_ONLY mode', () => {
    const userId = 'user-regression-1'
    const chatId = 'chat-regression-1'

    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('fails safe when LLM returns empty string content', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: '',
          usage: { promptTokens: 50, completionTokens: 0, totalTokens: 50 },
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

      const content = 'Unique regression content for empty response test abc123'

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
      // Usage should still be attached even though content was empty
      expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 0, totalTokens: 50 })
    })

    it('fails safe when LLM returns refusal text instead of JSON', async () => {
      const mockLLMProvider = {
        sendMessage: jest.fn().mockResolvedValue({
          content: 'I apologize, but I cannot analyze this content.',
          usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
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

      const content = 'Unique regression content for refusal test xyz789'

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
    })
  })
})

// ---------------------------------------------------------------------------
// Regression: mapModerationResult category mapping
// ---------------------------------------------------------------------------

describe('mapModerationResult regression', () => {
  it('correctly maps all OpenAI moderation categories to Concierge categories', () => {
    const moderationResult: ModerationResult = {
      flagged: true,
      categories: [
        { category: 'sexual', score: 0.9, flagged: true },
        { category: 'sexual/minors', score: 0.95, flagged: true },
        { category: 'violence', score: 0.8, flagged: true },
        { category: 'violence/graphic', score: 0.85, flagged: true },
        { category: 'hate', score: 0.7, flagged: true },
        { category: 'hate/threatening', score: 0.75, flagged: true },
        { category: 'harassment', score: 0.6, flagged: false },
        { category: 'harassment/threatening', score: 0.65, flagged: false },
        { category: 'self-harm', score: 0.5, flagged: false },
        { category: 'self-harm/intent', score: 0.55, flagged: false },
        { category: 'self-harm/instructions', score: 0.45, flagged: false },
        { category: 'illicit', score: 0.4, flagged: false },
        { category: 'illicit/violent', score: 0.35, flagged: false },
      ],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    // sexual and sexual/minors should both map to nsfw; max score wins
    const nsfw = result.categories.find(c => c.category === 'nsfw')
    expect(nsfw).toBeDefined()
    expect(nsfw!.score).toBe(0.95) // max of 0.9, 0.95

    // violence and violence/graphic should map to violence; max wins
    const violence = result.categories.find(c => c.category === 'violence')
    expect(violence).toBeDefined()
    expect(violence!.score).toBe(0.85) // max of 0.8, 0.85

    // hate, hate/threatening, harassment, harassment/threatening all -> hate_speech
    const hateSpeech = result.categories.find(c => c.category === 'hate_speech')
    expect(hateSpeech).toBeDefined()
    expect(hateSpeech!.score).toBe(0.75) // max of 0.7, 0.75, 0.6, 0.65

    // self-harm, self-harm/intent, self-harm/instructions all -> self_harm
    const selfHarm = result.categories.find(c => c.category === 'self_harm')
    expect(selfHarm).toBeDefined()
    expect(selfHarm!.score).toBe(0.55) // max of 0.5, 0.55, 0.45

    // illicit, illicit/violent all -> illegal_activity
    const illegal = result.categories.find(c => c.category === 'illegal_activity')
    expect(illegal).toBeDefined()
    expect(illegal!.score).toBe(0.4) // max of 0.4, 0.35

    // Should have exactly 5 aggregated categories
    expect(result.categories).toHaveLength(5)

    // Overall result should be dangerous (flagged + high scores)
    expect(result.isDangerous).toBe(true)
    expect(result.score).toBe(0.95)
  })

  it('assigns human-readable labels for each mapped category', () => {
    const categories = [
      { input: 'sexual', expected: 'Sexual/NSFW content' },
      { input: 'violence', expected: 'Violence or graphic content' },
      { input: 'hate', expected: 'Hate speech or harassment' },
      { input: 'self-harm', expected: 'Self-harm content' },
      { input: 'illicit', expected: 'Illegal activity' },
    ]

    for (const { input, expected } of categories) {
      const moderationResult: ModerationResult = {
        flagged: false,
        categories: [{ category: input, score: 0.5, flagged: false }],
      }

      const result = mapModerationResult(moderationResult, 0.7)
      expect(result.categories[0].label).toBe(expected)
    }
  })

  it('handles empty moderation result without error', () => {
    const moderationResult: ModerationResult = {
      flagged: false,
      categories: [],
    }

    const result = mapModerationResult(moderationResult, 0.7)

    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Regression: Classification caching
// ---------------------------------------------------------------------------

describe('classification caching regression', () => {
  const userId = 'user-cache-1'
  const chatId = 'chat-cache-1'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('same content returns cached result without calling LLM again', async () => {
    const mockLLMProvider = {
      sendMessage: jest.fn().mockResolvedValue({
        content: JSON.stringify({ isDangerous: false, score: 0.2, categories: [] }),
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

    ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
    ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
    ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

    const content = 'Unique caching regression test content delta-42'

    // First call should invoke the LLM
    const result1 = await classifyContent(
      content,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1)
    expect(result1.isDangerous).toBe(false)
    expect(result1.score).toBe(0.2)

    // Second call with identical content should use cache
    const result2 = await classifyContent(
      content,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1) // NOT called again
    expect(result2.isDangerous).toBe(result1.isDangerous)
    expect(result2.score).toBe(result1.score)
    expect(result2.categories).toEqual(result1.categories)
  })

  it('different content produces separate cache entries', async () => {
    const mockLLMProvider = {
      sendMessage: jest.fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({ isDangerous: false, score: 0.1, categories: [] }),
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            isDangerous: true,
            score: 0.9,
            categories: [{ category: 'violence', score: 0.9, label: 'Violence' }],
          }),
          usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
        }),
    }

    const mockRepos = {
      connections: {
        findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
        findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
        findByUserId: jest.fn().mockResolvedValue([]),
      },
    }

    ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(null)
    ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
    ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

    const safeContent = 'Unique caching regression safe content epsilon-7'
    const dangerousContent = 'Unique caching regression dangerous content zeta-9'

    const safeResult = await classifyContent(
      safeContent,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )
    const dangerousResult = await classifyContent(
      dangerousContent,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(2)
    expect(safeResult.isDangerous).toBe(false)
    expect(dangerousResult.isDangerous).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Regression: Moderation provider unavailable falls back to cheap LLM
// ---------------------------------------------------------------------------

describe('moderation provider fallback regression', () => {
  const userId = 'user-fallback-1'
  const chatId = 'chat-fallback-1'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('falls back to cheap LLM when moderation provider is registered but no API key found', async () => {
    const mockModerationProvider = {
      metadata: { providerName: 'OPENAI' },
      moderate: jest.fn(),
    }

    const mockLLMProvider = {
      sendMessage: jest.fn().mockResolvedValue({
        content: JSON.stringify({ isDangerous: false, score: 0.15, categories: [] }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    }

    const mockRepos = {
      connections: {
        // No matching OPENAI profile for moderation provider
        findByUserId: jest.fn().mockResolvedValue([]),
        // But cheap LLM profile exists
        findById: jest.fn().mockResolvedValue({ id: 'profile-1', apiKeyId: 'key-1' }),
        findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'test-key' }),
      },
    }

    ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockModerationProvider)
    ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)
    ;(createLLMProvider as jest.Mock).mockResolvedValue(mockLLMProvider)

    const content = 'Unique fallback regression content theta-11'

    const result = await classifyContent(
      content,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    // Moderation provider should NOT have been called (no API key)
    expect(mockModerationProvider.moderate).not.toHaveBeenCalled()
    // Cheap LLM should have been called as fallback
    expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.15)
  })

  it('falls back to cheap LLM when no moderation provider is registered', async () => {
    const mockLLMProvider = {
      sendMessage: jest.fn().mockResolvedValue({
        content: JSON.stringify({ isDangerous: false, score: 0.05, categories: [] }),
        usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
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

    const content = 'Unique fallback regression content iota-13'

    const result = await classifyContent(
      content,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    expect(mockLLMProvider.sendMessage).toHaveBeenCalledTimes(1)
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0.05)
  })

  it('falls back to safe result when moderation provider throws and cheap LLM also fails', async () => {
    const mockModerationProvider = {
      metadata: { providerName: 'OPENAI' },
      moderate: jest.fn().mockRejectedValue(new Error('Provider down')),
    }

    const mockRepos = {
      connections: {
        findByUserId: jest.fn().mockResolvedValue([
          { id: 'c1', provider: 'OPENAI', apiKeyId: 'key-1' },
        ]),
        findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test' }),
      },
    }

    ;(moderationProviderRegistry.getDefaultProvider as jest.Mock).mockReturnValue(mockModerationProvider)
    ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

    const content = 'Unique fallback regression content kappa-17'

    const result = await classifyContent(
      content,
      mockCheapLLMSelection,
      userId,
      mockSettings,
      chatId
    )

    // Should fail safe
    expect(result.isDangerous).toBe(false)
    expect(result.score).toBe(0)
    expect(result.categories).toEqual([])
  })
})
