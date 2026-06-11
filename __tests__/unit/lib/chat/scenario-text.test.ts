/**
 * Unit tests for scenario-text.ts
 * Tests combining a resolved preset scenario body with free-text notes.
 */

import { combineScenarioText } from '@/lib/chat/scenario-text'

describe('combineScenarioText', () => {
  it('appends free text beneath a preset body with a blank-line separator', () => {
    expect(combineScenarioText('A tavern at dusk.', 'It is raining.')).toBe(
      'A tavern at dusk.\n\nIt is raining.'
    )
  })

  it('returns just the free text when no preset is present', () => {
    expect(combineScenarioText(undefined, 'It is raining.')).toBe('It is raining.')
    expect(combineScenarioText(null, 'It is raining.')).toBe('It is raining.')
    expect(combineScenarioText('', 'It is raining.')).toBe('It is raining.')
  })

  it('returns just the preset body when there is no free text', () => {
    expect(combineScenarioText('A tavern at dusk.', undefined)).toBe('A tavern at dusk.')
    expect(combineScenarioText('A tavern at dusk.', null)).toBe('A tavern at dusk.')
    expect(combineScenarioText('A tavern at dusk.', '')).toBe('A tavern at dusk.')
  })

  it('ignores whitespace-only free text (no trailing separator)', () => {
    expect(combineScenarioText('A tavern at dusk.', '   \n  ')).toBe('A tavern at dusk.')
  })

  it('returns undefined when both sides are empty', () => {
    expect(combineScenarioText(undefined, undefined)).toBeUndefined()
    expect(combineScenarioText('', '')).toBeUndefined()
    expect(combineScenarioText('   ', '   ')).toBeUndefined()
  })

  it('trims trailing whitespace on the preset body before joining', () => {
    expect(combineScenarioText('A tavern at dusk.\n\n', 'It is raining.')).toBe(
      'A tavern at dusk.\n\nIt is raining.'
    )
  })

  it('preserves leading whitespace on the preset body', () => {
    expect(combineScenarioText('  Indented opening.', 'Extra.')).toBe(
      '  Indented opening.\n\nExtra.'
    )
  })

  it('trims the free text before appending', () => {
    expect(combineScenarioText('Base.', '  padded notes  ')).toBe('Base.\n\npadded notes')
  })
})
