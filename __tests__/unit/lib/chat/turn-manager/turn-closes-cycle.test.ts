/**
 * turnClosesCycle — the signal Turns mode stops its chain on. It must agree
 * with the cycle wrap in computeSpokenThisCycleAfterMessage / AfterSkip, so
 * these tests check both together.
 */

import { computeSpokenThisCycleAfterSkip, turnClosesCycle } from '@/lib/chat/turn-manager/state'
import type { ChatParticipantBase } from '@/lib/schemas/types'

const seat = (id: string, controlledBy: 'llm' | 'user' = 'llm') => ({
  id,
  type: 'CHARACTER',
  characterId: `char-${id}`,
  controlledBy,
  status: 'active',
  isActive: true,
}) as unknown as ChatParticipantBase

const room = [seat('a'), seat('b'), seat('me', 'user')]

describe('turnClosesCycle', () => {
  it('is false while seats are still owed a turn', () => {
    expect(turnClosesCycle('a', room, JSON.stringify(['me']))).toBe(false)
  })

  it('is true for the turn that completes the set', () => {
    expect(turnClosesCycle('b', room, JSON.stringify(['me', 'a']))).toBe(true)
  })

  it('agrees with the cycle wrap', () => {
    const before = JSON.stringify(['me', 'a'])
    expect(turnClosesCycle('b', room, before)).toBe(true)
    expect(computeSpokenThisCycleAfterSkip('b', room, before)).toBe(JSON.stringify(['b']))
  })

  it('is false at the start of a fresh chat', () => {
    expect(turnClosesCycle('a', room, '[]')).toBe(false)
    expect(turnClosesCycle('a', room, null)).toBe(false)
  })

  it('treats malformed JSON as an empty cycle', () => {
    expect(turnClosesCycle('a', room, 'not json')).toBe(false)
  })

  it('closes on every turn in a one-seat room', () => {
    expect(turnClosesCycle('a', [seat('a')], '[]')).toBe(true)
  })

  it('ignores departed seats still named in the cycle', () => {
    expect(turnClosesCycle('b', room, JSON.stringify(['me', 'gone']))).toBe(false)
  })
})
