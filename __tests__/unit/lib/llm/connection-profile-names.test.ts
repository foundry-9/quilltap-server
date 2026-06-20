import { describe, expect, it } from '@jest/globals'

import {
  normalizeProfileName,
  makeUniqueProfileName,
} from '@/lib/llm/connection-profile-names'

describe('normalizeProfileName', () => {
  it('trims and lower-cases', () => {
    expect(normalizeProfileName('  Claude Fast  ')).toBe('claude fast')
  })

  it('treats case/whitespace variants as equal', () => {
    expect(normalizeProfileName('GPT-4')).toBe(normalizeProfileName('  gpt-4 '))
  })
})

describe('makeUniqueProfileName', () => {
  it('returns the trimmed desired name when nothing collides', () => {
    expect(makeUniqueProfileName('  My Profile  ', new Set())).toBe('My Profile')
  })

  it('suffixes (2) on the first collision', () => {
    const taken = new Set([normalizeProfileName('My Profile')])
    expect(makeUniqueProfileName('My Profile', taken)).toBe('My Profile (2)')
  })

  it('matches collisions case- and whitespace-insensitively', () => {
    const taken = new Set([normalizeProfileName('my profile')])
    expect(makeUniqueProfileName('  My Profile ', taken)).toBe('My Profile (2)')
  })

  it('walks up past taken suffixes', () => {
    const taken = new Set([
      normalizeProfileName('Anthropic/claude'),
      normalizeProfileName('Anthropic/claude (2)'),
    ])
    expect(makeUniqueProfileName('Anthropic/claude', taken)).toBe('Anthropic/claude (3)')
  })
})
