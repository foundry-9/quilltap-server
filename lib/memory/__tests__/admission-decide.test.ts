/**
 * `decideAdmission` — every branch, table-driven (memory refactor Phase C).
 *
 * Pure: neighbours go in hydrated, an action comes out. Covers the threshold
 * bands, the subject / kind / source filters, the date guard over every close
 * neighbour (not only rank 1), the digest redirect, and cold promotion.
 */

import { decideAdmission, type AdmissionCandidateView } from '../admission/decide'
import type { AdmissionAction, AdmissionNeighbour } from '../admission/types'
import { ADMISSION_THRESHOLDS } from '../settings-defaults'
import type { Memory } from '@/lib/schemas/types'

const HOLDER = 'char-holder'
const BOB = 'char-bob'

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: HOLDER,
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
    tags: [],
    importance: 0.5,
    aboutCharacterId: null,
    source: 'AUTO',
    kind: 'semantic',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.5,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    entities: [],
    occurredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

function n(memory: Memory, cosine: number, extra: Partial<AdmissionNeighbour> = {}): AdmissionNeighbour {
  return { memory, cosine, ...extra }
}

const AUTO_SELF: AdmissionCandidateView = {
  holderId: HOLDER,
  aboutId: null,
  kind: 'semantic',
  source: 'AUTO',
  occurredAt: null,
}

function decide(neighbours: AdmissionNeighbour[], candidate: Partial<AdmissionCandidateView> = {}): AdmissionAction {
  return decideAdmission({
    candidate: { ...AUTO_SELF, ...candidate },
    neighbours,
    thresholds: ADMISSION_THRESHOLDS,
  }).action
}

describe('decideAdmission — threshold bands', () => {
  const cases: Array<[string, AdmissionNeighbour[], AdmissionAction]> = [
    ['no neighbours → insert', [], { kind: 'insert' }],
    ['all below related → insert', [n(mem('a'), 0.69)], { kind: 'insert' }],
    ['related band → insert-linked', [n(mem('a'), 0.70)], { kind: 'insert-linked', linkTo: ['a'], reason: 'band' }],
    ['just under reinforce → insert-linked', [n(mem('a'), 0.8499)], { kind: 'insert-linked', linkTo: ['a'], reason: 'band' }],
    ['reinforce band → reinforce', [n(mem('a'), 0.85)], { kind: 'reinforce', into: 'a' }],
    ['just under near-duplicate → reinforce', [n(mem('a'), 0.8999)], { kind: 'reinforce', into: 'a' }],
    ['near-duplicate → absorb', [n(mem('a'), 0.90)], { kind: 'absorb', into: 'a' }],
    [
      'several band rows all link, best first',
      [n(mem('b'), 0.72), n(mem('a'), 0.81), n(mem('c'), 0.5)],
      { kind: 'insert-linked', linkTo: ['a', 'b'], reason: 'band' },
    ],
    ['closest eligible wins', [n(mem('a'), 0.87), n(mem('b'), 0.93)], { kind: 'absorb', into: 'b' }],
  ]
  it.each(cases)('%s', (_label, neighbours, expected) => {
    expect(decide(neighbours)).toEqual(expected)
  })
})

describe('decideAdmission — subject, kind and source', () => {
  it('a close neighbour about someone else is linked, never folded into', () => {
    expect(decide([n(mem('a', { aboutCharacterId: BOB }), 0.95)])).toEqual({
      kind: 'insert-linked',
      linkTo: ['a'],
      reason: 'mismatch',
    })
  })

  it('reads a self memory the same whether aboutCharacterId is null or the holder', () => {
    expect(decide([n(mem('a', { aboutCharacterId: HOLDER }), 0.87)])).toEqual({ kind: 'reinforce', into: 'a' })
    expect(decide([n(mem('a'), 0.87)], { aboutId: HOLDER })).toEqual({ kind: 'reinforce', into: 'a' })
  })

  it('folds a candidate about Bob into a row about Bob', () => {
    expect(decide([n(mem('a', { aboutCharacterId: BOB }), 0.87)], { aboutId: BOB })).toEqual({ kind: 'reinforce', into: 'a' })
  })

  it('a different kind is linked, not folded into', () => {
    expect(decide([n(mem('a', { kind: 'episodic' }), 0.95)])).toEqual({ kind: 'insert-linked', linkTo: ['a'], reason: 'mismatch' })
  })

  it('a MANUAL candidate never disappears into an AUTO row', () => {
    expect(decide([n(mem('a'), 0.97)], { source: 'MANUAL' })).toEqual({
      kind: 'insert-linked',
      linkTo: ['a'],
      reason: 'mismatch',
    })
  })

  it('a MANUAL candidate may fold into a MANUAL row or a digest', () => {
    expect(decide([n(mem('a', { source: 'MANUAL' }), 0.87)], { source: 'MANUAL' })).toEqual({ kind: 'reinforce', into: 'a' })
    expect(decide([n(mem('d', { source: 'CONSOLIDATED' }), 0.95)], { source: 'MANUAL' })).toEqual({ kind: 'absorb', into: 'd' })
  })

  it('an AUTO candidate folds into a MANUAL row', () => {
    expect(decide([n(mem('a', { source: 'MANUAL' }), 0.95)])).toEqual({ kind: 'absorb', into: 'a' })
  })

  it('skips an ineligible closest neighbour for an eligible second', () => {
    const action = decide([n(mem('bob', { aboutCharacterId: BOB }), 0.97), n(mem('self'), 0.88)])
    expect(action).toEqual({ kind: 'reinforce', into: 'self' })
  })
})

describe('decideAdmission — date guard over every close neighbour', () => {
  const SPRING = '2026-03-10T00:00:00.000Z'
  const SUMMER = '2026-07-14T00:00:00.000Z'
  const SUMMER_RETOLD = '2026-07-16T00:00:00.000Z'

  it('a different occasion at rank 1 is linked', () => {
    expect(decide([n(mem('a', { occurredAt: SPRING }), 0.96)], { occurredAt: SUMMER })).toEqual({
      kind: 'insert-linked',
      linkTo: ['a'],
      reason: 'date-guard',
    })
  })

  it('looks past a different occasion to a same-occasion row below it', () => {
    const action = decide(
      [n(mem('spring', { occurredAt: SPRING }), 0.96), n(mem('summer', { occurredAt: SUMMER_RETOLD }), 0.88)],
      { occurredAt: SUMMER },
    )
    expect(action).toEqual({ kind: 'reinforce', into: 'summer' })
  })

  it('links every distinct occasion and band row when none qualifies', () => {
    const action = decide(
      [
        n(mem('spring', { occurredAt: SPRING }), 0.96),
        n(mem('autumn', { occurredAt: '2025-10-01T00:00:00.000Z' }), 0.91),
        n(mem('band'), 0.75),
      ],
      { occurredAt: SUMMER },
    )
    expect(action).toEqual({ kind: 'insert-linked', linkTo: ['spring', 'autumn', 'band'], reason: 'date-guard' })
  })

  it('never fires without an event time on both sides', () => {
    expect(decide([n(mem('a', { occurredAt: SPRING }), 0.96)])).toEqual({ kind: 'absorb', into: 'a' })
  })
})

describe('decideAdmission — digests and the cold tier', () => {
  it('a digest reached through a superseded member absorbs by count only', () => {
    const digest = mem('digest', { source: 'CONSOLIDATED' })
    expect(decide([n(digest, 0.87, { via: 'member' })])).toEqual({ kind: 'absorb', into: 'digest', redirectedFrom: 'member' })
    expect(decide([n(digest, 0.95, { via: 'member' })])).toEqual({ kind: 'absorb', into: 'digest', redirectedFrom: 'member' })
  })

  it('a digest matched directly in the reinforce band is reinforced', () => {
    expect(decide([n(mem('digest', { source: 'CONSOLIDATED' }), 0.87)])).toEqual({ kind: 'reinforce', into: 'digest' })
  })

  it('a cold row nothing supersedes is promoted, then reinforced', () => {
    expect(decide([n(mem('cold', { tier: 'cold' }), 0.87)])).toEqual({
      kind: 'promote-and-reinforce',
      into: 'cold',
      withFootnotes: true,
    })
  })

  it('a cold near-duplicate is promoted, then absorbed', () => {
    expect(decide([n(mem('cold', { tier: 'cold' }), 0.95)])).toEqual({
      kind: 'promote-and-reinforce',
      into: 'cold',
      withFootnotes: false,
    })
  })

  it('a cold row whose digest is gone is promoted', () => {
    const cold = mem('cold', { tier: 'cold', supersededById: 'gone' })
    expect(decide([n(cold, 0.95, { danglingDigest: true })])).toMatchObject({ kind: 'promote-and-reinforce', into: 'cold' })
  })

  it('a cold row in the band is linked, not promoted', () => {
    expect(decide([n(mem('cold', { tier: 'cold' }), 0.75)])).toEqual({ kind: 'insert-linked', linkTo: ['cold'], reason: 'band' })
  })
})

describe('decideAdmission — the trace', () => {
  it('records a verdict for every neighbour, best first', () => {
    const { assessments } = decideAdmission({
      candidate: AUTO_SELF,
      neighbours: [n(mem('low'), 0.4), n(mem('bob', { aboutCharacterId: BOB }), 0.96), n(mem('band'), 0.75), n(mem('ok'), 0.88)],
      thresholds: ADMISSION_THRESHOLDS,
    })
    expect(assessments).toEqual([
      { id: 'bob', cosine: 0.96, verdict: 'excluded', excludedBy: 'subject' },
      { id: 'ok', cosine: 0.88, verdict: 'eligible' },
      { id: 'band', cosine: 0.75, verdict: 'band' },
      { id: 'low', cosine: 0.4, verdict: 'below' },
    ])
  })
})
