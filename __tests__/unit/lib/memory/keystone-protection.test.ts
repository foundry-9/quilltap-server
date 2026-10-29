/**
 * Keystones are the operator's own statements (inner-circle-recall.md C4):
 * nothing automatic rewrites, moves or hides one.
 *
 * - A fold into a keystone counts the observation and adds links, but appends
 *   no `[+]` footnote and widens no anchor field.
 * - The near-duplicate fold never takes one, as survivor or absorbed.
 * - Consolidation never makes one a member or a seed.
 * - Demotion never demotes one, nor counts it against the cap.
 * - The protection score reports one protected, whatever its source.
 */

import { foldInto, type FoldCaps } from '@/lib/memory/admission/fold'
import { isFoldEligible } from '@/lib/memory/maintenance/fold-near-duplicates'
import { bucketCandidates } from '@/lib/memory/maintenance/consolidate'
import { isDemotable, planDemotion } from '@/lib/memory/maintenance/demote'
import { protection } from '@/lib/memory/scoring'
import type { Memory } from '@/lib/schemas/types'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => makeLogger()) })
  return { logger: makeLogger() }
})

const CAPS: FoldCaps = { footnoteCap: 3, entityCap: 10 }
const OLD = '2025-01-01T00:00:00.000Z'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm',
    characterId: 'holder',
    aboutCharacterId: 'abigail',
    content: 'Abigail has emerald-green hair.',
    summary: 'Abigail has green hair.',
    keywords: [],
    tags: [],
    importance: 0.6,
    source: 'AUTO',
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    entities: [],
    occurredAt: null,
    narrativeTime: null,
    tier: 'hot',
    keystone: false,
    embedding: new Float32Array([1, 0]),
    createdAt: OLD,
    updatedAt: OLD,
    ...overrides,
  } as Memory
}

describe('foldInto a keystone', () => {
  const source = {
    id: 'src',
    content: 'Abigail has emerald-green hair, cut short at Valparaiso.',
    entities: ['Valparaiso'],
    narrativeTime: 'the third bell',
    occurredAt: '2024-06-01T00:00:00.000Z',
    relatedMemoryIds: ['neighbour'],
    reinforcementCount: 2,
  }

  it('counts and links, but writes no footnote and no anchor field', () => {
    const plan = foldInto(makeMemory({ keystone: true }), [source], CAPS)
    expect(plan.footnotes).toEqual([])
    expect(plan.content).toBe('Abigail has emerald-green hair.')
    expect(plan.patch).toEqual({})
    expect(plan.reembed).toBe(false)
    expect(plan.reinforcementDelta).toBe(2)
    expect(plan.addLinks).toEqual(['neighbour'])
  })

  it('an ordinary survivor still takes the details', () => {
    const plan = foldInto(makeMemory(), [source], CAPS)
    expect(plan.footnotes.length).toBeGreaterThan(0)
    expect(plan.patch.narrativeTime).toBe('the third bell')
  })
})

describe('maintenance never reaches a keystone', () => {
  it('the near-duplicate fold leaves it out', () => {
    expect(isFoldEligible(makeMemory())).toBe(true)
    expect(isFoldEligible(makeMemory({ keystone: true }))).toBe(false)
  })

  it('consolidation takes it neither as a member nor as a seed digest', () => {
    const rows = [
      makeMemory({ id: 'auto' }),
      makeMemory({ id: 'auto-keystone', keystone: true }),
      makeMemory({ id: 'digest', source: 'CONSOLIDATED' }),
      makeMemory({ id: 'digest-keystone', source: 'CONSOLIDATED', keystone: true }),
    ]
    const { buckets } = bucketCandidates(rows, 'holder', Date.now())
    const all = [...buckets.values()]
    expect(all.flatMap(b => b.rows.map(r => r.id))).toEqual(['auto'])
    expect(all.flatMap(b => b.digests.map(d => d.id))).toEqual(['digest'])
  })

  it('demotion neither demotes it nor counts it against the cap', () => {
    expect(isDemotable(makeMemory({ keystone: true }))).toBe(false)
    const rows = [makeMemory({ id: 'a' }), makeMemory({ id: 'b' }), makeMemory({ id: 'k', keystone: true })]
    const report = planDemotion(rows, 1, Date.now())
    expect(report.demotable).toBe(2)
    expect(report.protected).toBe(1)
    expect(report.demotedIds).not.toContain('k')
  })

  it('the protection score reports it protected by its mark', () => {
    const plain = protection(makeMemory({ importance: 0.05, reinforcedImportance: 0.05 }))
    expect(plain.protected).toBe(false)
    const keystone = protection(makeMemory({ importance: 0.05, reinforcedImportance: 0.05, keystone: true }))
    expect(keystone).toMatchObject({ protected: true, protectedBySource: true, score: 1 })
  })
})
