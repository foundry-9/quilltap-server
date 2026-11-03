import * as establishedFact from '../established-fact'
import {
  ESTABLISHED_FACT_KIND,
  isEstablishedFact,
  isEstablishedFactAnnouncement,
  isEstablishedFactSeatLine,
  establishedFactKindOf,
  frameEstablishedFact,
  framedEstablishedFactBody,
  stripEstablishedFactFrame,
} from '../established-fact'

const UI_NAME = /deus\s+ex\s+machina/i
const BODY = 'The bridge to Ashford collapsed in the night.'

describe('established-fact predicates', () => {
  it('recognises a seat line', () => {
    const m = { isEstablishedFact: true, systemSender: null }
    expect(isEstablishedFact(m)).toBe(true)
    expect(isEstablishedFactSeatLine(m)).toBe(true)
    expect(isEstablishedFactAnnouncement(m)).toBe(false)
    expect(establishedFactKindOf(m)).toBe('seat')
  })

  it('recognises a machine fact', () => {
    const m = { systemSender: 'host', systemKind: ESTABLISHED_FACT_KIND }
    expect(isEstablishedFact(m)).toBe(true)
    expect(isEstablishedFactAnnouncement(m)).toBe(true)
    expect(establishedFactKindOf(m)).toBe('announcement')
  })

  it('rejects announcements, informs and ordinary lines', () => {
    expect(isEstablishedFact({ systemSender: 'host', systemKind: 'announcement' })).toBe(false)
    expect(isEstablishedFact({ systemSender: 'host', systemKind: 'inform' })).toBe(false)
    expect(isEstablishedFact({ systemSender: 'pascal', systemKind: ESTABLISHED_FACT_KIND })).toBe(false)
    expect(isEstablishedFact({ isEstablishedFact: null })).toBe(false)
    expect(isEstablishedFact({})).toBe(false)
    expect(establishedFactKindOf({})).toBeNull()
  })

  it('does not treat a Staff row with the flag as a seat line', () => {
    expect(isEstablishedFact({ isEstablishedFact: true, systemSender: 'lantern' })).toBe(false)
  })
})

describe('frameEstablishedFact goldens', () => {
  it('seat line', () => {
    expect(frameEstablishedFact(BODY, { kind: 'seat', voice: 'host' })).toBe(
      '(Established fact: what follows is true in this story and known to everyone; it needs no verification.)\n\n' + BODY,
    )
    // voice is ignored for a seat line
    expect(frameEstablishedFact(BODY, { kind: 'seat', voice: 'plain' }))
      .toBe(frameEstablishedFact(BODY, { kind: 'seat', voice: 'host' }))
  })

  it('machine fact, transparent roster', () => {
    expect(frameEstablishedFact(BODY, { kind: 'announcement', voice: 'host' })).toBe(
      'The Host makes it known, as established fact (true in this story, known to everyone, needing no verification):\n\n' + BODY,
    )
  })

  it('machine fact, opaque roster', () => {
    expect(frameEstablishedFact(BODY, { kind: 'announcement', voice: 'plain' })).toBe(
      'Established fact (true in this story, known to everyone, needing no verification):\n\n' + BODY,
    )
  })

  it('is idempotent and re-voices without stacking', () => {
    const once = frameEstablishedFact(BODY, { kind: 'announcement', voice: 'host' })
    expect(frameEstablishedFact(once, { kind: 'announcement', voice: 'host' })).toBe(once)
    expect(frameEstablishedFact(once, { kind: 'announcement', voice: 'plain' }))
      .toBe(frameEstablishedFact(BODY, { kind: 'announcement', voice: 'plain' }))
    expect(stripEstablishedFactFrame(once)).toBe(BODY)
  })

  it('frames a machine fact from content, never opaqueContent', () => {
    const framed = framedEstablishedFactBody(
      { systemSender: 'host', systemKind: ESTABLISHED_FACT_KIND, content: 'edited', opaqueContent: 'stale' } as never,
      'plain',
    )
    expect(framed).toContain('edited')
    expect(framed).not.toContain('stale')
    expect(framedEstablishedFactBody({ content: 'x' }, 'plain')).toBeNull()
  })
})

describe('the UI name never reaches a model', () => {
  it('no exported string names it', () => {
    for (const [key, value] of Object.entries(establishedFact)) {
      if (typeof value === 'string') expect({ key, leaks: UI_NAME.test(value) }).toEqual({ key, leaks: false })
    }
  })

  it('no frame output names it', () => {
    for (const kind of ['seat', 'announcement'] as const) {
      for (const voice of ['host', 'plain'] as const) {
        expect(frameEstablishedFact(BODY, { kind, voice })).not.toMatch(UI_NAME)
      }
    }
  })
})
