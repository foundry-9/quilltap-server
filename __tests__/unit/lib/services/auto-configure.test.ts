/**
 * Unit Tests for Auto-Configure Service
 * Tests lib/services/auto-configure.service.ts
 *
 * Covers:
 * - Successful auto-configuration with web search + LLM analysis
 * - Value clamping to valid ranges
 * - Error when web search is not configured
 * - Fallback to cheap LLM when primary JSON parsing fails
 * - Search source collection from web search results
 * - Model class assignment validation
 */

import {
  autoConfigureProfile,
  deriveModelClass,
  profileUpdateFromAutoConfigure,
  type AutoConfigureResult,
} from '@/lib/services/auto-configure.service'
import { lookupModelFacts, type ModelFacts } from '@/lib/llm/model-catalog'
import { executeWebSearchTool, formatWebSearchResults, isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { createLLMProvider } from '@/lib/llm'
import { parseLLMJson } from '@/lib/llm/llm-json'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { REASONING_HEADROOM_TOKENS } from '@/lib/llm/reasoning-headroom'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { logLLMCall } from '@/lib/services/llm-logging.service'

// ============================================================================
// Mocks
// ============================================================================

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/tools/handlers/web-search-handler', () => ({
  executeWebSearchTool: jest.fn(),
  formatWebSearchResults: jest.fn(),
  isWebSearchConfigured: jest.fn(),
  WebSearchError: class extends Error {},
}))

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn(),
}))

jest.mock('@/lib/llm/llm-json', () => ({
  parseLLMJson: jest.fn(),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  profileParams: (profile: { parameters?: unknown }) =>
    profile?.parameters && typeof profile.parameters === 'object'
      ? (profile.parameters as Record<string, unknown>)
      : undefined,
}))

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn(),
}))

jest.mock('@/lib/llm/model-catalog', () => ({
  lookupModelFacts: jest.fn(),
}))

jest.mock('@/lib/plugins/provider-registry', () => ({
  getProviderMetadata: jest.fn((name: string) => ({ displayName: name === 'ANTHROPIC' ? 'Anthropic' : name })),
}))

const mockExecuteWebSearchTool = jest.mocked(executeWebSearchTool)
const mockFormatWebSearchResults = jest.mocked(formatWebSearchResults)
const mockIsWebSearchConfigured = jest.mocked(isWebSearchConfigured)
const mockCreateLLMProvider = jest.mocked(createLLMProvider)
const mockParseLLMJson = jest.mocked(parseLLMJson)
const mockGetCheapLLMProvider = jest.mocked(getCheapLLMProvider)
const mockGetUserRepositories = jest.mocked(getUserRepositories)
const mockLogLLMCall = jest.mocked(logLLMCall)
const mockLookupModelFacts = jest.mocked(lookupModelFacts)

// ============================================================================
// Fixtures
// ============================================================================

const TEST_USER_ID = 'user-123'
const TEST_PROVIDER = 'ANTHROPIC'
const TEST_MODEL = 'claude-sonnet-4-5-20250929'
const TARGET = { provider: TEST_PROVIDER, modelName: TEST_MODEL }

const CATALOG_SOURCE = { kind: 'provider-catalog' as const, label: "NanoGPT's model catalog" }

function createMockDefaultProfile() {
  return {
    id: 'profile-1',
    name: 'Default Profile',
    provider: 'ANTHROPIC',
    modelName: 'claude-sonnet-4-5-20250929',
    apiKeyId: 'key-1',
    baseUrl: null,
    userId: TEST_USER_ID,
    isDefault: true,
    parameters: {},
  }
}

function createMockRepos(overrides?: {
  findDefault?: jest.Mock
  findById?: jest.Mock
  findApiKeyById?: jest.Mock
  findAll?: jest.Mock
}) {
  return {
    connections: {
      findDefault: overrides?.findDefault ?? jest.fn().mockResolvedValue(createMockDefaultProfile()),
      findById: overrides?.findById ?? jest.fn().mockResolvedValue(createMockDefaultProfile()),
      findApiKeyById: overrides?.findApiKeyById ?? jest.fn().mockResolvedValue({ key_value: 'sk-test-key' }),
      findAll: overrides?.findAll ?? jest.fn().mockResolvedValue([createMockDefaultProfile()]),
    },
    chatSettings: { findByUserId: jest.fn() },
  }
}

function createSuccessfulSearchResult(urls: string[]) {
  return {
    success: true,
    results: urls.map((url, i) => ({
      title: `Result ${i + 1}`,
      url,
      content: `Content for ${url}`,
    })),
  }
}

const VALID_LLM_RESPONSE = {
  maxContext: 200000,
  maxTokens: 8192,
  temperature: 0.85,
  topP: 0.95,
  isDangerousCompatible: false,
}

// ============================================================================
// Tests
// ============================================================================

describe('autoConfigureProfile', () => {
  let mockSendMessage: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    mockIsWebSearchConfigured.mockResolvedValue(true)

    const mockRepos = createMockRepos()
    mockGetUserRepositories.mockReturnValue(mockRepos)

    mockExecuteWebSearchTool.mockResolvedValue(
      createSuccessfulSearchResult(['https://docs.anthropic.com/specs', 'https://example.com/review'])
    )
    mockFormatWebSearchResults.mockReturnValue('Formatted search results')

    mockSendMessage = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 500, completionTokens: 100 },
    })
    mockCreateLLMProvider.mockResolvedValue({ sendMessage: mockSendMessage })

    mockParseLLMJson.mockReturnValue(VALID_LLM_RESPONSE)

    mockLogLLMCall.mockResolvedValue(undefined)

    mockLookupModelFacts.mockResolvedValue({ sources: {} })
  })

  // --------------------------------------------------------------------------
  // Successful auto-configuration
  // --------------------------------------------------------------------------

  it('should return valid auto-configure result with web search and LLM analysis', async () => {
    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(result.maxContext).toBe(200000)
    expect(result.maxTokens).toBe(8192)
    expect(result.temperature).toBe(0.85)
    expect(result.topP).toBe(0.95)
    expect(result.isDangerousCompatible).toBe(false)
    expect(result.modelClass).toBe('Extended')
  })

  it('should run two parallel web searches for specs and settings', async () => {
    await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(mockExecuteWebSearchTool).toHaveBeenCalledTimes(2)

    const [specsCall, settingsCall] = mockExecuteWebSearchTool.mock.calls
    expect((specsCall[0] as { query: string }).query).toContain('specifications')
    expect((specsCall[0] as { query: string }).query).toContain(TEST_MODEL)
    expect((settingsCall[0] as { query: string }).query).toContain('temperature')
    expect((settingsCall[0] as { query: string }).query).toContain('creative writing')
  })

  it('should send formatted search results to the default LLM for analysis', async () => {
    await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(mockCreateLLMProvider).toHaveBeenCalledWith('ANTHROPIC', undefined)
    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    const callArgs = mockSendMessage.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; temperature: number }
    expect(callArgs.messages).toHaveLength(2)
    expect(callArgs.messages[0].role).toBe('system')
    expect(callArgs.messages[1].role).toBe('user')
    expect(callArgs.temperature).toBe(0.2)
  })

  it('should log the LLM call for auditing', async () => {
    await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(mockLogLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        type: 'AUTO_CONFIGURE',
        provider: 'ANTHROPIC',
      })
    )
  })

  // --------------------------------------------------------------------------
  // Value clamping
  // --------------------------------------------------------------------------

  describe('validateResult clamping', () => {
    it('should clamp temperature to 0-2 range', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, temperature: 5.0 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.temperature).toBe(2)
    })

    it('should clamp negative temperature to 0', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, temperature: -1 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.temperature).toBe(0)
    })

    it('should clamp topP to 0-1 range', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, topP: 1.5 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.topP).toBe(1)
    })

    it('should clamp negative topP to 0', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, topP: -0.5 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.topP).toBe(0)
    })

    it('should enforce maxContext >= 1', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 0 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.maxContext).toBeGreaterThanOrEqual(1)
    })

    it('should enforce maxTokens >= 1', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxTokens: -100 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.maxTokens).toBeGreaterThanOrEqual(1)
    })

    it('should round maxContext to an integer', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 128000.7 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.maxContext).toBe(128001)
      expect(Number.isInteger(result.maxContext)).toBe(true)
    })

    it('should use default values for NaN inputs', async () => {
      mockParseLLMJson.mockReturnValue({
        ...VALID_LLM_RESPONSE,
        maxContext: 'not-a-number',
        temperature: undefined,
        topP: null,
      })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      // Defaults: maxContext=4096, temperature=0.7, topP=1
      expect(result.maxContext).toBe(4096)
      expect(result.temperature).toBe(0.7)
      expect(result.topP).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // Web search not configured
  // --------------------------------------------------------------------------

  it('should proceed without web search, on catalog facts and model knowledge', async () => {
    mockIsWebSearchConfigured.mockResolvedValue(false)

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(mockExecuteWebSearchTool).not.toHaveBeenCalled()
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(result.searchSources).toEqual([])
    expect(result.maxContext).toBe(200000)
  })

  // --------------------------------------------------------------------------
  // No default profile
  // --------------------------------------------------------------------------

  it('should throw when no LLM is available and no catalog states the limits', async () => {
    const repos = createMockRepos({
      findDefault: jest.fn().mockResolvedValue(null),
    })
    mockGetUserRepositories.mockReturnValue(repos)

    await expect(autoConfigureProfile(TARGET, TEST_USER_ID)).rejects.toThrow(
      'No default connection profile configured'
    )
  })

  it('should answer from catalog facts with default sampling when no LLM is available', async () => {
    const repos = createMockRepos({
      findDefault: jest.fn().mockResolvedValue(null),
    })
    mockGetUserRepositories.mockReturnValue(repos)
    mockLookupModelFacts.mockResolvedValue({
      maxContext: 1_000_000,
      maxTokens: 65_536,
      sources: { maxContext: CATALOG_SOURCE, maxTokens: CATALOG_SOURCE },
    })

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(result.maxContext).toBe(1_000_000)
    expect(result.maxTokens).toBe(65_536)
    expect(result.temperature).toBe(0.7)
    expect(result.fieldSources.temperature.kind).toBe('default')
    expect(result.fieldSources.maxContext).toEqual(CATALOG_SOURCE)
  })

  // --------------------------------------------------------------------------
  // Cheap LLM fallback on parse failure
  // --------------------------------------------------------------------------

  it('should fall back to cheap LLM repair when primary JSON parsing fails', async () => {
    // First call to parseLLMJson throws (primary parse failure)
    mockParseLLMJson
      .mockImplementationOnce(() => {
        throw new Error('Invalid JSON')
      })
      // Second call succeeds (cheap LLM repair output)
      .mockReturnValueOnce(VALID_LLM_RESPONSE)

    const cheapSendMessage = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 100, completionTokens: 50 },
    })

    // The cheap LLM provider is set up via getCheapLLMProvider
    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      baseUrl: undefined,
      isLocal: false,
      connectionProfileId: 'profile-1',
    })

    // createLLMProvider is called twice: once for primary, once for cheap
    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: mockSendMessage })
      .mockResolvedValueOnce({ sendMessage: cheapSendMessage })

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(mockGetCheapLLMProvider).toHaveBeenCalled()
    expect(cheapSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1, maxTokens: 500 + REASONING_HEADROOM_TOKENS }),
      'sk-test-key'
    )
    expect(result.maxContext).toBe(200000)
  })

  it('should throw when both primary and cheap LLM parsing fail', async () => {
    mockParseLLMJson.mockImplementation(() => {
      throw new Error('Invalid JSON')
    })

    mockGetCheapLLMProvider.mockReturnValue({
      provider: 'OPENAI',
      modelName: 'gpt-4o-mini',
      baseUrl: undefined,
      isLocal: false,
      connectionProfileId: 'profile-1',
    })

    const cheapSendMessage = jest.fn().mockResolvedValue({
      content: 'totally broken response',
      usage: { promptTokens: 100, completionTokens: 50 },
    })

    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: mockSendMessage })
      .mockResolvedValueOnce({ sendMessage: cheapSendMessage })

    // With a single candidate (the default), the wrapper summarises the one attempt
    // and surfaces the underlying parse failure.
    await expect(autoConfigureProfile(TARGET, TEST_USER_ID)).rejects.toThrow(
      'no LLM could estimate them'
    )
    await expect(autoConfigureProfile(TARGET, TEST_USER_ID)).rejects.toThrow(
      'Failed to parse response from ANTHROPIC'
    )
  })

  // --------------------------------------------------------------------------
  // Cross-provider fallback
  // --------------------------------------------------------------------------

  it('should fall back to another provider when the default profile fails', async () => {
    const defaultProfile = createMockDefaultProfile()
    const fallbackProfile = {
      id: 'profile-2',
      name: 'OpenAI Fallback',
      provider: 'OPENAI',
      modelName: 'gpt-5',
      apiKeyId: 'key-2',
      baseUrl: null,
      userId: TEST_USER_ID,
      isDefault: false,
      modelClass: 'Deep',
      parameters: {},
    }

    const repos = createMockRepos({
      findApiKeyById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({ key_value: id === 'key-1' ? 'sk-default' : 'sk-fallback' })
      ),
      findAll: jest.fn().mockResolvedValue([defaultProfile, fallbackProfile]),
    })
    mockGetUserRepositories.mockReturnValue(repos)

    const failingSend = jest.fn().mockRejectedValue(new Error('429 rate_limit_exceeded'))
    const succeedingSend = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_LLM_RESPONSE),
      usage: { promptTokens: 500, completionTokens: 100 },
    })

    mockCreateLLMProvider
      .mockResolvedValueOnce({ sendMessage: failingSend })
      .mockResolvedValueOnce({ sendMessage: succeedingSend })

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(failingSend).toHaveBeenCalledTimes(1)
    expect(succeedingSend).toHaveBeenCalledTimes(1)
    expect(mockCreateLLMProvider).toHaveBeenNthCalledWith(1, 'ANTHROPIC', undefined)
    expect(mockCreateLLMProvider).toHaveBeenNthCalledWith(2, 'OPENAI', undefined)
    expect(result.maxContext).toBe(200000)
  })

  // --------------------------------------------------------------------------
  // Search source collection
  // --------------------------------------------------------------------------

  it('should collect source URLs from both web search result sets', async () => {
    const specsUrls = ['https://docs.anthropic.com/specs', 'https://example.com/model-card']
    const settingsUrls = ['https://blog.example.com/settings-guide']

    mockExecuteWebSearchTool
      .mockResolvedValueOnce(createSuccessfulSearchResult(specsUrls))
      .mockResolvedValueOnce(createSuccessfulSearchResult(settingsUrls))

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(result.searchSources).toEqual(expect.arrayContaining(specsUrls))
    expect(result.searchSources).toEqual(expect.arrayContaining(settingsUrls))
    expect(result.searchSources).toHaveLength(3)
  })

  it('should return empty search sources when web searches fail', async () => {
    mockExecuteWebSearchTool.mockResolvedValue({ success: false, results: null })

    const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

    expect(result.searchSources).toEqual([])
  })

  // --------------------------------------------------------------------------
  // Model class validation
  // --------------------------------------------------------------------------

  describe('model class assignment', () => {
    it('should derive the class from the final limits, not from the LLM', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 32000, maxTokens: 4000, modelClass: 'Deep' })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.modelClass).toBe('Compact')
      expect(result.fieldSources.modelClass.kind).toBe('derived')
    })
  })

  // --------------------------------------------------------------------------
  // Catalog facts
  // --------------------------------------------------------------------------

  describe('catalog facts', () => {
    const facts: ModelFacts = {
      maxContext: 1_048_576,
      maxTokens: 65_536,
      supportsTools: true,
      supportsImages: true,
      sources: {
        maxContext: CATALOG_SOURCE,
        maxTokens: CATALOG_SOURCE,
        supportsTools: CATALOG_SOURCE,
        supportsImages: CATALOG_SOURCE,
      },
    }

    it('should look facts up on the target route, key and base URL included', async () => {
      await autoConfigureProfile(
        { provider: 'NANOGPT', modelName: 'google/gemini-2.5-pro', baseUrl: 'https://example.test/v1', apiKeyId: 'key-1' },
        TEST_USER_ID
      )

      expect(mockLookupModelFacts).toHaveBeenCalledWith({
        provider: 'NANOGPT',
        modelName: 'google/gemini-2.5-pro',
        apiKey: 'sk-test-key',
        baseUrl: 'https://example.test/v1',
      })
    })

    it('should let facts outrank the LLM estimate and report their source', async () => {
      mockLookupModelFacts.mockResolvedValue(facts)

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

      expect(result.maxContext).toBe(1_048_576)
      expect(result.maxTokens).toBe(65_536)
      expect(result.fieldSources.maxContext).toEqual(CATALOG_SOURCE)
      expect(result.temperature).toBe(0.85)
      expect(result.fieldSources.temperature.kind).toBe('estimated')
      expect(result.supportsTools).toBe(true)
      expect(result.supportsImages).toBe(true)
      expect(result.pseudoToolMode).toBeNull()
      expect(result.modelClass).toBe('Deep')
    })

    it('should skip the specifications search when the limits are known', async () => {
      mockLookupModelFacts.mockResolvedValue(facts)

      await autoConfigureProfile(TARGET, TEST_USER_ID)

      expect(mockExecuteWebSearchTool).toHaveBeenCalledTimes(1)
      expect((mockExecuteWebSearchTool.mock.calls[0][0] as { query: string }).query).toContain('temperature')
      const userPrompt = (mockSendMessage.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[1].content
      expect(userPrompt).toContain('maxContext: 1048576')
    })

    it('should search an aggregator model by its upstream name, not the router', async () => {
      await autoConfigureProfile({ provider: 'NANOGPT', modelName: 'google/gemini-2.5-pro' }, TEST_USER_ID)

      const query = (mockExecuteWebSearchTool.mock.calls[0][0] as { query: string }).query
      expect(query).toContain('google gemini-2.5-pro')
      expect(query).not.toContain('NANOGPT')
    })

    it('should recommend Simple JSON when the route has no native tool calling', async () => {
      mockLookupModelFacts.mockResolvedValue({ ...facts, supportsTools: false })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.pseudoToolMode).toBe('simple-json')
    })

    it('should report tool and image support as unknown when no catalog states them', async () => {
      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)

      expect(result.supportsTools).toBeNull()
      expect(result.supportsImages).toBeNull()
      expect(result.pseudoToolMode).toBeNull()
    })

    it('should never let the output limit exceed the context window', async () => {
      mockParseLLMJson.mockReturnValue({ ...VALID_LLM_RESPONSE, maxContext: 8000, maxTokens: 32000 })

      const result = await autoConfigureProfile(TARGET, TEST_USER_ID)
      expect(result.maxTokens).toBe(8000)
    })
  })
})

describe('deriveModelClass', () => {
  it('should pick the smallest class that holds both limits', () => {
    expect(deriveModelClass(32000, 4000)).toBe('Compact')
    expect(deriveModelClass(32000, 8000)).toBe('Standard')
    expect(deriveModelClass(200000, 8192)).toBe('Extended')
  })

  it('should fall back to the largest class when nothing holds the limits', () => {
    expect(deriveModelClass(50_000_000, 1_000_000)).toBe('Deep')
  })
})

describe('profileUpdateFromAutoConfigure', () => {
  const base: AutoConfigureResult = {
    maxContext: 200000,
    maxTokens: 8192,
    temperature: 0.8,
    topP: 0.9,
    isDangerousCompatible: false,
    modelClass: 'Extended',
    supportsTools: null,
    supportsImages: null,
    pseudoToolMode: null,
    fieldSources: {} as AutoConfigureResult['fieldSources'],
    searchSources: [],
  }

  it('should merge sampling into existing parameters', () => {
    const update = profileUpdateFromAutoConfigure({ parameters: { seed: 7 }, pseudoToolMode: 'auto' }, base)
    expect(update.parameters).toEqual({ seed: 7, temperature: 0.8, max_tokens: 8192, top_p: 0.9 })
    expect(update).not.toHaveProperty('supportsImageUpload')
    expect(update).not.toHaveProperty('pseudoToolMode')
  })

  it('should write image support only when a catalog states it', () => {
    const update = profileUpdateFromAutoConfigure({ parameters: {}, pseudoToolMode: 'auto' }, { ...base, supportsImages: false })
    expect(update.supportsImageUpload).toBe(false)
  })

  it('should move tool mode to Simple JSON from auto or native only', () => {
    const noTools = { ...base, supportsTools: false, pseudoToolMode: 'simple-json' as const }
    expect(profileUpdateFromAutoConfigure({ parameters: {}, pseudoToolMode: 'auto' }, noTools).pseudoToolMode).toBe('simple-json')
    expect(profileUpdateFromAutoConfigure({ parameters: {}, pseudoToolMode: 'native' }, noTools).pseudoToolMode).toBe('simple-json')
    expect(profileUpdateFromAutoConfigure({ parameters: {}, pseudoToolMode: 'text-block' }, noTools)).not.toHaveProperty('pseudoToolMode')
  })

  it('should leave a hand-picked Simple JSON alone when the catalog claims native tools', () => {
    const withTools = { ...base, supportsTools: true }
    expect(profileUpdateFromAutoConfigure({ parameters: {}, pseudoToolMode: 'simple-json' }, withTools)).not.toHaveProperty('pseudoToolMode')
  })
})
