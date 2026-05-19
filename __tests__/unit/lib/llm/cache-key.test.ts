import { describe, expect, it } from '@jest/globals'

import {
  buildPromptCacheKey,
  PROMPT_CACHE_STRUCTURE_VERSION,
} from '@/lib/llm/cache-key'

describe('buildPromptCacheKey', () => {
  it('returns undefined when chatId is undefined', () => {
    expect(buildPromptCacheKey(undefined)).toBeUndefined()
  })

  it('returns undefined when chatId is empty string', () => {
    expect(buildPromptCacheKey('')).toBeUndefined()
  })

  it('builds a key embedding the chatId and structure version', () => {
    const key = buildPromptCacheKey('abc-123')
    expect(key).toBe(`quilltap:chat:abc-123:v${PROMPT_CACHE_STRUCTURE_VERSION}`)
  })

  it('keys for different chatIds are different', () => {
    const a = buildPromptCacheKey('chat-aaa')
    const b = buildPromptCacheKey('chat-bbb')
    expect(a).not.toBe(b)
  })

  it('key is stable across calls with the same chatId', () => {
    const id = 'chat-stable'
    expect(buildPromptCacheKey(id)).toBe(buildPromptCacheKey(id))
  })

  it('key contains the version number', () => {
    const key = buildPromptCacheKey('chat-x') as string
    expect(key).toContain(`v${PROMPT_CACHE_STRUCTURE_VERSION}`)
  })

  it('PROMPT_CACHE_STRUCTURE_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROMPT_CACHE_STRUCTURE_VERSION)).toBe(true)
    expect(PROMPT_CACHE_STRUCTURE_VERSION).toBeGreaterThan(0)
  })
})
