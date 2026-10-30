/**
 * Unit tests for ChatHeaderBreadcrumb's pure helpers
 *
 * Tests:
 * - abbreviateName: one word, several words, minor words, short names
 * - chooseDensity: first density that fits, falling back to avatar-only
 */

import { abbreviateName, chooseDensity } from '@/components/chat/ChatHeaderBreadcrumb'

describe('abbreviateName', () => {
  it('keeps the first three letters of a single long word', () => {
    expect(abbreviateName('Abigail')).toBe('Abi')
    expect(abbreviateName('Revenant')).toBe('Rev')
  })

  it('keeps a short single word whole', () => {
    expect(abbreviateName('Amy')).toBe('Amy')
    expect(abbreviateName('Riya')).toBe('Riya')
  })

  it('uses initials for several words, dropping minor words', () => {
    expect(abbreviateName('Baraka Ilunga')).toBe('BI')
    expect(abbreviateName('Voyages of the Covenant')).toBe('VC')
  })

  it('caps initials at four letters', () => {
    expect(abbreviateName('One Two Three Four Five')).toBe('OTTF')
  })

  it('falls back to every word when all are minor', () => {
    expect(abbreviateName('Of The')).toBe('OT')
  })

  it('returns empty for a blank name', () => {
    expect(abbreviateName('   ')).toBe('')
  })
})

describe('chooseDensity', () => {
  const widths = { full: 600, abbrev: 400, avatar: 250 }

  it('picks full when it fits', () => {
    expect(chooseDensity(700, widths)).toBe('full')
  })

  it('picks abbrev when only it and avatar fit', () => {
    expect(chooseDensity(450, widths)).toBe('abbrev')
  })

  it('picks avatar when only it fits', () => {
    expect(chooseDensity(300, widths)).toBe('avatar')
  })

  it('falls back to avatar when nothing fits', () => {
    expect(chooseDensity(100, widths)).toBe('avatar')
  })
})
