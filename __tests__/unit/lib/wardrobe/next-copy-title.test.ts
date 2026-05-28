import { describe, expect, it } from '@jest/globals'

import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title'

describe('nextCopyTitle', () => {
  it('appends "(copy)" when no copy exists', () => {
    expect(nextCopyTitle('Red Dress', ['Red Dress'])).toBe('Red Dress (copy)')
  })

  it('escalates to "(copy 2)" when "(copy)" is taken', () => {
    expect(nextCopyTitle('Red Dress', ['Red Dress', 'Red Dress (copy)'])).toBe(
      'Red Dress (copy 2)',
    )
  })

  it('keeps escalating past several existing copies', () => {
    expect(
      nextCopyTitle('Red Dress', [
        'Red Dress',
        'Red Dress (copy)',
        'Red Dress (copy 2)',
        'Red Dress (copy 3)',
      ]),
    ).toBe('Red Dress (copy 4)')
  })

  it('fills the lowest available gap', () => {
    expect(
      nextCopyTitle('Red Dress', ['Red Dress (copy)', 'Red Dress (copy 3)']),
    ).toBe('Red Dress (copy 2)')
  })

  it('strips an existing "(copy)" suffix from the source before appending', () => {
    expect(nextCopyTitle('Red Dress (copy)', ['Red Dress (copy)'])).toBe(
      'Red Dress (copy 2)',
    )
  })

  it('strips an existing "(copy N)" suffix from the source', () => {
    expect(
      nextCopyTitle('Red Dress (copy 3)', ['Red Dress (copy)', 'Red Dress (copy 2)']),
    ).toBe('Red Dress (copy 3)')
  })

  it('treats collisions case-insensitively', () => {
    expect(nextCopyTitle('Red Dress', ['red dress (copy)'])).toBe('Red Dress (copy 2)')
  })

  it('handles an empty existing-titles list', () => {
    expect(nextCopyTitle('Hat', [])).toBe('Hat (copy)')
  })
})
