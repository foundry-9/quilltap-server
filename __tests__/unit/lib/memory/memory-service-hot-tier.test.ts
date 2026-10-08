/**
 * Tier-aware reads in searchMemoriesSemantic (consolidation spec B2):
 * recall is hot-only by default; `includeCold` (the `search` tool, the UI)
 * reads both tiers.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
  cosineSimilarity: jest.fn(() => 0.5),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
  getVectorStoreManager: jest.fn(),
  isHotVector: (metadata: { tier?: string }) => metadata.tier !== 'cold',
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}))

const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const embeddingMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock }

const t = '2026-04-01T00:00:00.000Z'
function makeMemory(id: string, tier: 'hot' | 'cold') {
  return {
    id, characterId: 'char-1', content: `body ${id}`, summary: `sum ${id}`, keywords: [], tags: [],
    importance: 0.6, reinforcedImportance: 0.6, aboutCharacterId: null, chatId: null, source: 'AUTO',
    sourceMessageId: null, reinforcementCount: 1, relatedMemoryIds: [], embedding: new Float32Array([1, 0, 0]),
    lastAccessedAt: null, lastReinforcedAt: null, createdAt: t, updatedAt: t, tier,
    supersededById: tier === 'cold' ? 'digest-1' : null,
  }
}

describe('searchMemoriesSemantic — hot/cold tiers', () => {
  let searchMemoriesSemantic: typeof import('@/lib/memory/memory-service').searchMemoriesSemantic
  const hot = makeMemory('hot-1', 'hot')
  const cold = makeMemory('cold-1', 'cold')
  let store: { search: jest.Mock; getDimensions: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    repositoriesMock.getRepositories.mockReturnValue({
      memories: {
        findByIds: jest.fn(async (ids: string[]) => [hot, cold].filter(m => ids.includes(m.id))),
        searchByContent: jest.fn(async () => [hot, cold]),
        updateAccessTimeBulk: jest.fn(async () => undefined),
      },
    } as never)
    // A store that honors its filter, like the real one.
    const entries = [
      { id: 'hot-1', score: 0.8, metadata: { memoryId: 'hot-1', characterId: 'char-1', tier: 'hot' } },
      { id: 'cold-1', score: 0.9, metadata: { memoryId: 'cold-1', characterId: 'char-1', tier: 'cold' } },
    ]
    store = {
      search: jest.fn((_e: unknown, _k: number, filter?: (m: any) => boolean) =>
        entries.filter(e => !filter || filter(e.metadata))),
      getDimensions: jest.fn().mockReturnValue(3),
    }
    vectorStoreMock.getCharacterVectorStore.mockResolvedValue(store)
    embeddingMock.generateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([1, 0, 0]), model: 'test' })
    jest.isolateModules(() => {
      searchMemoriesSemantic = require('@/lib/memory/memory-service').searchMemoriesSemantic
    })
  })

  it('passes a hot-only filter to the vector search by default', async () => {
    const results = await searchMemoriesSemantic('char-1', 'anything at all', { userId: 'u1', limit: 10 })
    expect(store.search.mock.calls[0][2]).toBeInstanceOf(Function)
    expect(results.map(r => r.memory.id)).toEqual(['hot-1'])
  })

  it('drops cold rows even when a literal text hit surfaces them', async () => {
    const results = await searchMemoriesSemantic('char-1', 'covenant wall', {
      userId: 'u1', limit: 10, applyLiteralPhraseBoost: true,
    })
    expect(results.map(r => r.memory.id)).not.toContain('cold-1')
  })

  it('includeCold returns both tiers', async () => {
    const results = await searchMemoriesSemantic('char-1', 'anything at all', {
      userId: 'u1', limit: 10, includeCold: true,
    })
    expect(results.map(r => r.memory.id).sort()).toEqual(['cold-1', 'hot-1'])
  })

  it('combines the hot filter with excludeMemoryIds', async () => {
    const results = await searchMemoriesSemantic('char-1', 'anything at all', {
      userId: 'u1', limit: 10, excludeMemoryIds: new Set(['hot-1']),
    })
    expect(results).toHaveLength(0)
  })
})
