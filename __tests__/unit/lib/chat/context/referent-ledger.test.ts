/**
 * Tests for the trailing referent ledger and the closing echo of the user's line.
 */

import {
  buildClosingEcho,
  buildReferentLedger,
  CLOSING_ECHO_MAX_CHARS,
  REFERENT_LEDGER_WINDOW_LINES,
  type ReferentLedgerPerson,
} from '@/lib/chat/context/referent-ledger'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const she = { subject: 'she', object: 'her', possessive: 'her' }
const he = { subject: 'he', object: 'him', possessive: 'his' }

const people: ReferentLedgerPerson[] = [
  { id: 'friday', name: 'Friday', pronouns: she, inRoom: true },
  { id: 'charlie', name: 'Charlie', pronouns: he, inRoom: true },
  { id: 'abigail', name: 'Abigail', aliases: ['Abby', 'The Fourth'], pronouns: she, inRoom: false },
  { id: 'vergil', name: 'Vergil', aliases: ['Gyro'], pronouns: he, inRoom: false },
  { id: 'greg', name: 'Greg', aliases: ['Doc'], pronouns: he, inRoom: false },
]

describe('buildReferentLedger', () => {
  it('lists the off-stage people from the last turns, most recently named first', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people,
      lines: [
        {
          speaker: 'Friday',
          isResponder: true,
          content:
            'You told Greg before you told me. If you say I don\'t have a preference, Abigail will absolutely make that a formal finding. You\'ve seen how she documents.',
        },
        { speaker: 'Charlie', isResponder: false, content: '"When she\'s not scolding Vergil for his bedside manner."\n\nI grin.' },
      ],
    })

    const order = ['**Vergil**', '**Abigail**', '**Greg**'].map(n => ledger.indexOf(n))
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(ledger).toContain('**Abigail** (she/her; not in the room) — last named by you, in your last turn')
    expect(ledger).toContain('Abigail will absolutely make that a formal finding. You\'ve seen how she documents.')
    expect(ledger).toContain('**Vergil** (he/him; not in the room) — last named by Charlie, in the line you are answering')
  })

  it('leaves out the responder and the author of the latest line', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people,
      lines: [
        { speaker: 'Friday', isResponder: true, content: 'Charlie, love. Friday is my name.' },
        { speaker: 'Charlie', isResponder: false, content: 'Friday, Charlie here. Abby says hello.' },
      ],
    })
    expect(ledger).not.toContain('**Friday**')
    expect(ledger).not.toContain('**Charlie**')
    expect(ledger).toContain('**Abigail**')
  })

  it('marks people in the room and counts lines back', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people,
      lines: [
        { speaker: 'Asa', isResponder: false, content: 'Charlie said to wait.' },
        { speaker: 'Friday', isResponder: true, content: 'Then we wait.' },
        { speaker: 'Abigail', isResponder: false, content: 'Fine.' },
      ],
    })
    expect(ledger).toContain('**Charlie** (he/him; in the room) — last named by Asa, two lines back')
  })

  it('matches names and aliases case-sensitively, at word boundaries', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people,
      lines: [{ speaker: 'Charlie', isResponder: false, content: 'Check the doc, then the Vergilian verses, then the greg-orian chant.' }],
    })
    expect(ledger).toBe('')

    const aliased = buildReferentLedger({
      responderId: 'friday',
      people,
      lines: [{ speaker: 'Charlie', isResponder: false, content: 'Ask Doc.' }],
    })
    expect(aliased).toContain('**Greg**')
  })

  it('only scans the window', () => {
    const lines = [
      { speaker: 'Charlie', isResponder: false, content: 'Abigail was here.' },
      ...Array.from({ length: REFERENT_LEDGER_WINDOW_LINES }, () => ({
        speaker: 'Charlie',
        isResponder: false,
        content: 'Nothing to see.',
      })),
    ]
    expect(buildReferentLedger({ responderId: 'friday', people, lines })).toBe('')
  })

  it('is empty with no lines', () => {
    expect(buildReferentLedger({ responderId: 'friday', people, lines: [] })).toBe('')
  })

  it('says so when pronouns are not recorded', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people: [...people, { id: 'x', name: 'Sunny', inRoom: false }],
      lines: [{ speaker: 'Charlie', isResponder: false, content: 'Sunny called.' }],
    })
    expect(ledger).toContain('**Sunny** (pronouns not recorded; not in the room)')
  })
})

describe('buildReferentLedger cards', () => {
  const withCards: ReferentLedgerPerson[] = people.map(p => ({
    ...p,
    renderCard: p.inRoom ? undefined : jest.fn(() => `### ${p.name}\nCard for ${p.name}.`),
  }))

  it('carries the cards of listed people who are not in the room, and only theirs', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people: withCards,
      lines: [{ speaker: 'Asa', isResponder: false, content: 'Charlie and Abigail went to find Vergil.' }],
    })
    expect(ledger).toContain('Particulars of those not in the room')
    expect(ledger).toContain('### Abigail\nCard for Abigail.')
    expect(ledger).toContain('### Vergil\nCard for Vergil.')
    expect(ledger).not.toContain('### Charlie')
    const greg = withCards.find(p => p.id === 'greg')!
    expect(greg.renderCard).not.toHaveBeenCalled()
  })

  it('has no particulars block when everyone listed is in the room', () => {
    const ledger = buildReferentLedger({
      responderId: 'friday',
      people: withCards,
      lines: [{ speaker: 'Asa', isResponder: false, content: 'Charlie is here.' }],
    })
    expect(ledger).toContain('**Charlie**')
    expect(ledger).not.toContain('Particulars')
  })
})

describe('buildClosingEcho', () => {
  it('quotes the whole line under a header naming the speaker', () => {
    const echo = buildClosingEcho({ newUserMessage: '"When she\'s not scolding Vergil."\n\nI grin.', speakerName: 'Charlie' })
    expect(echo).toBe(
      '## The line you are answering\n\nWhat Charlie just said, which is what you are replying to:\n\n> "When she\'s not scolding Vergil."\n>\n> I grin.',
    )
  })

  it('is empty without a new user message', () => {
    expect(buildClosingEcho({ newUserMessage: undefined, speakerName: 'Charlie' })).toBe('')
    expect(buildClosingEcho({ newUserMessage: '   ', speakerName: 'Charlie' })).toBe('')
  })

  it('echoes only the closing paragraphs of a long line', () => {
    const opening = 'A'.repeat(CLOSING_ECHO_MAX_CHARS)
    const echo = buildClosingEcho({ newUserMessage: `${opening}\n\nThe last word.`, speakerName: 'Charlie' })
    expect(echo).toContain('The closing part of what Charlie just said')
    expect(echo).toContain('> The last word.')
    expect(echo).not.toContain(opening)
  })
})
