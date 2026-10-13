/**
 * `gatherNeighbours` — what the decider is shown.
 *
 *  - Bug 200: a vector whose row is gone (an orphan) must not stand at rank 1;
 *    the search widens past orphans to find live rows.
 *  - Tiers (consolidation spec B3): a cold member a digest supersedes is
 *    replaced by the digest (`via` names the member); several members of one
 *    cluster collapse onto it at the best cosine; a missing digest leaves the
 *    cold row standing for itself, marked `danglingDigest`.
 */

jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { search: jest.fn() },
}))

import { gatherNeighbours } from '../admission/neighbours'
import { decideAdmission } from '../admission/decide'
import { ADMISSION_THRESHOLDS } from '../settings-defaults'
import { memoryIndex } from '../index-store'
import type { Memory } from '@/lib/schemas/types'

function mem(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: 'char-1',
    content: 'content',
    summary: 'summary',
    keywords: [],
    tags: [],
    importance: 0.6,
    aboutCharacterId: null,
    source: 'AUTO',
    kind: 'semantic',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

const hit = (id: string, score: number) => ({ id, score, metadata: { memoryId: id, characterId: 'char-1' } })
const EMBEDDING = new Float32Array([1, 0])

describe('gatherNeighbours', () => {
  let rows: Map<string, Memory>
  let search: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    rows = new Map()
    search = jest.mocked(memoryIndex.search) as unknown as jest.Mock
    search.mockReset()
    const factory = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
    factory.getRepositories.mockReturnValue({
      memories: { findByIds: jest.fn(async (ids: string[]) => ids.map((id) => rows.get(id)).filter(Boolean)) },
    })
  })
  const put = (...ms: Memory[]) => ms.forEach((m) => rows.set(m.id, m))
  const decide = (neighbours: Awaited<ReturnType<typeof gatherNeighbours>>['neighbours']) =>
    decideAdmission({
      candidate: { holderId: 'char-1', aboutId: null, kind: 'semantic', source: 'AUTO', occurredAt: null },
      neighbours,
      thresholds: ADMISSION_THRESHOLDS,
    }).action

  it('searches both tiers', async () => {
    search.mockResolvedValue([])
    await gatherNeighbours('char-1', EMBEDDING)
    expect(search).toHaveBeenCalledWith('char-1', EMBEDDING, expect.objectContaining({ hotOnly: false }))
  })

  describe('orphan vectors (bug 200)', () => {
    it('drops an orphan at rank 1 so the live match behind it decides', async () => {
      put(mem('live'))
      search.mockResolvedValue([hit('orphan', 0.97), hit('live', 0.88)])
      const { neighbours, orphanIds } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours.map((n) => n.memory.id)).toEqual(['live'])
      expect(orphanIds).toEqual(['orphan'])
      expect(decide(neighbours)).toEqual({ kind: 'reinforce', into: 'live' })
    })

    it('widens the search past orphans that fill the whole top K', async () => {
      put(mem('live'))
      const orphans = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id, i) => hit(id, 0.99 - i * 0.001))
      search.mockImplementation(async (_c: string, _e: unknown, opts: { limit: number }) =>
        [...orphans, hit('live', 0.93)].slice(0, opts.limit),
      )
      const { neighbours, searchedK } = await gatherNeighbours('char-1', EMBEDDING)
      expect(search.mock.calls.length).toBeGreaterThan(1)
      expect(searchedK).toBeGreaterThan(5)
      expect(decide(neighbours)).toEqual({ kind: 'absorb', into: 'live' })
    })

    it('shows nothing when every hit is an orphan', async () => {
      search.mockResolvedValue([hit('orphan', 0.99)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours).toEqual([])
      expect(decide(neighbours)).toEqual({ kind: 'insert' })
    })
  })

  describe('cold members and digests', () => {
    it('replaces a superseded cold member with its digest', async () => {
      put(mem('cold', { tier: 'cold', supersededById: 'digest' }), mem('digest', { source: 'CONSOLIDATED' }))
      search.mockResolvedValue([hit('cold', 0.95)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours).toEqual([expect.objectContaining({ cosine: 0.95, via: 'cold', memory: expect.objectContaining({ id: 'digest' }) })])
      expect(decide(neighbours)).toEqual({ kind: 'absorb', into: 'digest', redirectedFrom: 'cold' })
    })

    it('follows a chain of digests up to three hops', async () => {
      put(
        mem('m', { tier: 'cold', supersededById: 'd1' }),
        mem('d1', { tier: 'cold', supersededById: 'd2', source: 'CONSOLIDATED' }),
        mem('d2', { source: 'CONSOLIDATED' }),
      )
      search.mockResolvedValue([hit('m', 0.9)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours[0].memory.id).toBe('d2')
      expect(neighbours[0].via).toBe('m')
    })

    it('collapses several members of one cluster onto the digest, best cosine kept', async () => {
      put(
        mem('cold1', { tier: 'cold', supersededById: 'digest' }),
        mem('cold2', { tier: 'cold', supersededById: 'digest' }),
        mem('digest', { source: 'CONSOLIDATED' }),
      )
      search.mockResolvedValue([hit('cold1', 0.78), hit('cold2', 0.74)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours).toHaveLength(1)
      expect(neighbours[0]).toMatchObject({ cosine: 0.78, via: 'cold1' })
      expect(decide(neighbours)).toEqual({ kind: 'insert-linked', linkTo: ['digest'], reason: 'band' })
    })

    it('leaves a cold row whose digest is gone standing for itself', async () => {
      put(mem('cold', { tier: 'cold', supersededById: 'gone' }))
      search.mockResolvedValue([hit('cold', 0.95)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours).toEqual([expect.objectContaining({ danglingDigest: true, memory: expect.objectContaining({ id: 'cold' }) })])
      expect(neighbours[0].via).toBeUndefined()
      expect(decide(neighbours)).toEqual({ kind: 'promote-and-reinforce', into: 'cold', withFootnotes: false })
    })

    it('passes a hot row through untouched', async () => {
      put(mem('hot'))
      search.mockResolvedValue([hit('hot', 0.8)])
      const { neighbours } = await gatherNeighbours('char-1', EMBEDDING)
      expect(neighbours).toEqual([{ memory: rows.get('hot'), cosine: 0.8 }])
    })
  })
})
