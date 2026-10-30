/**
 * The established-fact reminder: which facts a seat is reminded of, in what
 * order, under what cap, and that a swipe sees what the original saw.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

import {
  buildEstablishedFactReminder,
  ESTABLISHED_FACT_REMINDER_CAP,
} from '@/lib/chat/context/established-fact-reminder'
import { ESTABLISHED_FACT_REMINDER_HEADER } from '@/lib/chat/established-fact'
import type { ChatEvent } from '@/lib/schemas/types'

const ME = 'p-me'
const OPERATOR = 'p-op'

let clock = 0
function at(): string {
  clock += 60_000
  return new Date(Date.UTC(2026, 9, 1) + clock).toISOString()
}

function seatFact(id: string, content: string): ChatEvent {
  return { type: 'message', id, role: 'USER', content, participantId: OPERATOR, isEstablishedFact: true, attachments: [], createdAt: at() } as unknown as ChatEvent
}
function machineFact(id: string, content: string, extra: Record<string, unknown> = {}): ChatEvent {
  return {
    type: 'message', id, role: 'ASSISTANT', content, participantId: null, systemSender: 'host',
    systemKind: 'established-fact', attachments: [], createdAt: at(), ...extra,
  } as unknown as ChatEvent
}
function myTurn(id: string): ChatEvent {
  return { type: 'message', id, role: 'ASSISTANT', content: 'I speak.', participantId: ME, attachments: [], createdAt: at() } as unknown as ChatEvent
}
function plainLine(id: string): ChatEvent {
  return { type: 'message', id, role: 'USER', content: 'An ordinary line.', participantId: OPERATOR, attachments: [], createdAt: at() } as unknown as ChatEvent
}

const names = async () => new Map([[OPERATOR, 'Captain']])

function build(events: ChatEvent[], extra: Partial<Parameters<typeof buildEstablishedFactReminder>[0]> = {}) {
  return buildEstablishedFactReminder({
    events,
    respondingParticipantId: ME,
    hasHistoryAccess: true,
    loadSpeakerNames: names,
    ...extra,
  })
}

beforeEach(() => {
  clock = 0
})

describe('buildEstablishedFactReminder', () => {
  it('is empty with no facts (the turn stays byte-identical)', async () => {
    const loadSpeakerNames = jest.fn(names)
    expect(await build([plainLine('a'), myTurn('b')], { loadSpeakerNames })).toBe('')
    expect(loadSpeakerNames).not.toHaveBeenCalled()
  })

  it('selects only facts after the seat last spoke, in posting order, seat lines name-prefixed', async () => {
    const events = [
      seatFact('old', 'Old news.'),
      myTurn('mine'),
      machineFact('m1', 'The river has risen.'),
      plainLine('x'),
      seatFact('s1', 'The bridge is gone.'),
    ]
    const section = await build(events)
    expect(section).toBe([
      ESTABLISHED_FACT_REMINDER_HEADER,
      'The river has risen.',
      'Captain: The bridge is gone.',
    ].join('\n\n'))
    expect(section).not.toContain('Old news.')
  })

  it('with no prior turn: every fact for a history-access seat, only post-join facts otherwise', async () => {
    const early = machineFact('early', 'Before you came.')
    const joinedAt = at()
    const late = machineFact('late', 'After you came.')
    expect(await build([early, late])).toContain('Before you came.')
    const forLateJoiner = await build([early, late], { hasHistoryAccess: false, joinedAt })
    expect(forLateJoiner).toContain('After you came.')
    expect(forLateJoiner).not.toContain('Before you came.')
  })

  it('skips a fact addressed away from this seat', async () => {
    const events = [machineFact('w', 'Not for you.', { targetParticipantIds: ['p-other'] })]
    expect(await build(events)).toBe('')
  })

  it('drops the oldest first under the cap; the newest always rides', async () => {
    const big = 'x'.repeat(3000)
    const events = [
      machineFact('a', `A${big}`),
      machineFact('b', `B${big}`),
      machineFact('c', `C${big}`),
    ]
    const section = await build(events)
    expect(section.length).toBeLessThanOrEqual(ESTABLISHED_FACT_REMINDER_CAP)
    expect(section).not.toContain(`A${big}`)
    expect(section).toContain(`B${big}`)
    expect(section).toContain(`C${big}`)
  })

  it('a swipe reproduces what the original generation saw', async () => {
    const before = [myTurn('prev'), machineFact('f1', 'The river has risen.')]
    const target = myTurn('target')
    const original = await build(before)

    // Later: the target exists, and another fact landed after it.
    const later = [...before, target, machineFact('f2', 'Posted after the reply.')]
    const swipe = await build(later, { regenerationOfMessageIds: ['target'] })
    expect(swipe).toBe(original)

    // Without the swipe ids the seat's last turn is the target: only the new fact.
    const fresh = await build(later)
    expect(fresh).toContain('Posted after the reply.')
    expect(fresh).not.toContain('The river has risen.')
  })
})
