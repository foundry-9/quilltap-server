/**
 * Unit tests for the image-orientation resolver.
 *
 * The resolver turns a semantic (provider, model, orientation) request into the
 * concrete mutation each provider understands. These tests drive it over a
 * fixture that mirrors the real built-in plugin declarations (the per-provider
 * audit in docs/developer/features/image-orientation-gating.md), plus the host
 * fallback and the dall-e-2 "square only" degradation.
 *
 * Mock style follows the repo convention: global jest, subject imported first,
 * bare jest.mock factory for the registry, behaviour wired via jest.mocked.
 */

import { resolveOrientation } from '@/lib/image-gen/orientation'
import {
  getImageGenerationModels,
  getImageProviderConstraints,
} from '@/lib/plugins/provider-registry'
import type {
  ImageGenerationModelInfo,
  ImageOrientationSupport,
  ImageProviderConstraints,
} from '@quilltap/plugin-types'

jest.mock('@/lib/plugins/provider-registry', () => ({
  getImageGenerationModels: jest.fn(),
  getImageProviderConstraints: jest.fn(),
}))

const mockGetModels = jest.mocked(getImageGenerationModels)
const mockGetConstraints = jest.mocked(getImageProviderConstraints)

// ---- Fixtures mirroring the real plugin declarations --------------------

const gptImage: ImageOrientationSupport = {
  strategy: 'size',
  portrait: { size: '1024x1536' },
  landscape: { size: '1536x1024' },
  square: { size: '1024x1024' },
}
const dalle3: ImageOrientationSupport = {
  strategy: 'size',
  portrait: { size: '1024x1792' },
  landscape: { size: '1792x1024' },
  square: { size: '1024x1024' },
}
const dalle2: ImageOrientationSupport = {
  strategy: 'size',
  portrait: {}, // square only — portrait/landscape intentionally empty
  landscape: {},
  square: { size: '1024x1024' },
}
const aspect34_169: ImageOrientationSupport = {
  strategy: 'aspectRatio',
  portrait: { aspectRatio: '3:4' },
  landscape: { aspectRatio: '16:9' },
  square: { aspectRatio: '1:1' },
}
const zaiSize: ImageOrientationSupport = {
  strategy: 'size',
  portrait: { size: '1056x1568' },
  landscape: { size: '1568x1056' },
  square: { size: '1024x1024' },
}

const OPENAI_MODELS: ImageGenerationModelInfo[] = [
  { id: 'gpt-image-1', name: 'GPT Image 1', orientationSupport: gptImage },
  { id: 'dall-e-3', name: 'DALL·E 3', orientationSupport: dalle3 },
  { id: 'dall-e-2', name: 'DALL·E 2', orientationSupport: dalle2 },
]
const GOOGLE_MODELS: ImageGenerationModelInfo[] = [
  { id: 'imagen-4', name: 'Imagen 4', orientationSupport: aspect34_169 },
]
const OPENROUTER_MODELS: ImageGenerationModelInfo[] = [
  { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro', orientationSupport: aspect34_169 },
]
const GROK_CONSTRAINTS: ImageProviderConstraints = { orientationSupport: aspect34_169 }
const ZAI_CONSTRAINTS: ImageProviderConstraints = { orientationSupport: zaiSize }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetModels.mockImplementation((provider: string) => {
    switch (provider) {
      case 'OPENAI': return OPENAI_MODELS
      case 'GOOGLE': return GOOGLE_MODELS
      case 'OPENROUTER': return OPENROUTER_MODELS
      default: return null
    }
  })
  mockGetConstraints.mockImplementation((provider: string) => {
    switch (provider) {
      case 'GROK': return GROK_CONSTRAINTS
      case 'Z_AI': return ZAI_CONSTRAINTS
      default: return null
    }
  })
})

describe('resolveOrientation — size-strategy providers (per-model)', () => {
  it('maps gpt-image portrait/landscape/square to its own sizes (authoritative)', () => {
    expect(resolveOrientation('OPENAI', 'gpt-image-1', 'portrait')).toEqual({
      params: { size: '1024x1536' }, promptHint: '', dimensionsAuthoritative: true,
    })
    expect(resolveOrientation('OPENAI', 'gpt-image-1', 'landscape')).toEqual({
      params: { size: '1536x1024' }, promptHint: '', dimensionsAuthoritative: true,
    })
    expect(resolveOrientation('OPENAI', 'gpt-image-1', 'square')).toEqual({
      params: { size: '1024x1024' }, promptHint: '', dimensionsAuthoritative: true,
    })
  })

  it('maps dall-e-3 to its distinct portrait/landscape sizes', () => {
    expect(resolveOrientation('OPENAI', 'dall-e-3', 'portrait').params).toEqual({ size: '1024x1792' })
    expect(resolveOrientation('OPENAI', 'dall-e-3', 'landscape').params).toEqual({ size: '1792x1024' })
  })

  it('matches a dated SKU by longest-prefix family (gpt-image-1-mini → gpt-image-1)', () => {
    expect(resolveOrientation('OPENAI', 'gpt-image-1-mini', 'portrait').params).toEqual({ size: '1024x1536' })
  })

  it('degrades dall-e-2 portrait/landscape to a non-authoritative prompt hint (square only)', () => {
    const portrait = resolveOrientation('OPENAI', 'dall-e-2', 'portrait')
    expect(portrait.params).toEqual({})
    expect(portrait.dimensionsAuthoritative).toBe(false)
    expect(portrait.promptHint).toMatch(/portrait/i)

    // square is still authoritative for dall-e-2
    expect(resolveOrientation('OPENAI', 'dall-e-2', 'square')).toEqual({
      params: { size: '1024x1024' }, promptHint: '', dimensionsAuthoritative: true,
    })
  })

  it('maps Z.AI (provider-level size) portrait/landscape', () => {
    expect(resolveOrientation('Z_AI', 'glm-image', 'portrait').params).toEqual({ size: '1056x1568' })
    expect(resolveOrientation('Z_AI', 'glm-image', 'landscape').params).toEqual({ size: '1568x1056' })
  })
})

describe('resolveOrientation — aspect-ratio providers', () => {
  it('maps Google (per-model) portrait→3:4, landscape→16:9, square→1:1', () => {
    expect(resolveOrientation('GOOGLE', 'imagen-4', 'portrait').params).toEqual({ aspectRatio: '3:4' })
    expect(resolveOrientation('GOOGLE', 'imagen-4', 'landscape').params).toEqual({ aspectRatio: '16:9' })
    expect(resolveOrientation('GOOGLE', 'imagen-4', 'square').params).toEqual({ aspectRatio: '1:1' })
  })

  it('maps Grok (provider-level) even when model is undefined', () => {
    expect(resolveOrientation('GROK', undefined, 'landscape')).toEqual({
      params: { aspectRatio: '16:9' }, promptHint: '', dimensionsAuthoritative: true,
    })
  })

  it('maps OpenRouter passthrough (per-model) landscape→16:9', () => {
    expect(resolveOrientation('OPENROUTER', 'google/gemini-3-pro-image-preview', 'landscape').params)
      .toEqual({ aspectRatio: '16:9' })
  })
})

describe('resolveOrientation — host fallback', () => {
  it('returns a non-authoritative prompt hint for an unknown provider', () => {
    const r = resolveOrientation('NOPE', 'whatever', 'portrait')
    expect(r.params).toEqual({})
    expect(r.dimensionsAuthoritative).toBe(false)
    expect(r.promptHint).toMatch(/portrait/i)

    expect(resolveOrientation('NOPE', undefined, 'landscape').promptHint).toMatch(/landscape/i)
    expect(resolveOrientation('NOPE', undefined, 'square').promptHint).toMatch(/square/i)
  })

  it('falls back when a known provider has no matching model and no provider-level support', () => {
    // OPENAI has per-model support but only for the three known families.
    const r = resolveOrientation('OPENAI', 'some-future-model', 'portrait')
    expect(r.params).toEqual({})
    expect(r.dimensionsAuthoritative).toBe(false)
  })
})

describe('resolveOrientation — precedence', () => {
  it('prefers per-model support over provider-level support', () => {
    // Provider advertises BOTH: per-model size map and a provider-level aspect map.
    mockGetModels.mockReturnValue([
      { id: 'm1', name: 'M1', orientationSupport: gptImage },
    ])
    mockGetConstraints.mockReturnValue({ orientationSupport: aspect34_169 })

    // per-model (size) wins
    expect(resolveOrientation('X', 'm1', 'portrait').params).toEqual({ size: '1024x1536' })
    // a different model with no per-model entry falls through to provider-level (aspect)
    expect(resolveOrientation('X', 'other', 'portrait').params).toEqual({ aspectRatio: '3:4' })
  })
})
