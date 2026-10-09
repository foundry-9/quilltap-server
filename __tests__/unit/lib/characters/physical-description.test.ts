/**
 * pickPhysicalDescription (lib/characters/physical-description.ts): the one
 * place a reader's preferred physical-description variant order lives.
 */

import { hasPhysicalDescription, pickPhysicalDescription } from '@/lib/characters/physical-description'

const all = {
  headAndShouldersPrompt: 'H&S',
  shortPrompt: 'SHORT',
  mediumPrompt: 'MEDIUM',
  longPrompt: 'LONG',
  completePrompt: 'COMPLETE',
  fullDescription: 'FULL',
}

describe('pickPhysicalDescription', () => {
  it.each([
    ['head-and-shoulders', 'H&S'],
    ['full-length', 'COMPLETE'],
    ['scene', 'MEDIUM'],
    ['self-image', 'SHORT'],
    ['fullest', 'FULL'],
  ] as const)('%s leads with its own variant', (profile, expected) => {
    expect(pickPhysicalDescription(all, profile)).toBe(expected)
  })

  it('falls through in order, skipping blanks and trimming', () => {
    const desc = { headAndShouldersPrompt: '   ', mediumPrompt: null, shortPrompt: '  short text  ', longPrompt: 'LONG' }
    expect(pickPhysicalDescription(desc, 'head-and-shoulders')).toBe('short text')
    expect(pickPhysicalDescription(desc, 'full-length')).toBe('LONG')
  })

  it('never uses the head-and-shoulders crop for a scene figure', () => {
    expect(pickPhysicalDescription({ headAndShouldersPrompt: 'H&S' }, 'scene')).toBe('')
    expect(hasPhysicalDescription({ headAndShouldersPrompt: 'H&S' }, 'scene')).toBe(false)
    expect(pickPhysicalDescription({ headAndShouldersPrompt: 'H&S' }, 'full-length')).toBe('H&S')
  })

  it('answers empty for no description at all', () => {
    expect(pickPhysicalDescription(null, 'scene')).toBe('')
    expect(pickPhysicalDescription(undefined, 'self-image')).toBe('')
    expect(hasPhysicalDescription({ fullDescription: 'prose' }, 'scene')).toBe(true)
  })
})
