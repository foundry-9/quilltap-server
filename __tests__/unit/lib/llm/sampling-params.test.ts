/**
 * @jest-environment node
 *
 * `withoutSamplingParameters` is what the connection-profiles repository and
 * the strip-anthropic-sampling-parameters migration use to clean a profile's
 * parameters blob for a provider that refuses temperature / top_p / top_k.
 */

import { withoutSamplingParameters, resolveSamplingParams } from '@/lib/llm/sampling-params'

describe('withoutSamplingParameters', () => {
  it('removes every sampling spelling and reports what was there', () => {
    const { parameters, removed } = withoutSamplingParameters({
      temperature: 0.7,
      top_p: 0.9,
      topP: 0.8,
      top_k: 40,
      max_tokens: 2048,
      enableCacheBreakpoints: true,
    })
    expect(parameters).toEqual({ max_tokens: 2048, enableCacheBreakpoints: true })
    expect(removed.sort()).toEqual(['temperature', 'topP', 'top_k', 'top_p'])
  })

  it('returns a copy and reports nothing for a clean blob', () => {
    const input = { max_tokens: 100 }
    const { parameters, removed } = withoutSamplingParameters(input)
    expect(parameters).toEqual(input)
    expect(parameters).not.toBe(input)
    expect(removed).toEqual([])
  })

  it('leaves the cleaned blob with no sampling knobs to resolve', () => {
    const { parameters } = withoutSamplingParameters({ temperature: 0.2, top_p: 0.5, max_tokens: 64 })
    expect(resolveSamplingParams(parameters)).toEqual({
      temperature: undefined,
      maxTokens: 64,
      topP: undefined,
    })
  })
})
