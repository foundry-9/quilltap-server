/**
 * Tests for buildTurnTranscript / findTurnOpenerMessageId.
 *
 * The transcript builder is the seam between the chat history and the per-
 * turn memory extraction passes — it determines which messages count as
 * "this turn" and how character contributions get grouped.
 */

import { describe, expect, it } from '@jest/globals'
import {
  buildTurnTranscript,
  findTurnOpenerMessageId,
} from '@/lib/services/chat-message/turn-transcript'
import type { Character, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'

function userMsg(id: string, content: string, overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    id,
    type: 'message',
    role: 'USER',
    content,
    attachments: [],
    createdAt: '2026-04-30T00:00:00.000Z',
    ...overrides,
  } as MessageEvent
}

function assistantMsg(id: string, participantId: string, content: string, overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    id,
    type: 'message',
    role: 'ASSISTANT',
    content,
    participantId,
    attachments: [],
    createdAt: '2026-04-30T00:00:01.000Z',
    ...overrides,
  } as MessageEvent
}

function makeCharacter(id: string, name: string): Character {
  return {
    id,
    userId: 'user-1',
    name,
    description: '',
    personality: '',
    background: '',
    pronouns: null,
    aliases: [],
    physicalDescriptions: [],
    isFavorite: false,
    tags: [],
    visibility: 'private',
    createdAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:00:00.000Z',
  } as unknown as Character
}

const charA = makeCharacter('char-a', 'Avery')
const charB = makeCharacter('char-b', 'Beatrice')

const participants: ChatParticipantBase[] = [
  {
    id: 'participant-a',
    type: 'CHARACTER',
    characterId: 'char-a',
    controlledBy: 'llm',
    isActive: true,
    status: 'active',
    hasHistoryAccess: true,
    displayOrder: 0,
  } as unknown as ChatParticipantBase,
  {
    id: 'participant-b',
    type: 'CHARACTER',
    characterId: 'char-b',
    controlledBy: 'llm',
    isActive: true,
    status: 'active',
    hasHistoryAccess: true,
    displayOrder: 1,
  } as unknown as ChatParticipantBase,
]

const characterMap = new Map<string, Character>([
  ['char-a', charA],
  ['char-b', charB],
])

describe('findTurnOpenerMessageId', () => {
  it('returns the most recent non-system USER message', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'first'),
      assistantMsg('a-1', 'participant-a', 'reply 1'),
      userMsg('u-2', 'second'),
      assistantMsg('a-2', 'participant-a', 'reply 2'),
    ]
    expect(findTurnOpenerMessageId(messages)).toBe('u-2')
  })

  it('returns null when chat has no user messages', () => {
    const messages: MessageEvent[] = [
      assistantMsg('a-1', 'participant-a', 'greeting'),
    ]
    expect(findTurnOpenerMessageId(messages)).toBeNull()
  })

  it('skips system-sender USER messages (e.g. host announcements)', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'real user input'),
      userMsg('u-host', 'host event', { systemSender: 'host' }),
    ]
    expect(findTurnOpenerMessageId(messages)).toBe('u-1')
  })
})

describe('buildTurnTranscript', () => {
  it('joins assistant contributions per character into ordered slices', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'tell me a story'),
      assistantMsg('a-1', 'participant-a', 'Once upon a time'),
      assistantMsg('a-2', 'participant-b', 'Beatrice chimes in'),
      assistantMsg('a-3', 'participant-a', '… the end.'),
    ]

    const transcript = buildTurnTranscript(messages, participants, characterMap, {
      turnOpenerMessageId: 'u-1',
    })

    expect(transcript.userMessage).toBe('tell me a story')
    expect(transcript.characterSlices).toHaveLength(2)
    expect(transcript.characterSlices[0].characterId).toBe('char-a')
    expect(transcript.characterSlices[0].text).toBe('Once upon a time\n\n… the end.')
    expect(transcript.characterSlices[0].contributingMessageIds).toEqual(['a-1', 'a-3'])
    expect(transcript.characterSlices[1].characterId).toBe('char-b')
    expect(transcript.characterSlices[1].text).toBe('Beatrice chimes in')
    expect(transcript.latestAssistantMessageId).toBe('a-3')
  })

  it('stops at the next non-system USER message', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'turn 1'),
      assistantMsg('a-1', 'participant-a', 'reply 1'),
      userMsg('u-2', 'turn 2'),
      assistantMsg('a-2', 'participant-a', 'reply 2'),
    ]

    const transcript = buildTurnTranscript(messages, participants, characterMap, {
      turnOpenerMessageId: 'u-1',
    })

    expect(transcript.userMessage).toBe('turn 1')
    expect(transcript.characterSlices).toHaveLength(1)
    expect(transcript.characterSlices[0].contributingMessageIds).toEqual(['a-1'])
  })

  it('skips system whispers, silent messages, and tool/system events', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'hello'),
      assistantMsg('a-host', 'participant-a', 'host announcement', { systemSender: 'host' }),
      assistantMsg('a-silent', 'participant-a', 'silent message', { isSilentMessage: true }),
      assistantMsg('a-real', 'participant-a', 'real reply'),
    ]

    const transcript = buildTurnTranscript(messages, participants, characterMap, {
      turnOpenerMessageId: 'u-1',
    })

    expect(transcript.characterSlices).toHaveLength(1)
    expect(transcript.characterSlices[0].text).toBe('real reply')
  })

  it('handles greeting-only history (no turn opener)', () => {
    const messages: MessageEvent[] = [
      assistantMsg('a-greeting', 'participant-a', 'Welcome!'),
    ]

    const transcript = buildTurnTranscript(messages, participants, characterMap, {
      turnOpenerMessageId: null,
    })

    expect(transcript.userMessage).toBeNull()
    expect(transcript.characterSlices).toHaveLength(1)
    expect(transcript.characterSlices[0].text).toBe('Welcome!')
  })

  it('plumbs userCharacter info onto the transcript', () => {
    const messages: MessageEvent[] = [
      userMsg('u-1', 'hi'),
      assistantMsg('a-1', 'participant-a', 'hi back'),
    ]

    const transcript = buildTurnTranscript(messages, participants, characterMap, {
      turnOpenerMessageId: 'u-1',
      userCharacterId: 'user-char',
      userCharacterName: 'Operator',
      userCharacterPronouns: null,
    })

    expect(transcript.userCharacterId).toBe('user-char')
    expect(transcript.userCharacterName).toBe('Operator')
  })
})
