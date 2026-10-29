/**
 * @jest-environment node
 *
 * narrationDelimiters storage codec: a pair and a null must survive the SQLite
 * round trip, and legacy raw rows must still read correctly.
 */

import {
  encodeNarrationDelimiters,
  decodeNarrationDelimiters,
} from '@/lib/database/repositories/roleplay-template-narration-codec'

describe('roleplay template narration codec', () => {
  it.each([
    ['*'],
    ['+'],
    ['"'],
    [['[', ']'] as [string, string]],
    [null],
  ])('round-trips %p', (value) => {
    expect(decodeNarrationDelimiters(encodeNarrationDelimiters(value))).toEqual(value)
  })

  it('reads legacy raw delimiter strings as-is', () => {
    expect(decodeNarrationDelimiters('*')).toBe('*')
    expect(decodeNarrationDelimiters('~')).toBe('~')
  })

  it('reads the pair JSON a legacy row stored as text (Quilltap RP)', () => {
    expect(decodeNarrationDelimiters('["[","]"]')).toEqual(['[', ']'])
  })

  it('reads a missing value as the historical default', () => {
    expect(decodeNarrationDelimiters(undefined)).toBe('*')
    expect(decodeNarrationDelimiters('')).toBe('*')
  })

  it('passes already-decoded values through', () => {
    expect(decodeNarrationDelimiters(null)).toBeNull()
    expect(decodeNarrationDelimiters(['{', '}'])).toEqual(['{', '}'])
  })
})
