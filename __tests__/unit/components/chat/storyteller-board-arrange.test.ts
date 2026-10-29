/**
 * Tests for arrangeBids — the storyteller board's card order.
 *
 * Untouched (no arrangement) the round's own order stands; once the operator
 * has dragged the cards, their order wins, a late bid the arrangement does not
 * name follows in the round's order, and a seat gone from the round is dropped.
 */

import { describe, it, expect } from '@jest/globals'
import { arrangeBids } from '@/components/chat/StorytellerBoard'
import type { StorytellerBid } from '@/lib/schemas/storyteller.types'

function bid(participantId: string): StorytellerBid {
  return {
    participantId,
    characterId: `char-${participantId}`,
    characterName: participantId,
    status: 'bid',
    statedTier: 'simple',
    tier: 'simple',
    tierRaised: false,
    tools: [],
    plan: null,
    reason: null,
    talkativeness: 0.5,
    silent: false,
    askedAt: null,
    answeredAt: null,
  }
}

const ids = (bids: StorytellerBid[]) => bids.map((b) => b.participantId)

describe('arrangeBids', () => {
  const bids = [bid('a'), bid('b'), bid('c')]

  it('keeps the round order when nothing has been arranged', () => {
    expect(ids(arrangeBids(bids, null))).toEqual(['a', 'b', 'c'])
  })

  it('follows the operator arrangement', () => {
    expect(ids(arrangeBids(bids, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })

  it('appends a late bid the arrangement does not name', () => {
    expect(ids(arrangeBids([...bids, bid('d')], ['b', 'a', 'c']))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('drops an arranged seat that is no longer in the round', () => {
    expect(ids(arrangeBids(bids, ['x', 'c', 'b', 'a']))).toEqual(['c', 'b', 'a'])
  })
})
