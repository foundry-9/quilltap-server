/**
 * Memory Gate against cold rows (consolidation-and-tiers spec B3).
 *
 * The gate searches both tiers. A cold, superseded match redirects absorption
 * to its digest (count only, no footnote) or links the new row to the digest;
 * a cold match nobody superseded is promoted back to hot when re-observed.
 */

jest.mock('@/lib/embedding/embedding-service', () => ({
  __esModule: true,
  EmbeddingError: class EmbeddingError extends Error {},
  generateEmbeddingForUser: jest.fn(),
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  __esModule: true,
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    search: jest.fn(),
    shape: jest.fn(),
    upsert: jest.fn(),
    indexInserted: jest.fn(),
    setTier: jest.fn(),
    remove: jest.fn(),
    reload: jest.fn(),
    reloadAll: jest.fn(),
    entries: jest.fn(),
  },
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
}))

import { runMemoryGate } from '../memory-gate'
import { memoryIndex } from '../index-store'
import type { Memory } from '@/lib/schemas/types'

function mem(overrides: Partial<Memory>): Memory {
  return {
    id: 'm',
    characterId: 'char-1',
    content: 'content',
    summary: 'summary',
    keywords: [],
    tags: [],
    importance: 0.6,
    aboutCharacterId: null,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    consolidatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

describe('runMemoryGate against cold rows', () => {
  let rows: Map<string, Memory>
  let setTier: jest.Mock
  let search: jest.Mock
  let searchResults: Array<{ id: string; score: number }>

  beforeEach(() => {
    jest.clearAllMocks()
    rows = new Map()
    searchResults = []
    // Tier moves go through the index, which owns the row's tier and the cache.
    setTier = jest.mocked(memoryIndex.setTier).mockResolvedValue(1) as unknown as jest.Mock
    search = jest.mocked(memoryIndex.search).mockImplementation(async () =>
      searchResults.map(r => ({ ...r, metadata: { memoryId: r.id, characterId: 'char-1' } })),
    ) as unknown as jest.Mock

    const embedding = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
    embedding.generateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([1, 0]) })

    const factory = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
    factory.getRepositories.mockReturnValue({
      memories: {
        findByIds: jest.fn(async (ids: string[]) => ids.map(id => rows.get(id)).filter(Boolean)),
      },
    })
  })

  const put = (...ms: Memory[]) => ms.forEach(m => rows.set(m.id, m))
  const run = () => runMemoryGate('char-1', 'content', 'summary', [], 'user-1')

  it('redirects a near-duplicate of a superseded cold row to its digest', async () => {
    put(mem({ id: 'cold', tier: 'cold', supersededById: 'digest' }), mem({ id: 'digest', source: 'CONSOLIDATED' }))
    searchResults = [{ id: 'cold', score: 0.95 }]
    const { decision } = await run()
    expect(decision.action).toBe('SKIP_NEAR_DUPLICATE')
    expect((decision as { existingMemory: Memory }).existingMemory.id).toBe('digest')
    expect(setTier).not.toHaveBeenCalled()
    // The gate searches both tiers.
    expect(search).toHaveBeenCalledWith('char-1', expect.any(Float32Array), expect.objectContaining({ hotOnly: false }))
  })

  it('redirects a REINFORCE-band match to the digest as a count-only absorption (no footnote path)', async () => {
    put(mem({ id: 'cold', tier: 'cold', supersededById: 'digest' }), mem({ id: 'digest', source: 'CONSOLIDATED' }))
    searchResults = [{ id: 'cold', score: 0.87 }]
    const { decision } = await run()
    expect(decision.action).toBe('SKIP_NEAR_DUPLICATE')
    expect((decision as { existingMemory: Memory }).existingMemory.id).toBe('digest')
  })

  it('links INSERT_RELATED to the digest instead of the cold member, once', async () => {
    put(
      mem({ id: 'cold1', tier: 'cold', supersededById: 'digest' }),
      mem({ id: 'cold2', tier: 'cold', supersededById: 'digest' }),
      mem({ id: 'digest', source: 'CONSOLIDATED' }),
    )
    searchResults = [{ id: 'cold1', score: 0.78 }, { id: 'cold2', score: 0.74 }]
    const { decision } = await run()
    expect(decision.action).toBe('INSERT_RELATED')
    const related = (decision as { relatedMemories: Array<{ memory: Memory }> }).relatedMemories
    expect(related.map(r => r.memory.id)).toEqual(['digest'])
  })

  it('falls back to the cold row when the digest no longer exists', async () => {
    put(mem({ id: 'cold', tier: 'cold', supersededById: 'gone' }))
    searchResults = [{ id: 'cold', score: 0.95 }]
    const { decision } = await run()
    expect(decision.action).toBe('SKIP_NEAR_DUPLICATE')
    expect((decision as { existingMemory: Memory }).existingMemory.id).toBe('cold')
    expect(setTier).not.toHaveBeenCalled()
  })

  it('promotes a non-superseded cold row re-observed at the merge threshold', async () => {
    put(mem({ id: 'cold', tier: 'cold' }))
    searchResults = [{ id: 'cold', score: 0.87 }]
    const { decision } = await run()
    expect(decision.action).toBe('REINFORCE')
    const target = (decision as { existingMemory: Memory }).existingMemory
    expect(target.id).toBe('cold')
    expect(target.tier).toBe('hot')
    expect(setTier).toHaveBeenCalledWith('char-1', ['cold'], 'hot', { supersededById: null })
  })

  it('does not promote a cold row seen only in the related band', async () => {
    put(mem({ id: 'cold', tier: 'cold' }))
    searchResults = [{ id: 'cold', score: 0.75 }]
    const { decision } = await run()
    expect(decision.action).toBe('INSERT_RELATED')
    expect(setTier).not.toHaveBeenCalled()
  })

  it('leaves hot matches exactly as before', async () => {
    put(mem({ id: 'hot' }))
    searchResults = [{ id: 'hot', score: 0.87 }]
    const { decision } = await run()
    expect(decision.action).toBe('REINFORCE')
    expect(setTier).not.toHaveBeenCalled()
  })
})
