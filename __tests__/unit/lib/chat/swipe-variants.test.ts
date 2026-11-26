/**
 * Which swipe variant stands (#236): the server reads a swipe group as its
 * newest variant, the one the Salon shows by default.
 */

import { liveSwipeVariantIds, withoutSupersededSwipes } from '@/lib/chat/swipe-variants'

const row = (id: string, swipeGroupId?: string | null, swipeIndex?: number | null) => ({ id, swipeGroupId, swipeIndex })

describe('withoutSupersededSwipes', () => {
  it('keeps every line outside a swipe group', () => {
    const rows = [row('a'), row('b', null, null), row('c')]
    expect(withoutSupersededSwipes(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps only the highest-index variant of each group, in stored order', () => {
    const rows = [
      row('u1'),
      row('g1-0', 'g1', 0),
      row('g1-2', 'g1', 2),
      row('u2'),
      row('g2-0', 'g2', null),
      row('g2-1', 'g2', 1),
      row('g1-1', 'g1', 1),
    ]
    expect(withoutSupersededSwipes(rows).map(r => r.id)).toEqual(['u1', 'g1-2', 'u2', 'g2-1'])
  })

  it('treats a missing index as 0 and lets the later row win a tie', () => {
    const rows = [row('first', 'g', null), row('second', 'g', 0)]
    expect(liveSwipeVariantIds(rows).get('g')).toBe('second')
  })

  it('keeps a lone grouped row', () => {
    expect(withoutSupersededSwipes([row('only', 'g', 0)]).map(r => r.id)).toEqual(['only'])
  })
})
