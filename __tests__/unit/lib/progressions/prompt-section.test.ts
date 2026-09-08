/**
 * Character progressions — the prompt-side chokepoint.
 *
 * The engine's arithmetic is tested next door; what matters here is the
 * wrapper's contract with every prompt path that calls it: the block's exact
 * shape, that `force` bypasses the cadence, that a character with nothing to
 * report produces the empty string BYTE FOR BYTE (the guarantee that keeps a
 * progression-free prompt identical to one built before the feature existed),
 * and that no malformed entry anywhere can cost a character their turn.
 */

import {
  PROGRESSIONS_SECTION_HEADER,
  buildProgressionsSection,
} from '@/lib/progressions/prompt-section'
import type { ChatEvent, MessageEvent } from '@/lib/schemas/chat.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logger } = require('@/lib/logger') as { logger: Record<string, jest.Mock> }

const ME = '00000000-0000-0000-0000-000000000001'
const CHARACTER_ID = '11111111-1111-1111-1111-111111111111'
const START = Date.parse('2026-09-08T14:00:00Z')
const MINUTE = 60_000

const CANNON = {
  name: 'Cannon recharge',
  startTime: '2026-09-08T14:00:00Z',
  endTime: '2026-09-08T14:10:00Z',
  timeIncrement: 'minute',
  quantity: { total: 1.0, unit: 'MJ', precision: 1 },
}

const PREGNANCY = {
  name: 'Pregnancy',
  description: 'You are carrying a child.',
  startTime: '2026-08-01T00:00:00Z',
  endTime: '2027-05-01T00:00:00Z',
  timeIncrement: 'week',
  percentageReport: false,
  reportFrequency: '1h',
  reportTemplate: '{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.',
}

function character(progressions: unknown) {
  return { id: CHARACTER_ID, metadata: { faction: 'Ordo Aurum', progressions } }
}

/** One visible ASSISTANT turn by the responding character, at a fixed instant. */
function myTurn(iso: string): ChatEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'Quite so.',
    attachments: [],
    createdAt: iso,
    participantId: ME,
  } as MessageEvent
}

beforeEach(() => {
  for (const fn of Object.values(logger)) fn.mockClear()
})

describe('buildProgressionsSection — the empty-is-identical guarantee', () => {
  const cases: Array<[string, unknown]> = [
    ['a null character', null],
    ['an undefined character', undefined],
  ]

  it.each(cases)('returns the empty string for %s', (_label, subject) => {
    expect(buildProgressionsSection({ character: subject as never, nowMs: START })).toBe('')
  })

  it('returns the empty string for a character with no metadata at all', () => {
    expect(buildProgressionsSection({ character: { id: CHARACTER_ID }, nowMs: START })).toBe('')
  })

  it('returns the empty string for metadata carrying no progressions key', () => {
    expect(
      buildProgressionsSection({ character: { id: CHARACTER_ID, metadata: { faction: 'x' } }, nowMs: START })
    ).toBe('')
  })

  it('returns the empty string for an empty progressions record', () => {
    expect(buildProgressionsSection({ character: character({}), nowMs: START })).toBe('')
  })

  it('returns the empty string when every progression declines this turn', () => {
    const events = [myTurn('2026-09-08T14:01:00.000Z')]
    // 1h cadence, same clock hour as the last turn, and no state change.
    expect(
      buildProgressionsSection({
        character: character({ pregnancy: PREGNANCY }),
        events,
        respondingParticipantId: ME,
        nowMs: Date.parse('2026-09-08T14:30:00Z'),
      })
    ).toBe('')
  })
})

describe('buildProgressionsSection — the block', () => {
  it('opens with the wrapper sentence and lists one dashed line per reporting entry', () => {
    const section = buildProgressionsSection({
      character: character({ cannon: CANNON, pregnancy: { ...PREGNANCY, reportFrequency: 'turn' } }),
      nowMs: START + 2 * MINUTE + 10_000,
      force: true,
    })
    const lines = section.split('\n')
    expect(lines[0]).toBe(PROGRESSIONS_SECTION_HEADER)
    expect(lines).toHaveLength(3)
    for (const line of lines.slice(1)) expect(line.startsWith('- ')).toBe(true)
  })

  it('renders the spec’s two worked examples verbatim', () => {
    const section = buildProgressionsSection({
      character: character({ cannon: CANNON, pregnancy: { ...PREGNANCY, reportFrequency: 'turn' } }),
      nowMs: Date.parse('2026-12-22T00:00:00Z'),
      force: true,
    })
    expect(section).toContain(
      '- You are carrying a child. You are 20 weeks along; due in 18 weeks, 4 days.'
    )
    // The cannon finished months ago on this clock, so it reports its completion.
    expect(section).toContain('- Cannon recharge: complete;')
  })

  it('orders entries by id, so the block is stable across turns', () => {
    const section = buildProgressionsSection({
      character: character({ zeppelin: { ...CANNON, name: 'Zeppelin' }, anchor: { ...CANNON, name: 'Anchor' } }),
      nowMs: START + MINUTE,
      force: true,
    })
    expect(section.indexOf('Anchor')).toBeLessThan(section.indexOf('Zeppelin'))
  })

  it('carries no Staff persona and no timestamp of its own', () => {
    const section = buildProgressionsSection({
      character: character({ cannon: CANNON }),
      nowMs: START + MINUTE,
      force: true,
    })
    expect(section).not.toMatch(/Pascal|Aurora|Concierge|Librarian/)
    expect(section).toBe(
      `${PROGRESSIONS_SECTION_HEADER}\n- Cannon recharge: 1 minute elapsed, 9 minutes remaining, 10% complete (0.1/1.0 MJ).`
    )
  })

  it('renders {{start}} in the timezone it is handed', () => {
    const withStart = { ...CANNON, reportTemplate: 'begins {{start}}' }
    const utc = buildProgressionsSection({
      character: character({ cannon: withStart }),
      nowMs: START + MINUTE,
      force: true,
      timezone: 'UTC',
    })
    const tokyo = buildProgressionsSection({
      character: character({ cannon: withStart }),
      nowMs: START + MINUTE,
      force: true,
      timezone: 'Asia/Tokyo',
    })
    expect(utc).not.toBe(tokyo)
  })
})

describe('buildProgressionsSection — cadence', () => {
  it('honours the cadence when events and a participant are supplied', () => {
    const hourly = character({ pregnancy: PREGNANCY })
    const events = [myTurn('2026-09-08T14:01:00.000Z')]

    // Same clock hour → silent.
    expect(
      buildProgressionsSection({
        character: hourly,
        events,
        respondingParticipantId: ME,
        nowMs: Date.parse('2026-09-08T14:50:00Z'),
      })
    ).toBe('')

    // Next clock hour → reported.
    expect(
      buildProgressionsSection({
        character: hourly,
        events,
        respondingParticipantId: ME,
        nowMs: Date.parse('2026-09-08T15:01:00Z'),
      })
    ).toContain('You are')
  })

  it('reports everything on a character’s very first turn in a room', () => {
    expect(
      buildProgressionsSection({
        character: character({ pregnancy: PREGNANCY }),
        events: [],
        respondingParticipantId: ME,
        nowMs: Date.parse('2026-09-08T14:50:00Z'),
      })
    ).toContain('You are')
  })

  it('force bypasses the cadence even when the history says otherwise', () => {
    expect(
      buildProgressionsSection({
        character: character({ pregnancy: PREGNANCY }),
        events: [myTurn('2026-09-08T14:01:00.000Z')],
        respondingParticipantId: ME,
        nowMs: Date.parse('2026-09-08T14:50:00Z'),
        force: true,
      })
    ).toContain('You are')
  })

  it('reports everything when no events are supplied — a greeting has no history', () => {
    expect(
      buildProgressionsSection({ character: character({ pregnancy: PREGNANCY }), nowMs: START })
    ).toContain('You are')
  })

  it('silences an onComplete "once" entry on the turn after its completion', () => {
    const once = character({ cannon: { ...CANNON, onComplete: 'once' } })
    // Last turn was already past the end, so the completion has been announced.
    const events = [myTurn('2026-09-08T14:11:00.000Z')]
    expect(
      buildProgressionsSection({
        character: once,
        events,
        respondingParticipantId: ME,
        nowMs: START + 12 * MINUTE,
      })
    ).toBe('')
  })
})

describe('buildProgressionsSection — fail-soft', () => {
  it('drops a malformed entry, keeps the rest, and warns naming the character and id', () => {
    const section = buildProgressionsSection({
      character: character({ cannon: CANNON, broken: { ...CANNON, endTime: '2026-09-08T13:00:00Z' } }),
      nowMs: START + MINUTE,
      force: true,
    })
    expect(section).toContain('Cannon recharge')
    expect(section.split('\n')).toHaveLength(2)
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropping a malformed character progression',
      expect.objectContaining({ characterId: CHARACTER_ID, progressionId: 'broken' })
    )
  })

  it('returns the empty string rather than throwing when every entry is malformed', () => {
    expect(
      buildProgressionsSection({
        character: character({ 'Not An Id': CANNON }),
        nowMs: START,
        force: true,
      })
    ).toBe('')
  })

  it('survives metadata that is not an object at all', () => {
    for (const metadata of ['text', 42, [], null]) {
      expect(() =>
        buildProgressionsSection({ character: { id: CHARACTER_ID, metadata }, nowMs: START })
      ).not.toThrow()
    }
  })

  it('debug-logs the per-progression decision and cadence reason', () => {
    buildProgressionsSection({
      character: character({ cannon: CANNON }),
      events: [],
      respondingParticipantId: ME,
      nowMs: START + MINUTE,
    })
    expect(logger.debug).toHaveBeenCalledWith(
      'Character progressions evaluated for this turn',
      expect.objectContaining({
        characterId: CHARACTER_ID,
        emitted: true,
        decisions: [{ id: 'cannon', state: 'active', reason: 'first' }],
      })
    )
  })
})
