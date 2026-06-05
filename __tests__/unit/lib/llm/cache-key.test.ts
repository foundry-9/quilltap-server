import { describe, expect, it } from '@jest/globals'

import {
  buildCharacterCacheKey,
  PROMPT_CACHE_STRUCTURE_VERSION,
} from '@/lib/llm/cache-key'

describe('buildCharacterCacheKey', () => {
  it('returns undefined when characterId is undefined', () => {
    expect(buildCharacterCacheKey(undefined)).toBeUndefined()
  })

  it('returns undefined when characterId is empty string', () => {
    expect(buildCharacterCacheKey('')).toBeUndefined()
  })

  it('builds a key embedding the characterId and structure version', () => {
    const key = buildCharacterCacheKey('abc-123')
    expect(key).toBe(`quilltap:char:abc-123:v${PROMPT_CACHE_STRUCTURE_VERSION}`)
  })

  it('keys for different characterIds are different', () => {
    const a = buildCharacterCacheKey('char-aaa')
    const b = buildCharacterCacheKey('char-bbb')
    expect(a).not.toBe(b)
  })

  it('key is stable across calls with the same characterId', () => {
    const id = 'char-stable'
    expect(buildCharacterCacheKey(id)).toBe(buildCharacterCacheKey(id))
  })

  it('key contains the version number', () => {
    const key = buildCharacterCacheKey('char-x') as string
    expect(key).toContain(`v${PROMPT_CACHE_STRUCTURE_VERSION}`)
  })

  it('uses the char: prefix (not chat:)', () => {
    const key = buildCharacterCacheKey('any') as string
    expect(key.startsWith('quilltap:char:')).toBe(true)
  })

  it('PROMPT_CACHE_STRUCTURE_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROMPT_CACHE_STRUCTURE_VERSION)).toBe(true)
    expect(PROMPT_CACHE_STRUCTURE_VERSION).toBeGreaterThan(0)
  })
})
