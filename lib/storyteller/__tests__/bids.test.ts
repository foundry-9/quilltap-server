/**
 * Storyteller bids — parsing, tier computation, board cards, invitations.
 */

import { parseBidReply } from '../bid-parse'
import { computeBidTier } from '../tiers'
import { cardFromOutcome } from '../cards'
import { biddableSeats, chooseInvitees, inviteProbability } from '../invite'
import type { StorytellerBidOffer } from '../types'
import type { StorytellerBid } from '@/lib/schemas/storyteller.types'
import type { ChatParticipantBase } from '@/lib/schemas/chat.types'
import type { Character } from '@/lib/schemas/character.types'

const OFFER: StorytellerBidOffer = {
  tools: { doc_read_file: 'read', search: 'read', doc_write_file: 'write', doc_delete_file: 'destroy', whisper: 'none' },
  customTools: { peek: 'read', unlock: 'write' },
  destroyOffered: true,
  silent: false,
}

describe('parseBidReply', () => {
  it('reads the four labelled lines', () => {
    expect(parseBidReply('BID: speak\nTIER: lookup\nTOOLS: doc_read_file, run_custom:peek\nPLAN: I check the ledger, then tell them.')).toEqual({
      speak: true,
      statedTier: 'lookup',
      tools: ['doc_read_file', 'run_custom:peek'],
      plan: 'I check the ledger, then tell them.',
    })
  })

  it('forgives case, emphasis, order, separators and a fenced block', () => {
    const parsed = parseBidReply('```\n**plan** - I say hello\n   and wave.\n*bid*: Speak\ntier = SIMPLE\ntools: none\n```')
    expect(parsed).toEqual({ speak: true, statedTier: 'simple', tools: [], plan: 'I say hello and wave.' })
  })

  it('reads a pass, keeping any reason given as the plan', () => {
    expect(parseBidReply('BID: pass\nPLAN: Nothing to add.')).toMatchObject({ speak: false, plan: 'Nothing to add.' })
  })

  it('maps tier synonyms', () => {
    expect(parseBidReply('BID: speak\nTIER: write')?.statedTier).toBe('act')
    expect(parseBidReply('BID: speak\nTIER: read-only lookup')?.statedTier).toBe('lookup')
  })

  it('returns null for anything unreadable', () => {
    expect(parseBidReply('')).toBeNull()
    expect(parseBidReply('I would love to speak!')).toBeNull()
    expect(parseBidReply('BID: maybe later')).toBeNull()
  })
})

describe('computeBidTier', () => {
  const bid = (statedTier: 'simple' | 'lookup' | 'act' | 'destroy' | null, tools: string[]) =>
    ({ speak: true, statedTier, tools, plan: 'x' })

  it('keeps the claim when the tools agree', () => {
    expect(computeBidTier(bid('lookup', ['doc_read_file']), OFFER)).toMatchObject({ tier: 'lookup', raised: false })
  })

  it('raises the tier to the highest named tool and says so', () => {
    expect(computeBidTier(bid('lookup', ['doc_write_file']), OFFER)).toMatchObject({ tier: 'act', raised: true })
    expect(computeBidTier(bid('simple', ['run_custom:unlock']), OFFER)).toMatchObject({ tier: 'act', raised: true })
    expect(computeBidTier(bid('act', ['doc_delete_file']), OFFER)).toMatchObject({ tier: 'destroy', raised: true })
  })

  it('never lowers a claim', () => {
    expect(computeBidTier(bid('act', ['search']), OFFER)).toMatchObject({ tier: 'act', raised: false })
  })

  it('infers from the tools when no tier was stated, without calling it raised', () => {
    expect(computeBidTier(bid(null, ['search']), OFFER)).toMatchObject({ tier: 'lookup', raised: false })
    expect(computeBidTier(bid(null, []), OFFER)).toMatchObject({ tier: 'simple', raised: false })
  })

  it('drops tools that were not on the menu', () => {
    expect(computeBidTier(bid('simple', ['launch_missiles', 'peek']), OFFER)).toMatchObject({
      tier: 'lookup',
      tools: ['peek'],
      unknownTools: ['launch_missiles'],
    })
  })

  it('caps a Destroy claim at Act when there is nothing to destroy with', () => {
    expect(computeBidTier(bid('destroy', []), { ...OFFER, destroyOffered: false })).toMatchObject({ tier: 'act' })
  })
})

describe('cardFromOutcome', () => {
  const base: StorytellerBid = {
    participantId: 'p1', characterId: 'c1', characterName: 'Riya', status: 'pending',
    statedTier: null, tier: null, tierRaised: false, tools: [], plan: null, reason: null,
    talkativeness: 0.5, silent: false, askedAt: null, answeredAt: null,
  }

  it('turns a failed call into an error card', () => {
    expect(cardFromOutcome(base, { ok: false, reason: 'refused' }, 't')).toMatchObject({ status: 'error', reason: 'refused' })
  })

  it('turns an unreadable reply into a pass', () => {
    expect(cardFromOutcome(base, { ok: true, text: 'hmm', discardedToolCalls: [], offered: OFFER }, 't')).toMatchObject({ status: 'pass' })
  })

  it('turns a bid into a card with the computed tier', () => {
    const card = cardFromOutcome(base, {
      ok: true,
      text: 'BID: speak\nTIER: simple\nTOOLS: doc_write_file\nPLAN: I write it down.',
      discardedToolCalls: [],
      offered: OFFER,
    }, 't')
    expect(card).toMatchObject({ status: 'bid', statedTier: 'simple', tier: 'act', tierRaised: true, tools: ['doc_write_file'], plan: 'I write it down.', answeredAt: 't' })
  })
})

describe('invitations', () => {
  const participant = (id: string, extra: Partial<ChatParticipantBase> = {}) => ({
    id, type: 'CHARACTER', characterId: `c-${id}`, controlledBy: 'llm', status: 'active', ...extra,
  }) as unknown as ChatParticipantBase
  const characters = new Map<string, Character>([
    ['c-a', { id: 'c-a', name: 'A', talkativeness: 0.9 } as Character],
    ['c-b', { id: 'c-b', name: 'B', talkativeness: 0.1 } as Character],
    ['c-arch', { id: 'c-arch', name: 'Gone', archivedAt: '2026-01-01' } as unknown as Character],
  ])

  it('asks present LLM seats, silent ones included, and nobody the operator drives', () => {
    const seats = biddableSeats([
      participant('a'),
      participant('b', { status: 'silent' }),
      participant('user', { controlledBy: 'user' }),
      participant('imp'),
      participant('absent', { status: 'absent' }),
      participant('arch'),
    ], characters, ['imp'])
    expect(seats.map((s) => s.participant.id)).toEqual(['a', 'b'])
    expect(seats.find((s) => s.participant.id === 'b')?.silent).toBe(true)
  })

  it('invites everyone with the filter off', () => {
    const seats = biddableSeats([participant('a'), participant('b')], characters, [])
    expect(chooseInvitees(seats, { filter: false, random: () => 0.99 }).keptQuiet).toEqual([])
  })

  it('weights the filter by talkativeness', () => {
    expect(inviteProbability(0)).toBe(0.25)
    expect(inviteProbability(1)).toBe(1)
    const seats = biddableSeats([participant('a'), participant('b')], characters, [])
    // 0.5 is under A's chance (0.925) and over B's (0.325)
    const { invited, keptQuiet } = chooseInvitees(seats, { filter: true, random: () => 0.5 })
    expect(invited.map((s) => s.participant.id)).toEqual(['a'])
    expect(keptQuiet.map((s) => s.participant.id)).toEqual(['b'])
  })
})
