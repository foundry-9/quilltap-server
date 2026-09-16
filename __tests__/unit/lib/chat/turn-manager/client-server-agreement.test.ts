/**
 * The client and the server must answer "who speaks next" the same way (Bug 147).
 *
 * The rotation is drawn and persisted once, by `resolveCycleOrder` on the server,
 * precisely so every reader agrees. The Salon then recomputes the answer locally
 * from two chat columns plus history — and `GET /api/v1/chats/[id]` was not
 * sending those two columns. Absent, they parse to an empty rotation and an
 * empty spoken-set, which is indistinguishable from a fresh chat, so
 * `selectNextSpeaker` skipped its cycle-order branch and re-rolled a weighted
 * pick on every recompute.
 *
 * The room here is the one from the report (Friday, chat `e59f8969`): the
 * operator's own Charlie plus four LLM seats, one of which — Leilani — they had
 * taken up by impersonation. Talkativeness is deliberately lopsided so the
 * re-roll is deterministic and the divergence is exact rather than statistical.
 */

import {
  selectNextSpeaker,
  selectNextSpeakerAfterUserMessage,
  calculateTurnStateFromHistory,
  computeSpokenThisCycleAfterMessage,
  computeCycleOrderAfterMessage,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character, ChatEvent, MessageEvent } from '@/lib/schemas/types'

const now = new Date().toISOString()

const ABIGAIL = '1cbe72f5'
const CHARLIE = 'f08a46e0'
const BARAKA = '788b657a'
const LEILANI = '2c91e03b'
const GEN314 = '45be895a'

const makeSeat = (
  id: string,
  controlledBy: 'user' | 'llm',
  talkativeness: number,
  displayOrder: number,
): ChatParticipantBase => ({
  id,
  type: 'CHARACTER',
  characterId: `char-${id}`,
  controlledBy,
  connectionProfileId: null,
  imageProfileId: null,
  displayOrder,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  talkativeness,
  createdAt: now,
  updatedAt: now,
})

// Abigail carries all the weight, so any weighted re-roll lands on her — an LLM
// seat, and never the seat the rotation had reserved.
const participants: ChatParticipantBase[] = [
  makeSeat(ABIGAIL, 'llm', 1, 0),
  makeSeat(CHARLIE, 'user', 0, 1),
  makeSeat(BARAKA, 'llm', 0, 2),
  makeSeat(LEILANI, 'llm', 0, 3),
  makeSeat(GEN314, 'llm', 0, 4),
]

const characters = new Map<string, Character>(
  participants.map(p => [p.characterId!, { id: p.characterId!, talkativeness: 0.5 } as Character]),
)

/** Leilani is user-driven only through the overlay; her column stays 'llm'. */
const impersonating = [LEILANI]

/** The cycle is under way: three LLM seats have spoken, Charlie and Leilani have not. */
const spokenBefore = JSON.stringify([ABIGAIL, BARAKA, GEN314])
const orderBefore = JSON.stringify([LEILANI, CHARLIE])

const history: MessageEvent[] = [
  { type: 'message', id: 'm1', role: 'ASSISTANT', content: '…', attachments: [], createdAt: now, participantId: ABIGAIL },
  // The operator's post, typed as the seat they had taken up.
  { type: 'message', id: 'm2', role: 'USER', content: '…', attachments: [], createdAt: now, participantId: LEILANI },
] as unknown as MessageEvent[]

/** What `addMessage` writes to the two columns when that post lands. */
const post = { type: 'message', role: 'USER', participantId: LEILANI } as unknown as ChatEvent
const spokenAfter = computeSpokenThisCycleAfterMessage(post, participants, spokenBefore)!
const orderAfter = computeCycleOrderAfterMessage(post, orderBefore)!

describe('client/server turn agreement after a user post', () => {
  /** The server's answer, from the projection the orchestrator actually uses. */
  const server = selectNextSpeakerAfterUserMessage(
    participants,
    characters,
    LEILANI,
    spokenBefore,
    '[]',
    CHARLIE,
    impersonating,
    orderBefore,
  )

  const clientPick = (
    spokenJson: string | undefined,
    orderJson: string | undefined,
  ) => {
    const turnState = calculateTurnStateFromHistory({
      messages: history,
      participants,
      userParticipantId: CHARLIE,
      spokenThisCycleParticipantIds: spokenJson,
      cycleOrderParticipantIds: orderJson,
    })
    return selectNextSpeaker(participants, characters, turnState, CHARLIE)
  }

  it('the server hands the floor to the owner seat, not back to the poster', () => {
    expect(server.nextSpeakerId).toBe(CHARLIE)
    expect(server.reason).toBe('user_turn')
  })

  it('the client agrees with the server when it is given the two columns', () => {
    const client = clientPick(spokenAfter, orderAfter)
    expect(client.nextSpeakerId).toBe(server.nextSpeakerId)
    expect(client.nextSpeakerId).toBe(CHARLIE)
  })

  it('the client also agrees while its copy of the row is still pre-post', () => {
    // The recompute fires on the optimistic bubble, before `fetchChat` lands.
    // The poster is excluded as `lastSpeakerId`, so the answer must not move.
    const client = clientPick(spokenBefore, orderBefore)
    expect(client.nextSpeakerId).toBe(CHARLIE)
  })

  it('without the columns the client cannot follow the rotation at all (the bug)', () => {
    const client = clientPick(undefined, undefined)

    // The signature of the blindness: an empty rotation is indistinguishable
    // from a fresh chat, so the cycle-order branch is unreachable.
    expect(client.reason).toBe('weighted_selection')

    // And the re-roll contradicts the server: an LLM seat takes a floor the
    // rotation had reserved for the operator's own character.
    expect(client.nextSpeakerId).toBe(ABIGAIL)
    expect(client.nextSpeakerId).not.toBe(server.nextSpeakerId)
  })

  it('an already-spoken seat is never re-seated once the columns arrive', () => {
    // The same blindness let a seat that had already taken its turn this cycle
    // come up again, because `spokenSinceUserTurn` was empty too.
    const blind = clientPick(undefined, undefined)
    expect(JSON.parse(spokenBefore)).toContain(blind.nextSpeakerId)

    const sighted = clientPick(spokenAfter, orderAfter)
    expect(JSON.parse(spokenAfter)).not.toContain(sighted.nextSpeakerId)
  })
})
