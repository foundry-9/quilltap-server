/**
 * Whisper privacy: the private mark a whisper carries in its recipient's
 * history, and the whisper-reply note that tells the recipient its own reply
 * is said aloud.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

import {
  buildWhisperReplyNote,
  frameIncomingWhispers,
  isSeatWhisperTo,
  WHISPER_MARK,
  WHISPER_MARK_SHARED,
} from '@/lib/chat/context/whisper-privacy'
import type { ChatEvent, ChatParticipantBase } from '@/lib/schemas/types'

const ME = 'p-me'
const OPERATOR = 'p-op'
const HOST_OF_HOUSE = 'p-ruth'
const FRIEND = 'p-laura'
const AWAY = 'p-walter'

let clock = 0
function at(): string {
  clock += 60_000
  return new Date(Date.UTC(2026, 10, 28) + clock).toISOString()
}

function line(id: string, from: string, content: string, extra: Record<string, unknown> = {}): ChatEvent {
  return {
    type: 'message', id, role: from === ME ? 'ASSISTANT' : 'USER', content, participantId: from,
    attachments: [], createdAt: at(), ...extra,
  } as unknown as ChatEvent
}
function whisper(id: string, from: string, to: string[], content = 'Psst.'): ChatEvent {
  return line(id, from, content, { targetParticipantIds: to })
}

function seat(id: string, status: ChatParticipantBase['status'] = 'active'): ChatParticipantBase {
  return { id, type: 'CHARACTER', status } as unknown as ChatParticipantBase
}
const cast = [seat(ME), seat(OPERATOR), seat(HOST_OF_HOUSE), seat(FRIEND), seat(AWAY, 'absent')]

const names = async () => new Map([
  [ME, 'Amy'], [OPERATOR, 'Charlie'], [HOST_OF_HOUSE, 'Ruth'], [FRIEND, 'Laura'], [AWAY, 'Walter'],
])

function build(events: ChatEvent[], extra: Partial<Parameters<typeof buildWhisperReplyNote>[0]> = {}) {
  return buildWhisperReplyNote({
    events,
    respondingParticipantId: ME,
    allParticipants: cast,
    whisperToolOffered: true,
    loadSpeakerNames: names,
    ...extra,
  })
}

beforeEach(() => {
  clock = 0
})

describe('isSeatWhisperTo', () => {
  it('is a seat line addressed to the seat', () => {
    expect(isSeatWhisperTo({ role: 'USER', participantId: OPERATOR, targetParticipantIds: [ME] }, ME)).toBe(true)
  })

  it('is not a Staff whisper, a tool row, a public line or the seat\'s own whisper', () => {
    expect(isSeatWhisperTo({ role: 'ASSISTANT', participantId: null, systemSender: 'commonplaceBook', targetParticipantIds: [ME] }, ME)).toBe(false)
    expect(isSeatWhisperTo({ role: 'TOOL', participantId: OPERATOR, targetParticipantIds: [ME] }, ME)).toBe(false)
    expect(isSeatWhisperTo({ role: 'USER', participantId: OPERATOR, targetParticipantIds: null }, ME)).toBe(false)
    expect(isSeatWhisperTo({ role: 'ASSISTANT', participantId: ME, targetParticipantIds: [OPERATOR] }, ME)).toBe(false)
    expect(isSeatWhisperTo({ role: 'USER', participantId: OPERATOR, targetParticipantIds: [FRIEND] }, ME)).toBe(false)
  })
})

describe('frameIncomingWhispers', () => {
  it('marks a whisper to the responder and leaves everything else alone', () => {
    const rows = [
      { role: 'USER', participantId: OPERATOR, content: 'Hello, all.' },
      { role: 'USER', participantId: OPERATOR, targetParticipantIds: [ME], content: 'Just us.' },
      { role: 'USER', participantId: OPERATOR, targetParticipantIds: [ME, FRIEND], content: 'Us three.' },
      { role: 'ASSISTANT', participantId: ME, targetParticipantIds: [OPERATOR], content: 'My reply.' },
    ]
    const { rows: out, framed } = frameIncomingWhispers(rows, ME)
    expect(framed).toBe(2)
    expect(out[0]).toBe(rows[0])
    expect(out[1].content).toBe(`${WHISPER_MARK} Just us.`)
    expect(out[2].content).toBe(`${WHISPER_MARK_SHARED} Us three.`)
    expect(out[3]).toBe(rows[3])
    expect(rows[1].content).toBe('Just us.')
  })

  it('returns the same array when there is nothing to mark', () => {
    const rows = [{ role: 'USER', participantId: OPERATOR, content: 'Hello.' }]
    expect(frameIncomingWhispers(rows, ME).rows).toBe(rows)
  })
})

describe('buildWhisperReplyNote', () => {
  it('is absent when no whisper has reached the seat', async () => {
    expect(await build([line('a', OPERATOR, 'Morning.'), line('b', ME, 'Morning.')])).toBe('')
  })

  it('is absent once the seat has spoken since the whisper', async () => {
    expect(await build([whisper('w', OPERATOR, [ME]), line('b', ME, 'Already answered.')])).toBe('')
  })

  it('names the whisperer and who did not hear, and points at the whisper tool', async () => {
    const note = await build([line('a', ME, 'Earlier.'), whisper('w', OPERATOR, [ME])])
    expect(note).toContain('Charlie whispered to you privately.')
    expect(note).toContain('Ruth and Laura did not hear it')
    expect(note).not.toContain('Walter')
    expect(note).toContain('`whisper` tool')
    expect(note).toContain('NOT private')
  })

  it('counts a second recipient as in the know', async () => {
    const note = await build([whisper('w', OPERATOR, [ME, FRIEND])])
    expect(note).toContain('Ruth did not hear it')
    expect(note).not.toContain('Laura did not')
  })

  it('without the tool, says to keep the matter out of the reply', async () => {
    const note = await build([whisper('w', OPERATOR, [ME])], { whisperToolOffered: false })
    expect(note).not.toContain('`whisper` tool')
    expect(note).toContain('no private channel')
  })

  it('a swipe sees the note the original generation saw', async () => {
    const events = [whisper('w', OPERATOR, [ME]), line('reply', ME, 'The line being re-rolled.')]
    expect(await build(events)).toBe('')
    expect(await build(events, { regenerationOfMessageIds: ['reply'] })).toContain('Charlie whispered')
  })
})
