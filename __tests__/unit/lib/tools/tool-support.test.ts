import {
  checkModelSupportsTools,
} from '@/lib/tools'
import { getPricingCache } from '@/lib/llm/pricing-fetcher'

jest.mock('@/lib/llm/pricing-fetcher', () => ({
  getPricingCache: jest.fn(),
}))

const mockedGetPricingCache = getPricingCache as jest.MockedFunction<typeof getPricingCache>

describe('tool support', () => {
  beforeEach(() => {
    mockedGetPricingCache.mockReset()
    mockedGetPricingCache.mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      providers: {
        OPENROUTER: {
          fetchedAt: new Date().toISOString(),
          models: [],
        },
      },
    })
  })

  it('checks OpenRouter cache to determine tool support', async () => {
    mockedGetPricingCache.mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      providers: {
        OPENROUTER: {
          fetchedAt: new Date().toISOString(),
          models: [
            {
              modelId: 'custom-model',
              provider: 'OPENROUTER',
              name: 'Custom Model',
              promptCostPer1M: 1,
              completionCostPer1M: 1,
              contextLength: 1000,
              supportsTools: false,
              fetchedAt: new Date().toISOString(),
            },
          ],
        },
      },
    })

    const supportsTools = await checkModelSupportsTools('OPENROUTER', 'custom-model', 'user-1')
    expect(mockedGetPricingCache).toHaveBeenCalledWith('user-1')
    expect(supportsTools).toBe(false)
  })

  it('falls back to true when OpenRouter model data is missing', async () => {
    mockedGetPricingCache.mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      providers: {
        OPENROUTER: {
          fetchedAt: new Date().toISOString(),
          models: [],
        },
      },
    })

    const supportsTools = await checkModelSupportsTools('OPENROUTER', 'missing-model', 'user-1')
    expect(supportsTools).toBe(true)
  })

  it('uses fallback pricing metadata for non-OpenRouter providers', async () => {
    // FALLBACK_PRICING already includes OpenAI models where o1-mini has supportsTools: false
    const supportsTools = await checkModelSupportsTools('OPENAI', 'o1-mini', 'user-1')
    expect(supportsTools).toBe(false)
  })
})
