/**
 * `formatSlotLabels` — the one way a garment list prints its slots.
 */

import { formatSlotLabels } from '../wardrobe.types'

describe('formatSlotLabels', () => {
  it('uses display labels, not raw keys', () => {
    expect(formatSlotLabels(['top', 'bottom'])).toBe('Top, Bottom')
  })

  it('orders slots canonically whatever order they arrive in', () => {
    expect(formatSlotLabels(['hair', 'footwear', 'top', 'accessories'])).toBe(
      'Top, Footwear, Accessories, Hair',
    )
  })

  it('ignores unknown entries', () => {
    expect(formatSlotLabels(['bottom', 'cape', 'top'])).toBe('Top, Bottom')
  })

  it('returns an empty string for no slots', () => {
    expect(formatSlotLabels([])).toBe('')
  })
})
