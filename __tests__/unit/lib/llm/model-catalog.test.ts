/**
 * @jest-environment node
 *
 * Unit tests for lib/llm/model-catalog.ts — the known-facts layer behind
 * connection-profile Auto-Configure.
 */

import { clearModelCatalogCache, findModelEntry, lookupModelFacts } from '@/lib/llm/model-catalog'
import {
  getProviderMetadata,
  getProviderModelCatalog,
  getStaticModelInfo,
  hasModelCatalog,
} from '@/lib/plugins/provider-registry'
import { findOpenRouterPublicModel } from '@/lib/llm/pricing-fetcher'
import { getRepositories } from '@/lib/repositories/factory'
import type { NativeToolSample } from '@/lib/llm/tool-reliability'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/plugins/provider-registry', () => ({
  getProviderMetadata: jest.fn(),
  getProviderModelCatalog: jest.fn(),
  getStaticModelInfo: jest.fn(),
  hasModelCatalog: jest.fn(),
}))

jest.mock('@/lib/llm/pricing-fetcher', () => ({
  findOpenRouterPublicModel: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const mockMetadata = jest.mocked(getProviderMetadata)
const mockCatalog = jest.mocked(getProviderModelCatalog)
const mockStatic = jest.mocked(getStaticModelInfo)
const mockHasCatalog = jest.mocked(hasModelCatalog)
const mockOpenRouter = jest.mocked(findOpenRouterPublicModel)
const mockFindSamples = jest.fn<Promise<NativeToolSample[]>, [readonly string[], number]>()
jest.mocked(getRepositories).mockReturnValue({
  llmLogs: { findRecentNativeToolSamples: mockFindSamples },
} as unknown as ReturnType<typeof getRepositories>)

const NATIVE_OK: NativeToolSample = { toolCount: 12, toolCalls: [{ name: 'search' }], finishReason: 'STOP' }
const NATIVE_MALFORMED: NativeToolSample = { toolCount: 12, toolCalls: [], finishReason: 'MALFORMED_FUNCTION_CALL' }
const NATIVE_PROSE: NativeToolSample = { toolCount: 12, toolCalls: [], finishReason: 'STOP', content: 'She smiles.' }

const QUERY = { provider: 'NANOGPT', modelName: 'google/gemini-2.5-pro', apiKey: 'sk-1' }

function openRouterEntry(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'google/gemini-2.5-pro',
    provider: 'OPENROUTER',
    name: 'Gemini 2.5 Pro',
    promptCostPer1M: 1,
    completionCostPer1M: 1,
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
    supportsTools: true,
    supportsVision: true,
    fetchedAt: '2026-11-20T00:00:00Z',
    ...overrides,
  } as Awaited<ReturnType<typeof findOpenRouterPublicModel>>
}

beforeEach(() => {
  jest.clearAllMocks()
  clearModelCatalogCache()
  mockMetadata.mockReturnValue({ displayName: 'NanoGPT' } as ReturnType<typeof getProviderMetadata>)
  mockHasCatalog.mockReturnValue(true)
  mockCatalog.mockResolvedValue([])
  mockStatic.mockReturnValue([])
  mockOpenRouter.mockResolvedValue(null)
  mockFindSamples.mockResolvedValue([])
})

describe('lookupModelFacts', () => {
  describe('observed tool reliability', () => {
    const GOOGLE = { provider: 'GOOGLE', modelName: 'gemini-2.5-pro', apiKey: 'k', routeProfileIds: ['g-1'] }

    it("overrides a catalog's native tool support when the route's own calls keep failing", async () => {
      mockMetadata.mockReturnValue({ displayName: 'Google' } as ReturnType<typeof getProviderMetadata>)
      mockCatalog.mockResolvedValue([{ id: 'gemini-2.5-pro', name: 'Gemini', supportsTools: true, contextWindow: 1_000_000 }])
      mockFindSamples.mockResolvedValue([
        NATIVE_MALFORMED, NATIVE_MALFORMED, NATIVE_MALFORMED, NATIVE_MALFORMED,
        NATIVE_OK, NATIVE_OK, NATIVE_PROSE, NATIVE_PROSE,
      ])

      const facts = await lookupModelFacts(GOOGLE)

      expect(mockFindSamples).toHaveBeenCalledWith(['g-1'], 50)
      expect(facts.supportsTools).toBe(false)
      expect(facts.sources.supportsTools).toEqual({
        kind: 'observed',
        label: 'observed in your last 6 native tool calls on this route (4 failed)',
      })
      // Everything else still comes from the catalog.
      expect(facts.maxContext).toBe(1_000_000)
      expect(facts.sources.maxContext?.kind).toBe('provider-catalog')
    })

    it('states native tool support where no catalog does, when the calls have worked', async () => {
      mockFindSamples.mockResolvedValue(Array.from({ length: 6 }, () => NATIVE_OK))

      const facts = await lookupModelFacts(GOOGLE)

      expect(facts.supportsTools).toBe(true)
      expect(facts.sources.supportsTools?.kind).toBe('observed')
    })

    it('leaves the catalog to answer when the evidence is thin', async () => {
      mockCatalog.mockResolvedValue([{ id: 'gemini-2.5-pro', name: 'Gemini', supportsTools: true }])
      mockFindSamples.mockResolvedValue([NATIVE_MALFORMED, NATIVE_MALFORMED, NATIVE_OK])

      const facts = await lookupModelFacts(GOOGLE)

      expect(facts.supportsTools).toBe(true)
      expect(facts.sources.supportsTools?.kind).toBe('provider-catalog')
      expect(facts.toolReliability).toMatchObject({ ok: 1, failed: 2, verdict: 'inconclusive' })
    })

    it('reads no logs without route profiles', async () => {
      await lookupModelFacts(QUERY)
      expect(mockFindSamples).not.toHaveBeenCalled()
    })

    it('carries on with the catalogs when the logs cannot be read', async () => {
      mockFindSamples.mockRejectedValue(new Error('logs degraded'))
      mockCatalog.mockResolvedValue([{ id: 'gemini-2.5-pro', name: 'Gemini', supportsTools: true }])

      const facts = await lookupModelFacts(GOOGLE)

      expect(facts.supportsTools).toBe(true)
      expect(facts.sources.supportsTools?.kind).toBe('provider-catalog')
    })
  })

  it('takes every stated field from the provider catalog, labelled as such', async () => {
    mockCatalog.mockResolvedValue([
      { id: 'google/gemini-2.5-pro', name: 'Gemini', contextWindow: 1_000_000, maxOutputTokens: 32_000, supportsTools: true, supportsImages: false },
    ])

    const facts = await lookupModelFacts(QUERY)

    expect(facts).toMatchObject({ maxContext: 1_000_000, maxTokens: 32_000, supportsTools: true, supportsImages: false })
    expect(facts.sources.supportsTools).toEqual({ kind: 'provider-catalog', label: "NanoGPT's model catalog" })
    expect(mockOpenRouter).not.toHaveBeenCalled()
  })

  it('fills fields the catalog leaves unknown from the plugin table, never overwriting', async () => {
    mockCatalog.mockResolvedValue([{ id: 'google/gemini-2.5-pro', name: 'Gemini', contextWindow: 1_000_000 }])
    mockStatic.mockReturnValue([
      { id: 'google/gemini-2.5-pro', name: 'Gemini', contextWindow: 999, maxOutputTokens: 8192, supportsTools: false },
    ])

    const facts = await lookupModelFacts(QUERY)

    expect(facts.maxContext).toBe(1_000_000)
    expect(facts.maxTokens).toBe(8192)
    expect(facts.supportsTools).toBe(false)
    expect(facts.sources.maxTokens?.kind).toBe('plugin-table')
  })

  it('takes only upstream limits from OpenRouter for another provider — never its tool support', async () => {
    mockHasCatalog.mockReturnValue(false)
    mockOpenRouter.mockResolvedValue(openRouterEntry())

    const facts = await lookupModelFacts(QUERY)

    expect(facts.maxContext).toBe(1_048_576)
    expect(facts.maxTokens).toBe(65_536)
    expect(facts.supportsTools).toBeUndefined()
    expect(facts.supportsImages).toBeUndefined()
    expect(facts.sources.maxContext?.kind).toBe('openrouter-public')
  })

  it("takes tool and image support from OpenRouter's catalog when the profile is OpenRouter", async () => {
    mockHasCatalog.mockReturnValue(false)
    mockOpenRouter.mockResolvedValue(openRouterEntry({ supportsTools: false }))

    const facts = await lookupModelFacts({ ...QUERY, provider: 'OPENROUTER' })

    expect(facts.supportsTools).toBe(false)
    expect(facts.supportsImages).toBe(true)
  })

  it('records a live-catalog failure and carries on with the other sources', async () => {
    mockCatalog.mockRejectedValue(new Error('HTTP 401'))
    mockOpenRouter.mockResolvedValue(openRouterEntry())

    const facts = await lookupModelFacts(QUERY)

    expect(facts.catalogError).toBe('HTTP 401')
    expect(facts.maxContext).toBe(1_048_576)
  })

  it('ignores non-positive limits as unknown', async () => {
    mockCatalog.mockResolvedValue([{ id: 'google/gemini-2.5-pro', name: 'Gemini', contextWindow: 0, maxOutputTokens: -1 }])

    const facts = await lookupModelFacts(QUERY)

    expect(facts.maxContext).toBeUndefined()
    expect(facts.maxTokens).toBeUndefined()
  })

  it('caches the live catalog per provider, base URL and key', async () => {
    mockCatalog.mockResolvedValue([{ id: 'google/gemini-2.5-pro', name: 'Gemini', contextWindow: 1000, maxOutputTokens: 100 }])

    await lookupModelFacts(QUERY)
    await lookupModelFacts(QUERY)
    expect(mockCatalog).toHaveBeenCalledTimes(1)

    await lookupModelFacts({ ...QUERY, apiKey: 'sk-2' })
    expect(mockCatalog).toHaveBeenCalledTimes(2)
  })
})

describe('findModelEntry', () => {
  const models = [
    { id: 'google/gemini-2.5-pro' },
    { id: 'Anthropic/Claude-Sonnet-4' },
    { id: 'a/shared' },
    { id: 'b/shared' },
  ]

  it('matches exactly, then case-insensitively', () => {
    expect(findModelEntry(models, 'google/gemini-2.5-pro')?.id).toBe('google/gemini-2.5-pro')
    expect(findModelEntry(models, 'anthropic/claude-sonnet-4')?.id).toBe('Anthropic/Claude-Sonnet-4')
  })

  it('matches a bare name only when it is unambiguous', () => {
    expect(findModelEntry(models, 'gemini-2.5-pro')?.id).toBe('google/gemini-2.5-pro')
    expect(findModelEntry(models, 'shared')).toBeUndefined()
  })
})

describe('normalizeModelKey', () => {
  // Imported lazily: the module under test above mocks pricing-fetcher.
  const { normalizeModelKey } = jest.requireActual('@/lib/llm/pricing-fetcher') as typeof import('@/lib/llm/pricing-fetcher')

  it('reads dots and dashes alike and drops the vendor prefix', () => {
    expect(normalizeModelKey('anthropic/claude-sonnet-4.6')).toBe(normalizeModelKey('claude-sonnet-4-6'))
  })

  it('drops a trailing date stamp', () => {
    expect(normalizeModelKey('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5')
    expect(normalizeModelKey('gpt-4o-2024-11-20')).toBe('gpt-4o')
  })

  it('keeps distinct versions distinct', () => {
    expect(normalizeModelKey('claude-sonnet-4')).not.toBe(normalizeModelKey('claude-sonnet-4-6'))
  })
})
