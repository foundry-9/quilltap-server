/**
 * How a Salon turn closes once the model has answered (`resolveTurnOutcome`).
 *
 * The decision used to be spread through the tail of `processMessage` as a run
 * of early returns that mutated the response in place; it is now one pure
 * function, and these pin its table.
 */

import { resolveTurnOutcome, type TurnSkipOffer } from '@/lib/services/chat-message/turn-outcome.service'

const character = { name: 'Riya', aliases: [] }
const offered: TurnSkipOffer = { offerSkip: true, recentlyAddressed: false, characterName: 'Riya' }
const notOffered: TurnSkipOffer = { offerSkip: false, recentlyAddressed: true, characterName: 'Riya' }

function outcome(over: Partial<Parameters<typeof resolveTurnOutcome>[0]>) {
  return resolveTurnOutcome({
    response: '',
    toolCount: 0,
    stopped: false,
    offerYield: false,
    character,
    ...over,
  })
}

describe('resolveTurnOutcome', () => {
  it('keeps an ordinary reply', () => {
    expect(outcome({ response: 'She sets the cup down.' })).toEqual({
      kind: 'reply',
      response: 'She sets the cup down.',
      yielded: false,
    })
  })

  it('is tools-only when nothing was said but tools ran', () => {
    expect(outcome({ toolCount: 2 }).kind).toBe('tools-only')
  })

  it('is empty when the provider returned nothing', () => {
    expect(outcome({}).kind).toBe('empty')
  })

  it('is stopped (not empty) when the operator stopped it before a word', () => {
    expect(outcome({ stopped: true }).kind).toBe('stopped')
  })

  describe('raised hand', () => {
    it('a bare yield with no tools persists nothing', () => {
      expect(outcome({ response: '[YIELD]', offerYield: true })).toEqual({
        kind: 'bare-yield',
        response: '',
        yielded: true,
        handAnswered: { yielded: true },
      })
    })

    it('a yield that came with words is a reply that yielded', () => {
      const result = outcome({ response: '[YIELD]\nGo on, then.', offerYield: true })
      expect(result.kind).toBe('reply')
      expect(result.yielded).toBe(true)
      expect(result.response).toBe('Go on, then.')
    })

    it('a yield after tools ran keeps the tools', () => {
      const result = outcome({ response: '[YIELD]', offerYield: true, toolCount: 1 })
      expect(result.kind).toBe('tools-only')
      expect(result.yielded).toBe(true)
    })

    it('carrying on past the hand is answered no', () => {
      const result = outcome({ response: 'I was saying —', offerYield: true })
      expect(result.handAnswered).toEqual({ yielded: false })
      expect(result.kind).toBe('reply')
    })

    it('a stopped turn reads no sentinel and answers no hand', () => {
      const result = outcome({ response: '[YIELD]', offerYield: true, stopped: true })
      expect(result.handAnswered).toBeUndefined()
      expect(result.kind).toBe('reply')
      expect(result.response).toBe('[YIELD]')
    })

    it('a yielded turn is not then read as a pass', () => {
      const result = outcome({ response: '[YIELD]\n[NOTHING TO ADD]', offerYield: true, turnSkip: offered })
      expect(result.kind).toBe('reply')
      expect(result.yielded).toBe(true)
    })
  })

  describe('nothing to add', () => {
    it('an offered pass with no tools is a pass', () => {
      expect(outcome({ response: '[NOTHING TO ADD]', turnSkip: offered }).kind).toBe('pass')
    })

    it('a pass after tools ran is overridden: the tools win', () => {
      const result = outcome({ response: '[NOTHING TO ADD]', turnSkip: offered, toolCount: 1 })
      expect(result.kind).toBe('tools-only')
      expect(result.passOverriddenByTools).toBe(true)
      expect(result.response).toBe('')
    })

    it('a pass that was never offered is an empty answer', () => {
      expect(outcome({ response: '[NOTHING TO ADD]', turnSkip: notOffered }).kind).toBe('empty')
    })

    it('a sentinel line followed by prose keeps the prose', () => {
      const result = outcome({ response: '[NOTHING TO ADD]\nActually, one thing.', turnSkip: offered })
      expect(result.kind).toBe('reply')
      expect(result.response).toBe('Actually, one thing.')
    })

    it('is not read when no skip eligibility was computed', () => {
      const result = outcome({ response: '[NOTHING TO ADD]' })
      expect(result.kind).toBe('reply')
    })

    it('a half-written sentinel on a stopped turn is just words', () => {
      const result = outcome({ response: '[NOTHING TO', turnSkip: offered, stopped: true })
      expect(result.kind).toBe('reply')
      expect(result.response).toBe('[NOTHING TO')
    })
  })
})
