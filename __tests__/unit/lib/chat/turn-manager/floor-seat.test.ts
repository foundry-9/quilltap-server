/**
 * Which seat the "your turn" banner speaks for (Bug 146).
 *
 * The banner answers "whose turn is it", and its Skip passes that turn. With two
 * seats the human drives, that is a different question from "whose voice will the
 * composer take" — and answering the second while the human reads the first is
 * what made a single post prompt twice and record a pass for a seat that had just
 * spoken. `resolveFloorSeatId` is the settlement: the rotation wins when it has
 * landed on a seat the human drives; the composer's seat is kept only off-turn.
 */

import { resolveFloorSeatId } from '@/lib/chat/turn-manager'
import type { ChatParticipantBase } from '@/lib/schemas/types'

const now = new Date().toISOString()

const seat = (
  id: string,
  overrides: Partial<ChatParticipantBase> = {},
): ChatParticipantBase => ({
  id,
  type: 'CHARACTER',
  characterId: `char-${id}`,
  controlledBy: 'llm',
  connectionProfileId: null,
  imageProfileId: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

/** The shape of the chat that produced Bug 146: two seats the human drives. */
const charlie = seat('charlie', { controlledBy: 'user', displayOrder: 1 })
const helene = seat('helene', { controlledBy: 'user', displayOrder: 5 })
const wahno = seat('wahno', { displayOrder: 2 })
const room = [wahno, charlie, helene]

describe('resolveFloorSeatId', () => {
  it('prefers the seat the rotation landed on over the composer’s seat', () => {
    // Helene has just posted; the floor is Charlie's. The composer is still
    // pointed at Helene, and before the fix that is what Skip passed.
    expect(resolveFloorSeatId(charlie.id, room, [], helene.id)).toBe(charlie.id)
  })

  it('keeps the composer’s seat when the floor belongs to an LLM', () => {
    // Bug 123's off-turn affordance: nothing of the human's is outstanding, so
    // the banner stays about the seat they are typing as.
    expect(resolveFloorSeatId(wahno.id, room, [], helene.id)).toBe(helene.id)
  })

  it('keeps the composer’s seat when there is no selection yet', () => {
    expect(resolveFloorSeatId(null, room, [], helene.id)).toBe(helene.id)
    expect(resolveFloorSeatId(undefined, room, [], charlie.id)).toBe(charlie.id)
  })

  it('agrees with the composer when both name the same seat', () => {
    expect(resolveFloorSeatId(helene.id, room, [], helene.id)).toBe(helene.id)
  })

  it('sends the floor to the owner seat when the composer holds an impersonated one', () => {
    // The second sighting (Friday, chat `e59f8969`, 2026-09-16): Leilani is an
    // LLM seat the operator had taken up, so her `controlledBy` is still 'llm'
    // and only the overlay makes her theirs. She posts, the floor goes to the
    // owner seat Charlie, and the composer is still on Leilani — which is what
    // recorded "Leilani declining the floor" for a turn she had just held.
    const leilani = seat('leilani', { displayOrder: 3 })
    const withLeilani = [...room, leilani]
    expect(resolveFloorSeatId(charlie.id, withLeilani, ['leilani'], leilani.id)).toBe(charlie.id)
  })

  it('honours the impersonation overlay, not the bare controlledBy column', () => {
    // An impersonated seat's durable `controlledBy` stays 'llm' (Bug 44), so a
    // reader that consulted the column alone would hand the floor back to the
    // composer and pass the wrong turn.
    const lorian = seat('lorian', { displayOrder: 3 })
    const withLorian = [...room, lorian]
    expect(resolveFloorSeatId(lorian.id, withLorian, ['lorian'], charlie.id)).toBe(lorian.id)
    expect(resolveFloorSeatId(lorian.id, withLorian, [], charlie.id)).toBe(charlie.id)
  })

  it('falls back when the rotation names a seat that has left the room', () => {
    const departed = seat('departed', { controlledBy: 'user', status: 'removed', isActive: false })
    expect(resolveFloorSeatId(departed.id, [...room, departed], [], helene.id)).toBe(helene.id)
  })

  it('returns null when neither the floor nor the composer names a seat', () => {
    expect(resolveFloorSeatId(wahno.id, room, [], null)).toBeNull()
    expect(resolveFloorSeatId(null, room, [], null)).toBeNull()
  })
})
