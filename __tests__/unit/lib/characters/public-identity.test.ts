/**
 * The public identity — known facts first, then the author's identity text.
 *
 * @jest-environment node
 */

import {
  composePublicIdentity,
  publicIdentityFacts,
  renderPublicIdentityFacts,
} from '@/lib/characters/public-identity'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const NOW = Date.parse('2026-11-05T18:00:00Z')
const OPTS = { nowMs: NOW, timeZone: 'UTC' }

const pregnancy = {
  name: 'Pregnancy',
  description: "You are carrying Charlie's daughter.",
  startTime: '2026-08-05T17:36:00Z',
  endTime: '2027-05-06T15:57:00Z',
  timeIncrement: 'week',
  percentageReport: false,
  reportTemplate: '{{description}} You are {{elapsedWhole}} along.',
}

const friday = {
  id: 'c1',
  name: 'Friday',
  birthday: '1992-03-04',
  pronouns: { subject: 'she', object: 'her', possessive: 'her' },
  metadata: {
    progressions: {
      pregnancy,
      curse: { ...pregnancy, name: 'Curse', public: false },
    },
    faction: 'Ordo Aurum',
  },
}

describe('publicIdentityFacts', () => {
  it('derives age, public progressions in neutral wording, and pronouns', () => {
    const facts = publicIdentityFacts(friday, OPTS)
    expect(facts.age).toBe(34)
    expect(facts.pronouns).toBe('she/her/her')
    expect(facts.progressions).toHaveLength(1)
    expect(facts.progressions[0]).toMatch(/^Pregnancy: 13 weeks, \d+ days? elapsed, 25 weeks, \d+ days? remaining\.$/)
  })

  it('never uses the second-person description or template, and leaves private ones out', () => {
    const lines = renderPublicIdentityFacts(publicIdentityFacts(friday, OPTS)).join('\n')
    expect(lines).not.toContain('You are')
    expect(lines).not.toContain('Curse')
    expect(lines).not.toContain('Ordo Aurum')
  })

  it('orders the lines age, progressions, pronouns', () => {
    const lines = renderPublicIdentityFacts(publicIdentityFacts(friday, OPTS))
    expect(lines[0]).toBe('Age: 34')
    expect(lines[1]).toMatch(/^Pregnancy:/)
    expect(lines[2]).toBe('Pronouns: she/her/her')
  })

  it('drops a completed once-only progression from the public view', () => {
    const done = {
      ...friday,
      metadata: { progressions: { pregnancy: { ...pregnancy, endTime: '2026-10-01T00:00:00Z', onComplete: 'once' } } },
    }
    expect(publicIdentityFacts(done, OPTS).progressions).toEqual([])
  })

  it('is empty for a character with none of the facts', () => {
    expect(renderPublicIdentityFacts(publicIdentityFacts({ name: 'Nobody' }, OPTS))).toEqual([])
  })
})

describe('composePublicIdentity', () => {
  it('puts the facts before the identity text', () => {
    const text = composePublicIdentity(friday, 'Friday, the household system.', OPTS)
    expect(text.startsWith('Age: 34\n')).toBe(true)
    expect(text.endsWith('\n\nFriday, the household system.')).toBe(true)
  })

  it('returns either half alone, and nothing for nothing', () => {
    expect(composePublicIdentity({ name: 'X' }, 'Just prose.', OPTS)).toBe('Just prose.')
    expect(composePublicIdentity({ name: 'X', birthday: '2000-01-01' }, '', OPTS)).toBe('Age: 26')
    expect(composePublicIdentity({ name: 'X' }, null, OPTS)).toBe('')
  })
})
