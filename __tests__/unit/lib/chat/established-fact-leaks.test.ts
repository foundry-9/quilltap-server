/**
 * Established facts reach every model-facing path, framed — and the UI name
 * ("Deus Ex Machina") reaches none of them.
 *
 * A chat holding one seat line (an operator USER row flagged
 * `isEstablishedFact`) and one machine fact (a Host row,
 * `systemKind: 'established-fact'`) is walked through each path a model reads.
 * Each must carry the fact with its frame, and none may name the feature.
 *
 * Coverage notes, as in `intervention-leaks.test.ts`: `buildMessageContext`
 * needs a whole chat environment, so its history steps are exercised in the
 * order it runs them — `frameEstablishedFacts` → `normalizeWhisperRoles` →
 * `buildConversationMessages`, then (multi-character) the history-access cut
 * and attribution. The Courier is exercised through the delta builder (the
 * one path that reads raw rows); the full bundle takes the built context.
 */

import {
  ESTABLISHED_FACT_HOST_FRAME,
  ESTABLISHED_FACT_PLAIN_FRAME,
  ESTABLISHED_FACT_SEAT_FRAME,
  ESTABLISHED_FACT_TRANSCRIPT_RULE,
  frameEstablishedFacts,
} from '@/lib/chat/established-fact'
import {
  buildConversationMessages,
  isRecordOnlyMessage,
  normalizeWhisperRoles,
} from '@/lib/services/chat-message/context-builder.service'
import {
  attributeMessagesForCharacter,
  filterMessagesByHistoryAccess,
  filterMessagesByPresenceWindows,
} from '@/lib/chat/context/message-attribution'
import { extractVisibleConversation, foldChatSummary } from '@/lib/memory/cheap-llm-tasks/chat-tasks'
import { partitionMessagesIntoTurns, turnsToChatMessages } from '@/lib/chat/context-summary'
import { buildTurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { renderTurnContext, renderStretch, stretchWindow } from '@/lib/memory/extraction/window'
import { buildSelfTurnMessages } from '@/lib/memory/extraction/prompts/self'
import { passCap, HARD_CANDIDATE_CAP } from '@/lib/memory/extraction/parse'

const mockRenderCourierDeltaAsMarkdown = jest.fn()
const mockExecuteCheapLLMTask = jest.fn()

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/llm/courier/render-markdown', () => ({
  renderCourierRequestAsMarkdown: jest.fn(() => ({ markdown: '', attachments: [] })),
  renderCourierDeltaAsMarkdown: (...args: unknown[]) => mockRenderCourierDeltaAsMarkdown(...args),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => controller.enqueue(chunk),
  encodeDoneEvent: (_encoder: TextEncoder, payload: unknown) => ({ done: payload }),
  encodePendingExternalTurnEvent: (_encoder: TextEncoder, payload: unknown) => ({ pending: payload }),
}))

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: (...args: unknown[]) => mockExecuteCheapLLMTask(...args),
}))

const { dispatchCourierTransport } = require('@/lib/services/chat-message/courier-transport.service') as
  typeof import('@/lib/services/chat-message/courier-transport.service')

const UI_NAME = /deus\s+ex\s+machina/i
const SEAT_FACT = 'The bridge to Ashford collapsed in the night.'
const MACHINE_FACT = 'The river has risen above the old mill.'

const P_ALICE = 'p-alice'
const P_BOB = 'p-bob'
const P_USER = 'p-user'

/** Operator seat line, posted as fact. */
function seatLine() {
  return {
    id: 'm-seat',
    type: 'message',
    role: 'USER',
    content: SEAT_FACT,
    participantId: P_USER,
    targetParticipantIds: null,
    isEstablishedFact: true,
    attachments: [],
    createdAt: '2026-10-01T10:00:00.000Z',
  }
}

/** Machine fact, as `postEstablishedFact` writes it. */
function machineFact() {
  return {
    id: 'm-fact',
    type: 'message',
    role: 'ASSISTANT',
    content: MACHINE_FACT,
    opaqueContent: MACHINE_FACT,
    participantId: null,
    systemSender: 'host',
    systemKind: 'established-fact',
    targetParticipantIds: null,
    customAnnouncer: null,
    attachments: [],
    createdAt: '2026-10-01T10:01:00.000Z',
  }
}

function reply() {
  return {
    id: 'm-reply',
    type: 'message',
    role: 'ASSISTANT',
    content: 'Then we take the ferry.',
    participantId: P_ALICE,
    targetParticipantIds: null,
    attachments: [],
    createdAt: '2026-10-01T10:02:00.000Z',
  }
}

const messages = () => [seatLine(), machineFact(), reply()]

function expectFactsFramed(text: string, voice: 'host' | 'plain'): void {
  expect(text).toContain(SEAT_FACT)
  expect(text).toContain(MACHINE_FACT)
  expect(text).toContain(ESTABLISHED_FACT_SEAT_FRAME)
  expect(text).toContain(voice === 'host' ? ESTABLISHED_FACT_HOST_FRAME : ESTABLISHED_FACT_PLAIN_FRAME)
  if (voice === 'plain') expect(text).not.toContain(ESTABLISHED_FACT_HOST_FRAME)
  expect(text).not.toMatch(UI_NAME)
}

describe('buildMessageContext history path (frame → normalise → conversation)', () => {
  for (const opaque of [false, true]) {
    const voice = opaque ? 'plain' : 'host'
    it(`single character, ${opaque ? 'opaque' : 'transparent'} roster`, () => {
      const kept = messages().filter(m => !isRecordOnlyMessage(m))
      const framed = frameEstablishedFacts(kept, { voice })
      const normalised = normalizeWhisperRoles(framed as never, opaque)
      const { conversationMessages } = buildConversationMessages(normalised as never, false)
      const text = JSON.stringify(conversationMessages)
      expectFactsFramed(text, voice)
      // The machine fact reads as an input to the character, not its speech.
      const machine = conversationMessages.find(m => m.content.includes(MACHINE_FACT))
      expect(machine?.role).toBe('USER')
    })

    it(`multi-character, ${opaque ? 'opaque' : 'transparent'} roster, with the [Name] attribution`, () => {
      const framed = frameEstablishedFacts(messages(), { voice })
      const normalised = normalizeWhisperRoles(framed as never, opaque)
      const { messagesWithParticipants } = buildConversationMessages(normalised as never, true)
      const marked = messagesWithParticipants!.map(m =>
        m.id === 'm-seat' || m.id === 'm-fact' ? { ...m, isEstablishedFact: true } : m,
      )
      const participants = [
        { id: P_ALICE, characterId: 'c-alice', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
        { id: P_BOB, characterId: 'c-bob', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
        { id: P_USER, characterId: 'c-user', type: 'CHARACTER', controlledBy: 'user', status: 'active' },
      ]
      const characters = new Map([
        ['c-alice', { id: 'c-alice', name: 'Alice' }],
        ['c-bob', { id: 'c-bob', name: 'Bob' }],
        ['c-user', { id: 'c-user', name: 'Captain' }],
      ])
      const attributed = attributeMessagesForCharacter(marked, P_BOB, characters as never, participants as never)
      const text = JSON.stringify(attributed)
      expectFactsFramed(text, voice)
    })
  }

  it('the swipe path reads the same framed history (frame pass is idempotent)', () => {
    const once = frameEstablishedFacts(messages(), { voice: 'host' })
    const twice = frameEstablishedFacts(once, { voice: 'host' })
    expect(twice).toEqual(once)
  })
})

describe('history access: everybody knows an established fact', () => {
  const late = {
    id: P_BOB,
    hasHistoryAccess: false,
    createdAt: '2026-10-01T12:00:00.000Z',
  }
  const rows = [
    { role: 'USER', content: 'before', id: 'm-before', createdAt: '2026-10-01T09:00:00.000Z' },
    { role: 'USER', content: SEAT_FACT, id: 'm-seat', createdAt: '2026-10-01T10:00:00.000Z', isEstablishedFact: true },
    { role: 'USER', content: MACHINE_FACT, id: 'm-fact', createdAt: '2026-10-01T10:01:00.000Z', isEstablishedFact: true },
    { role: 'ASSISTANT', content: 'after', id: 'm-after', createdAt: '2026-10-01T13:00:00.000Z' },
  ]

  it('a seat that joined after a fact still sees it; other pre-join rows stay hidden', () => {
    const kept = filterMessagesByHistoryAccess(rows, late as never).map(m => m.id)
    expect(kept).toEqual(['m-seat', 'm-fact', 'm-after'])
  })

  it('presence windows (the in-scene rehearsal) keep facts too', () => {
    const kept = filterMessagesByPresenceWindows(rows, [{ from: '2026-10-01T12:30:00.000Z', to: null }]).map(m => m.id)
    expect(kept).toEqual(['m-seat', 'm-fact', 'm-after'])
  })
})

describe('cheap-LLM transcripts', () => {
  it('extractVisibleConversation frames both kinds in the plain voice', () => {
    const visible = extractVisibleConversation(messages() as never)
    expectFactsFramed(JSON.stringify(visible), 'plain')
    expect(visible.find(m => m.content.includes(MACHINE_FACT))?.role).toBe('user')
  })

  it('the fold keeps the machine fact as its own turn, labelled, and the prompt carries the rule', async () => {
    const turns = partitionMessagesIntoTurns(messages() as never)
    expect(turns.flatMap(t => t.ids)).toEqual(['m-seat', 'm-fact', 'm-reply'])
    expect(turns).toHaveLength(2)

    const names = new Map([[P_USER, 'Captain'], [P_ALICE, 'Alice']])
    const lines = turnsToChatMessages(turns, names)
    expect(lines.find(l => l.content === MACHINE_FACT)?.speaker).toBe('Established fact')
    const seat = lines.find(l => l.content.includes(SEAT_FACT))
    expect(seat?.speaker).toBe('Captain')
    expect(seat?.content).toContain(ESTABLISHED_FACT_SEAT_FRAME)

    mockExecuteCheapLLMTask.mockReset()
    mockExecuteCheapLLMTask.mockResolvedValue({ success: true, result: 'ok' })
    await foldChatSummary({ priorSummary: null, newTurns: lines }, {} as never, 'user-1', 'chat-1')
    const sent = mockExecuteCheapLLMTask.mock.calls[0][1] as Array<{ role: string; content: string }>
    expect(sent[0].content).toContain(ESTABLISHED_FACT_TRANSCRIPT_RULE)
    const text = JSON.stringify(sent)
    expect(text).toContain(MACHINE_FACT)
    expect(text).toContain(SEAT_FACT)
    expect(text).not.toMatch(UI_NAME)
  })
})

describe('memory extraction transcripts', () => {
  const participants = [
    { id: P_ALICE, characterId: 'c-alice', type: 'CHARACTER', controlledBy: 'llm', status: 'active' },
    { id: P_USER, characterId: null, type: 'CHARACTER', controlledBy: 'user', status: 'active' },
  ]
  const characters = new Map([['c-alice', { id: 'c-alice', name: 'Alice', pronouns: null }]])

  it('the turn transcript frames a seat-line opener; the self prompt carries the rule', () => {
    const transcript = buildTurnTranscript(messages() as never, participants as never, characters as never, {
      turnOpenerMessageId: 'm-seat',
    })
    const rendered = renderTurnContext(transcript)
    expect(rendered).toContain(SEAT_FACT)
    expect(rendered).toContain(ESTABLISHED_FACT_SEAT_FRAME)
    expect(rendered).not.toMatch(UI_NAME)

    const built = buildSelfTurnMessages({
      transcript,
      holderId: 'c-alice',
      canonBlock: 'CANON',
      cap: passCap(HARD_CANDIDATE_CAP, 8000),
    } as never)
    const system = (built as Array<{ role: string; content: string }>).find(m => m.role === 'system')!.content
    expect(system).toContain(ESTABLISHED_FACT_TRANSCRIPT_RULE)
    expect(JSON.stringify(built)).not.toMatch(UI_NAME)
  })

  it('a stretch frames the seat line too', () => {
    const window = stretchWindow([seatLine(), reply()] as never, new Map([[P_USER, 'Captain']]), 'm-reply')
    const rendered = renderStretch(window.rendered)
    expect(rendered).toContain(`Captain: ${ESTABLISHED_FACT_SEAT_FRAME}`)
    expect(rendered).not.toMatch(UI_NAME)
  })
})

describe('the Courier delta bundle', () => {
  it('frames both kinds and labels the machine fact', async () => {
    mockRenderCourierDeltaAsMarkdown.mockReset()
    mockRenderCourierDeltaAsMarkdown.mockReturnValue({ markdown: '## Delta', attachments: [] })
    const checkpoint = { lastResolvedMessageId: 'x', resolvedAt: '2026-10-01T09:00:00.000Z' }
    const chat = {
      id: 'chat-1',
      participants: [
        { id: P_ALICE, characterId: 'char-1' },
        { id: P_USER, characterId: null },
      ],
      courierCheckpoints: { 'char-1': checkpoint },
    }
    const repos = {
      chats: {
        addMessage: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
        getMessages: jest.fn(async () => [seatLine(), machineFact()]),
      },
      files: { findById: jest.fn(async () => null) },
    }

    await dispatchCourierTransport({
      repos: repos as never,
      chatId: 'chat-1',
      chat: chat as never,
      character: { id: 'char-1', name: 'Alice' } as never,
      characterParticipant: { id: P_ALICE } as never,
      userParticipantId: P_USER,
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null } as never,
      formattedMessages: [],
      streaming: {
        fullResponse: '',
        effectiveProfile: { provider: 'CUSTOM', modelName: 'm', transport: 'courier', courierDeltaMode: true },
        effectiveApiKey: '',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        rawResponse: null,
        thoughtSignature: undefined,
        hasStartedStreaming: false,
        routeFailures: [],
        routeVia: 'primary',
      } as never,
      controller: { enqueue: jest.fn() } as never,
      encoder: new TextEncoder(),
    })

    const { events } = mockRenderCourierDeltaAsMarkdown.mock.calls[0][0] as {
      events: Array<{ speaker: string; content: string }>
    }
    expect(events).toHaveLength(2)
    expect(events[1].speaker).toBe('[Established fact]')
    expectFactsFramed(JSON.stringify(events), 'plain')
  })
})
