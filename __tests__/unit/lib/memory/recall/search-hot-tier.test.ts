/**
 * Tier-aware reads in searchMemories (consolidation spec B2):
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
  embeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).embeddingTextFor,
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}))

const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const embeddingMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: { search: jest.Mock; shape: jest.Mock } }

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

describe('searchMemories — hot/cold tiers', () => {
  let searchMemories: typeof import('@/lib/memory/recall/search').searchMemories
  const hot = makeMemory('hot-1', 'hot')
  const cold = makeMemory('cold-1', 'cold')

  beforeEach(() => {
    jest.clearAllMocks()
    repositoriesMock.getRepositories.mockReturnValue({
      memories: {
        findByIds: jest.fn(async (ids: string[]) => [hot, cold].filter(m => ids.includes(m.id))),
        searchByContent: jest.fn(async () => [hot, cold]),
        updateAccessTimeBulk: jest.fn(async () => undefined),
      },
    } as never)
    // An index that honors hotOnly / exclude, like the real one.
    const entries = [
      { id: 'hot-1', score: 0.8, metadata: { memoryId: 'hot-1', characterId: 'char-1', tier: 'hot' } },
      { id: 'cold-1', score: 0.9, metadata: { memoryId: 'cold-1', characterId: 'char-1', tier: 'cold' } },
    ]
    indexMock.memoryIndex.search.mockImplementation(
      async (_c: unknown, _v: unknown, opts: any) =>
        entries.filter(
          e => (!opts.hotOnly || e.metadata.tier !== 'cold') && !(opts.exclude?.has(e.metadata.memoryId)),
        ),
    )
    indexMock.memoryIndex.shape.mockResolvedValue({ size: 2, dominantDimensions: 3, matching: 2 } as never)
    embeddingMock.generateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([1, 0, 0]), model: 'test' })
    jest.isolateModules(() => {
      searchMemories = require('@/lib/memory/recall/search').searchMemories
    })
  })

  it('asks the index for the hot tier only by default', async () => {
    const results = await searchMemories('char-1', 'anything at all', { userId: 'u1', limit: 10 })
    expect(indexMock.memoryIndex.search.mock.calls[0][2]).toMatchObject({ hotOnly: true })
    expect(results.map(r => r.memory.id)).toEqual(['hot-1'])
  })

  it('drops cold rows even when a literal text hit surfaces them', async () => {
    const results = await searchMemories('char-1', 'covenant wall', {
      userId: 'u1', limit: 10, literalPhrase: true,
    })
    expect(results.map(r => r.memory.id)).not.toContain('cold-1')
  })

  it('includeCold returns both tiers', async () => {
    const results = await searchMemories('char-1', 'anything at all', {
      userId: 'u1', limit: 10, includeCold: true,
    })
    expect(indexMock.memoryIndex.search.mock.calls[0][2]).toMatchObject({ hotOnly: false })
    expect(results.map(r => r.memory.id).sort()).toEqual(['cold-1', 'hot-1'])
  })

  it('combines the hot filter with excludeMemoryIds', async () => {
    const results = await searchMemories('char-1', 'anything at all', {
      userId: 'u1', limit: 10, excludeIds: new Set(['hot-1']),
    })
    expect(results).toHaveLength(0)
  })
})
