/**
 * pickPhysicalDescription (lib/characters/physical-description.ts): the one
 * place a reader's preferred physical-description variant order lives.
 */

import { hasPhysicalDescription, isHumanoid, pickPhysicalDescription } from '@/lib/characters/physical-description'

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

describe('isHumanoid', () => {
  it('reads absent as humanoid; only an explicit false is not', () => {
    expect(isHumanoid(null)).toBe(true)
    expect(isHumanoid(undefined)).toBe(true)
    expect(isHumanoid({})).toBe(true)
    expect(isHumanoid({ humanoid: true })).toBe(true)
    expect(isHumanoid({ humanoid: false })).toBe(false)
  })

  it('never reads the head-and-shoulders prompt for a non-humanoid portrait', () => {
    expect(pickPhysicalDescription({ ...all, humanoid: false }, 'head-and-shoulders')).toBe('MEDIUM')
    expect(pickPhysicalDescription({ headAndShouldersPrompt: 'H&S', humanoid: false }, 'head-and-shoulders')).toBe('')
    // Other profiles are unchanged.
    expect(pickPhysicalDescription({ ...all, humanoid: false }, 'full-length')).toBe('COMPLETE')
  })
})
