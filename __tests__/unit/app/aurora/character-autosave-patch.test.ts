/**
 * Draft → PUT body for the character page's autosave: the physical
 * description travels whole, merged over the stored record, with a name.
 */

import {
  buildCharacterPatch,
  mergePhysicalDescription,
  validateCharacterDraft,
} from '@/app/aurora/[id]/hooks/useCharacterAutosave'
import type { Character } from '@/app/aurora/[id]/types'

const stored: Character = {
  id: 'c1',
  name: 'Ada',
  physicalDescription: { id: 'pd1', name: 'Base', shortPrompt: 'tall', mediumPrompt: 'tall, dark', humanoid: false },
}

describe('buildCharacterPatch', () => {
  it('passes plain fields through and trims name and title', () => {
    expect(buildCharacterPatch({ name: ' Ada ', title: ' the rival ', personality: 'Brave ' }, stored).body).toEqual({
      name: 'Ada',
      title: 'the rival',
      personality: 'Brave ',
    })
  })

  it('sends the physical description whole, with only the drafted fields changed', () => {
    const { body } = buildCharacterPatch({ 'physicalDescription.shortPrompt': 'very tall' }, stored)
    expect(body.physicalDescription).toMatchObject({
      id: 'pd1',
      name: 'Base',
      shortPrompt: 'very tall',
      mediumPrompt: 'tall, dark',
      humanoid: false,
    })
  })

  it('names a new physical description when its name is blank', () => {
    const pd = mergePhysicalDescription(null, { longPrompt: 'x' })
    expect(pd.name).toBe('Base Appearance')
    expect(pd.humanoid).toBe(true)
    expect(pd.longPrompt).toBe('x')
    expect(pd.shortPrompt).toBeNull()
  })
})

describe('validateCharacterDraft', () => {
  it('refuses a blank name only', () => {
    expect(validateCharacterDraft('name', '  ')).toMatch(/name/)
    expect(validateCharacterDraft('name', 'Ada')).toBeNull()
    expect(validateCharacterDraft('title', '')).toBeNull()
  })
})
