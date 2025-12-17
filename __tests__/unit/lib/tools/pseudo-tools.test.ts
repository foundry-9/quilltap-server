import {
  checkModelSupportsTools,
  shouldUsePseudoTools,
  buildPseudoToolConfig,
  buildPseudoToolInstructions,
  parsePseudoToolCalls,
  convertToToolCallRequest,
  stripPseudoToolMarkers,
  hasPseudoToolMarkers,
} from '@/lib/tools'
import { getPricingCache } from '@/lib/llm/pricing-fetcher'

jest.mock('@/lib/llm/pricing-fetcher', () => ({
  getPricingCache: jest.fn(),
}))

const mockedGetPricingCache = getPricingCache as jest.MockedFunction<typeof getPricingCache>

describe('pseudo-tool support', () => {
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

  it('respects profile overrides when deciding pseudo-tool usage', () => {
    expect(shouldUsePseudoTools(true, 'native')).toBe(false)
    expect(shouldUsePseudoTools(true, 'pseudo')).toBe(true)
    // Auto mode should follow supportsNativeTools flag
    expect(shouldUsePseudoTools(false, 'auto')).toBe(true)
  })

  it('builds pseudo-tool configuration from enabled options', () => {
    const config = buildPseudoToolConfig({
      memorySearch: false,
      imageGeneration: true,
      webSearch: true,
    })

    expect(config.enabled).toBe(true)
    expect(config.availableTools).toEqual(['image', 'search'])

    const disabled = buildPseudoToolConfig({
      memorySearch: false,
      imageGeneration: false,
      webSearch: false,
    })
    expect(disabled.enabled).toBe(false)
    expect(disabled.availableTools).toEqual([])
  })

  it('builds pseudo-tool instructions for all enabled tools', () => {
    const instructions = buildPseudoToolInstructions({
      memorySearch: true,
      imageGeneration: true,
      webSearch: true,
    })

    expect(instructions).toContain('[TOOL:memory]')
    expect(instructions).toContain('[TOOL:image]')
    expect(instructions).toContain('[TOOL:search]')
  })

  it('returns empty instructions when no tools are enabled', () => {
    const instructions = buildPseudoToolInstructions({
      memorySearch: false,
      imageGeneration: false,
      webSearch: false,
    })
    expect(instructions).toBe('')
  })

  it('parses pseudo-tool markers and converts them to tool calls', () => {
    const response = `
Let's see... [TOOL:memory]favorite dessert[/TOOL]
Maybe an image: [TOOL:image]a fox in a meadow[/TOOL]
`
    const parsed = parsePseudoToolCalls(response)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      toolName: 'search_memories',
      argument: 'favorite dessert',
    })

    const request = convertToToolCallRequest(parsed[1])
    expect(request).toEqual({
      name: 'generate_image',
      arguments: { prompt: 'a fox in a meadow' },
    })
  })

  it('strips pseudo-tool markers for display and detects their presence', () => {
    const response = 'Answering... [TOOL:search]mars weather today[/TOOL]'
    expect(hasPseudoToolMarkers(response)).toBe(true)

    const stripped = stripPseudoToolMarkers(response)
    expect(stripped).toBe('Answering...')
    expect(hasPseudoToolMarkers(stripped)).toBe(false)
  })
})
