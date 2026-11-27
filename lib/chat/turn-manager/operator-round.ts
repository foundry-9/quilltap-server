/**
 * The operator's round in a chat where the human has no seat.
 *
 * A human who chats "as yourself" posts USER messages with no participant, so
 * those posts never enter the rotation's bookkeeping (`spokenThisCycle`, the
 * drawn cycle order). With a seat, the rotation reaches the human's seat and
 * the chain pauses there; without one, nothing ever hands the floor back, and
 * a room of two or more characters chained on — the cycle wrapping again and
 * again — until the depth or time cap, on every message. Bug 249 closed the
 * one-character case (`loneCharacterHasAnswered`); this closes the rest, to
 * the rule the help states: each present character answers once, then the
 * floor returns to you.
 *
 * Pure and client-safe.
 *
 * @module chat/turn-manager/operator-round
 */

import type { ChatParticipantBase } from '@/lib/schemas/types'
import { getPresentCharacterSeats, isUserDrivenSeat } from './utils'
import { isTurnPassMessage } from './skip-signal'

interface RoundMessage {
  type?: string
  role?: string
  participantId?: string | null
  systemSender?: string | null
}

/**
 * True when the human has posted in this chat, holds no seat in it, and every
 * present character seat has answered (or passed its turn) since that post.
 * The chain then stops and the floor returns to the operator.
 *
 * False for a chat with any user-driven seat (the rotation pauses there
 * itself), for a genuinely all-LLM chat (no human post: its own pause rule
 * governs it), and for autonomous rooms (`neverPauseForUser`).
 */
export function seatlessOperatorRoundAnswered(args: {
  participants: ChatParticipantBase[]
  impersonatingParticipantIds?: readonly string[] | null
  messages: readonly RoundMessage[]
  /** Character ids of archived characters, whose seats can no longer speak. */
  archivedCharacterIds?: ReadonlySet<string>
  neverPauseForUser: boolean
}): boolean {
  if (args.neverPauseForUser) return false

  const seats = getPresentCharacterSeats(args.participants)
  if (seats.some((p) => isUserDrivenSeat(p, args.impersonatingParticipantIds))) return false

  const speakingSeats = seats.filter(
    (p) => !(p.characterId && args.archivedCharacterIds?.has(p.characterId)),
  )
  if (speakingSeats.length === 0) return false

  let lastPost = -1
  for (let i = args.messages.length - 1; i >= 0; i--) {
    const m = args.messages[i]
    if (m.role === 'USER' && !m.systemSender) {
      lastPost = i
      break
    }
  }
  if (lastPost < 0) return false

  const answered = new Set<string>()
  for (let i = lastPost + 1; i < args.messages.length; i++) {
    const m = args.messages[i]
    if (isTurnPassMessage(m)) {
      answered.add(m.hostEvent.participantId)
    } else if (m.role === 'ASSISTANT' && !m.systemSender && m.participantId) {
      answered.add(m.participantId)
    }
  }

  return speakingSeats.every((p) => answered.has(p.id))
}
