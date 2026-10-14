/**
 * Bug 214 — when embedding fails, searchMemories falls back to text
 * search. The fallback used to read only limit / minImportance / source /
 * aboutCharacterId / includeCold; it now honours occurredWithin,
 * excludeMemoryIds, recallContext, extraProbes, entityAnchors and
 * weightClockMs the way the vector path does.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EmbeddingError'
    }
  },
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] * b[i]
    return sum
  }),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
  getVectorStoreManager: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // The real logger exposes `child`; modules that build a scoped logger at
    // import time (the realtime bus, reached through the activity registry)
    // need it present on the mock too.
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const embeddingMock = jest.requireMock('@/lib/embedding/embedding-service') as {
  generateEmbeddingForUser: jest.Mock
}
const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as {
  getCharacterVectorStore: jest.Mock
}

const baseTime = '2026-04-01T00:00:00.000Z'

function makeMemory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mem-x',
    characterId: 'char-1',
    content: 'Body text',
    summary: 'Summary text',
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    aboutCharacterId: null,
    chatId: null,
    source: 'AUTO' as const,
    sourceMessageId: null,
    reinforcementCount: 1,
    relatedMemoryIds: [],
    embedding: new Float32Array([1, 0, 0]),
    lastAccessedAt: null,
    lastReinforcedAt: null,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  }
}


describe('searchMemories — text-search fallback honours recall options (bug 214)', () => {
  let mockMemoriesRepo: {
    findByIds: jest.Mock
    searchByContent: jest.Mock
    updateAccessTimeBulk: jest.Mock
  }
  let searchMemories: typeof import('@/lib/memory/recall/search').searchMemories
  let salience: typeof import('@/lib/memory/scoring').salience

  const inside = makeMemory({ id: 'in-window', content: 'We walked to the harbour', summary: 'harbour walk', occurredAt: '2026-04-10T12:00:00.000Z' })
  const outside = makeMemory({ id: 'out-window', content: 'The harbour was foggy', summary: 'harbour fog', occurredAt: '2026-03-01T12:00:00.000Z' })
  const later = makeMemory({ id: 'later', content: 'Harbour lights at dusk', summary: 'harbour lights', occurredAt: '2026-04-11T12:00:00.000Z' })
  const anchorOnly = makeMemory({ id: 'anchor', content: 'Saltmarsh harbour ferry', summary: 'Saltmarsh', occurredAt: '2026-04-10T13:00:00.000Z' })
  const corpus = [inside, outside, later, anchorOnly]

  beforeEach(() => {
    jest.clearAllMocks()
    mockMemoriesRepo = {
      findByIds: jest.fn(),
      searchByContent: jest.fn(async (_characterId: string, phrase: string) =>
        corpus.filter(m =>
          m.content.toLowerCase().includes(phrase.toLowerCase()) ||
          m.summary.toLowerCase().includes(phrase.toLowerCase()),
        ),
      ),
      updateAccessTimeBulk: jest.fn().mockResolvedValue(undefined),
    }
    repositoriesMock.getRepositories.mockReturnValue({ memories: mockMemoriesRepo } as never)
    // The embedding call fails, so every search takes the text fallback.
    embeddingMock.generateEmbeddingForUser.mockRejectedValue(new Error('provider down'))

    jest.isolateModules(() => {
      searchMemories = require('@/lib/memory/recall/search').searchMemories
      salience = require('@/lib/memory/scoring').salience
    })
  })

  const window = { from: '2026-04-09T00:00:00.000Z', to: '2026-04-12T00:00:00.000Z' }

  it('hard-filters to occurredWithin on the tool path (no recallContext)', async () => {
    const results = await searchMemories('char-1', 'harbour', { userId: 'u', window: window })
    expect(results.map(r => r.usedEmbedding)).not.toContain(true)
    expect(results.map(r => r.memory.id).sort()).toEqual(['anchor', 'in-window', 'later'])
  })

  it('drops excludeMemoryIds', async () => {
    const results = await searchMemories('char-1', 'harbour', {
      userId: 'u',
      excludeIds: new Set(['later', 'outside-not-present']),
    })
    expect(results.map(r => r.memory.id)).not.toContain('later')
    expect(results.map(r => r.memory.id)).toContain('in-window')
  })

  it('applies the recall multipliers, with the window as a bounded boost when the hard filter would starve', async () => {
    const results = await searchMemories('char-1', 'harbour', {
      userId: 'u',
      limit: 10,
      window: window,
      recallContext: { currentProjectId: null, scopePolicy: 'down-weight' },
    })
    // Out-of-window row survives (only 3 in-window < limit) but is not boosted.
    const byId = new Map(results.map(r => [r.memory.id, r]))
    expect(byId.has('out-window')).toBe(true)
    expect(byId.get('in-window')?.recallAdjustment?.fired).toContain('window↑')
    expect(byId.get('out-window')?.recallAdjustment?.fired ?? []).not.toContain('window↑')
  })

  it('weights by weightClockMs instead of the wall clock', async () => {
    const clockMs = Date.parse('2026-04-12T00:00:00.000Z')
    const results = await searchMemories('char-1', 'harbour walk', { userId: 'u', nowMs: clockMs })
    const hit = results.find(r => r.memory.id === 'in-window')!
    const expected = salience(hit.memory, { nowMs: clockMs })
    expect(hit.salience).toBeCloseTo(expected.salience, 10)
  })

  it('unions extra probes and entity anchors into the candidate pool', async () => {
    await searchMemories('char-1', 'nothing matches this', {
      userId: 'u',
      probes: ['dusk lights'],
      anchors: ['Saltmarsh'],
    })
    const phrases = mockMemoriesRepo.searchByContent.mock.calls.map(c => c[1])
    expect(phrases).toContain('dusk lights')
    expect(phrases).toContain('Saltmarsh')

    const results = await searchMemories('char-1', 'nothing matches this', {
      userId: 'u',
      probes: ['dusk lights'],
    })
    expect(results.map(r => r.memory.id)).toEqual(['later'])
  })
})
