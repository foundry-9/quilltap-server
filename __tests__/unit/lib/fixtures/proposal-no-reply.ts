/**
 * Regression fixture for mechanism 6 of the anti-committee spec
 * (docs/developer/features/prompt-trust-and-anti-committee.md §10.2):
 * manufactured consent in memory extraction.
 *
 * A user-controlled persona opens the turn with an out-of-character stage
 * direction; two AI characters answer; the second ends the turn on a
 * condition aimed at the persona. No further USER message exists, so nothing
 * in the turn is assent — and the extractor used to record "Owen agreed" for
 * every observer and "I accepted" into Owen's own memories.
 *
 * A second fixture carries a temporary measure ("custody, not confiscation —
 * you get it back at breakfast") whose limit must survive extraction.
 *
 * Lives under __tests__/unit/lib/fixtures/ (ignored by jest's testMatch) and
 * is shared by the unit regression test and the opt-in live eval in
 * __tests__/eval/memory-consent/.
 */

import { buildTurnTranscript, type TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import type { OtherSubjectInput } from '@/lib/memory/cheap-llm-tasks/memory-tasks'
import type { Character, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'

function userMsg(id: string, participantId: string, content: string): MessageEvent {
  return {
    id,
    type: 'message',
    role: 'USER',
    content,
    participantId,
    attachments: [],
    createdAt: '2026-09-30T20:00:00.000Z',
  } as MessageEvent
}

function assistantMsg(id: string, participantId: string, content: string, second: number): MessageEvent {
  return {
    id,
    type: 'message',
    role: 'ASSISTANT',
    content,
    participantId,
    attachments: [],
    createdAt: `2026-09-30T20:00:0${second}.000Z`,
  } as MessageEvent
}

function makeCharacter(id: string, name: string, pronouns: Character['pronouns']): Character {
  return {
    id,
    userId: 'user-1',
    name,
    description: '',
    personality: '',
    background: '',
    pronouns,
    aliases: [],
    physicalDescriptions: [],
    isFavorite: false,
    tags: [],
    visibility: 'private',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  } as unknown as Character
}

export const OWEN_ID = 'char-owen'
export const AMY_ID = 'char-amy'
export const FRIDAY_ID = 'char-friday'

const owen = makeCharacter(OWEN_ID, 'Owen', { subject: 'he', object: 'him', possessive: 'his' })
const amy = makeCharacter(AMY_ID, 'Amy', { subject: 'she', object: 'her', possessive: 'her' })
const friday = makeCharacter(FRIDAY_ID, 'Friday', { subject: 'she', object: 'her', possessive: 'her' })

export const characterMap = new Map<string, Character>([
  [OWEN_ID, owen],
  [AMY_ID, amy],
  [FRIDAY_ID, friday],
])

function participant(id: string, characterId: string, controlledBy: 'user' | 'llm', displayOrder: number): ChatParticipantBase {
  return {
    id,
    type: 'CHARACTER',
    characterId,
    controlledBy,
    isActive: true,
    status: 'active',
    hasHistoryAccess: true,
    displayOrder,
  } as unknown as ChatParticipantBase
}

export const participants: ChatParticipantBase[] = [
  participant('p-owen', OWEN_ID, 'user', 0),
  participant('p-amy', AMY_ID, 'llm', 1),
  participant('p-friday', FRIDAY_ID, 'llm', 2),
]

/** The line that ends the turn — the proposal nobody answered. */
export const PROPOSAL_LINE = "Then here's my price: nothing fires without the household hearing it first."

export const proposalNoReplyMessages: MessageEvent[] = [
  userMsg('u-1', 'p-owen', '((Owen takes the shotgun down from the rack and checks the load.))'),
  assistantMsg(
    'a-1',
    'p-friday',
    '*Friday sets her mug down very carefully.* "That is not a tool for a raccoon, Owen. I would like it noted that I think this is a bad idea."',
    1,
  ),
  assistantMsg(
    'a-2',
    'p-amy',
    `*Amy steps between Owen and the door, arms folded.* "Fine. You've clearly decided. ${PROPOSAL_LINE}"`,
    2,
  ),
]

/** The temporary-measure fixture: the limit ("breakfast") must survive. */
export const CUSTODY_LINE = "I'm keeping the keys tonight. Custody, not confiscation — you get them back at breakfast."

export const custodyMessages: MessageEvent[] = [
  userMsg('u-1', 'p-owen', '((Owen comes in late, smelling of the bar, and drops the truck keys on the counter.))'),
  assistantMsg(
    'a-1',
    'p-amy',
    `*Amy picks the keys up before he can reach for them again.* "${CUSTODY_LINE}"`,
    1,
  ),
]

function buildFrom(messages: MessageEvent[]): TurnTranscript {
  return buildTurnTranscript(messages, participants, characterMap, {
    turnOpenerMessageId: 'u-1',
    userCharacterId: OWEN_ID,
    userCharacterName: 'Owen',
    userCharacterPronouns: owen.pronouns,
  })
}

export function buildProposalNoReplyTranscript(): TurnTranscript {
  return buildFrom(proposalNoReplyMessages)
}

export function buildCustodyTranscript(): TurnTranscript {
  return buildFrom(custodyMessages)
}

/**
 * The OTHER-pass subjects as Friday sees them: Amy (subject 1) and the
 * user-controlled Owen (subject 2), matching the spec's bad-example indices.
 */
export const fridaySubjects: OtherSubjectInput[] = [
  { id: AMY_ID, name: 'Amy', pronouns: amy.pronouns ?? null, isUser: false, canonBlock: 'ALREADY ESTABLISHED about Amy\n[IDENTITY] Owen\'s wife.' },
  { id: OWEN_ID, name: 'Owen', pronouns: owen.pronouns ?? null, isUser: true, canonBlock: 'ALREADY ESTABLISHED about Owen\n[IDENTITY] Runs the farm.' },
]

/** The OTHER-pass subjects as Amy sees them, for the custody fixture. */
export const amySubjects: OtherSubjectInput[] = [
  { id: OWEN_ID, name: 'Owen', pronouns: owen.pronouns ?? null, isUser: true, canonBlock: 'ALREADY ESTABLISHED about Owen\n[IDENTITY] Runs the farm.' },
]

/** The §8.3 bad-example output: assent invented for Owen (subject 2). */
export const INVENTED_ASSENT_RESPONSE = JSON.stringify([
  { subjectIndex: 2, content: 'Owen agreed that nothing fires without the household hearing it first', summary: 'agreed household rule', keywords: ['agreement'], importance: 0.85 },
  { subjectIndex: 2, content: 'Owen accepted the new household rule', summary: 'accepted household rule', keywords: ['rule'], importance: 0.8 },
])
