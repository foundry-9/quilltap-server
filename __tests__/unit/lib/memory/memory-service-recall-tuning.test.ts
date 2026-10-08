/**
 * searchMemoriesSemantic — the recall-replay harness knobs (R7) and the
 * retuning paths they reach: `excludeMemoryIds` (asOf), `weightClockMs`,
 * R4's specific entity anchors and R6's background reservation.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
  cosineSimilarity: jest.fn((a: ArrayLike<number>, b: ArrayLike<number>) => {
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
    child: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}))

import { reserveBackgroundSlots, searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
import { resolveRecallTuning } from '@/lib/memory/recall-tuning'
import type { RecallContext } from '@/lib/memory/recall-tags'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'

const mockRepos = getRepositories as jest.Mock
const mockEmbed = generateEmbeddingForUser as jest.Mock
const mockStore = getCharacterVectorStore as jest.Mock

const T0 = '2026-04-01T00:00:00.000Z'

function memory(id: string, cosine: number, over: Record<string, unknown> = {}) {
  return {
    id,
    characterId: 'char-1',
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    aboutCharacterId: null,
    chatId: null,
    projectId: null,
    source: 'AUTO' as const,
    relatedMemoryIds: [],
    // cosine against the query [1, 0, 0] is the first component.
    embedding: new Float32Array([cosine, 0, 0]),
    lastAccessedAt: null,
    lastReinforcedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

type Mem = ReturnType<typeof memory>

let corpus: Mem[]
let contentHits: Record<string, Mem[]>
let vectorSearch: jest.Mock

function prime(memories: Mem[], hits: Record<string, Mem[]> = {}) {
  corpus = memories
  contentHits = hits
  vectorSearch = jest.fn((_q: unknown, limit: number, filter?: (m: { memoryId: string }) => boolean) =>
    corpus
      .filter(m => !filter || filter({ memoryId: m.id }))
      .map(m => ({ id: m.id, score: m.embedding[0], metadata: { memoryId: m.id, characterId: 'char-1' } }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
  )
  mockStore.mockResolvedValue({ search: vectorSearch, getDimensions: () => 3 })
  mockRepos.mockReturnValue({
    memories: {
      findByIds: jest.fn(async (ids: string[]) => corpus.filter(m => ids.includes(m.id))),
      searchByContent: jest.fn(async (_c: string, phrase: string) => contentHits[phrase] ?? []),
    },
  })
}

const ctx = (over: Partial<RecallContext> = {}): RecallContext => ({
  currentProjectId: null,
  scopePolicy: 'down-weight',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEmbed.mockResolvedValue({ embedding: new Float32Array([1, 0, 0]), provider: 'OPENAI', model: 'test' })
})

describe('excludeMemoryIds', () => {
  it('filters the vector scan, so the top-K is drawn from what remains', async () => {
    prime([memory('old', 0.6), memory('later', 0.9)])

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx(),
      excludeMemoryIds: new Set(['later']),
    })

    expect(results.map(r => r.memory.id)).toEqual(['old'])
    expect(vectorSearch.mock.calls[0][2]).toEqual(expect.any(Function))
  })

  it('keeps an excluded memory out of the entity-anchor union', async () => {
    const later = memory('later-hit', 0.5)
    prime([memory('old', 0.6), later], { Tessarium: [later] })
    vectorSearch.mockReturnValue([{ id: 'old', score: 0.6, metadata: { memoryId: 'old', characterId: 'char-1' } }])

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx(),
      entityAnchors: ['Tessarium'],
      excludeMemoryIds: new Set(['later-hit']),
    })

    expect(results.map(r => r.memory.id)).toEqual(['old'])
  })

  it('passes no filter when nothing is excluded', async () => {
    prime([memory('a', 0.6)])

    await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx() })

    expect(vectorSearch.mock.calls[0][2]).toBeUndefined()
  })
})

describe('weightClockMs', () => {
  it('decays weights against the given clock instead of now', async () => {
    prime([memory('a', 0.6)])

    const [atCreation] = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx(),
      weightClockMs: Date.parse(T0),
    })
    const [today] = await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx() })

    expect(atCreation.rawWeight).toBeCloseTo(0.5)
    expect(today.rawWeight!).toBeLessThan(atCreation.rawWeight!)
  })
})

describe('R4 — specific entity anchors', () => {
  it('counts every entity, then anchors on the rare names that are not in the room', async () => {
    const tess = memory('tess', 0.45)
    const amy = Array.from({ length: 5 }, (_, i) => memory(`amy-${i}`, 0.31))
    prime([memory('top', 0.6), tess, ...amy], { Amy: amy, Steinway: [], Tessarium: [tess] })
    vectorSearch.mockReturnValue([{ id: 'top', score: 0.6, metadata: { memoryId: 'top', characterId: 'char-1' } }])

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx({
        tuning: resolveRecallTuning({ specificAnchors: true }),
        presentParticipantNames: ['Amy'],
      }),
      entityAnchors: ['Amy', 'Steinway', 'Tessarium'],
    })

    expect(results.map(r => r.memory.id).sort()).toEqual(['tess', 'top'])
  })

  it('takes the first three entities when the knob is off', async () => {
    const amy = memory('amy-0', 0.31)
    prime([memory('top', 0.6), amy], { Amy: [amy] })
    vectorSearch.mockReturnValue([{ id: 'top', score: 0.6, metadata: { memoryId: 'top', characterId: 'char-1' } }])

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx({ presentParticipantNames: ['Amy'], tuning: resolveRecallTuning({ specificAnchors: false }) }),
      entityAnchors: ['Amy'],
    })

    expect(results.map(r => r.memory.id)).toContain('amy-0')
  })
})

describe('R6 — background reservation', () => {
  const IN = '2026-10-06T12:00:00.000Z'
  const window = { from: '2026-10-06T00:00:00.000Z', to: '2026-10-06T23:59:59.000Z' }

  function hardWindowCorpus() {
    // Four same-day rows (enough to make the window hard at limit 4) and two
    // older on-topic rows: one above the gate, one below it.
    return [
      memory('in-1', 0.62, { createdAt: IN }),
      memory('in-2', 0.5, { createdAt: IN }),
      memory('in-3', 0.4, { createdAt: IN }),
      memory('in-4', 0.33, { createdAt: IN }),
      memory('bg-strong', 0.49, { createdAt: '2026-09-21T00:00:00.000Z' }),
      memory('bg-weak', 0.36, { createdAt: '2026-09-22T00:00:00.000Z' }),
    ]
  }

  it('gives a third of the head to out-of-window rows that clear the gate', async () => {
    prime(hardWindowCorpus())

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 4,
      recallContext: ctx({
        tuning: resolveRecallTuning({ boostGateAbs: 0.45, boostGateMargin: 0.15, boostGateRamp: 0.1, backgroundReserve: 0.34 }),
      }),
      occurredWithin: window,
      headSize: 3,
    })

    const head = results.slice(0, 3).map(r => r.memory.id)
    expect(head).toContain('bg-strong')
    expect(head).not.toContain('bg-weak')
    expect(results.find(r => r.memory.id === 'bg-strong')!.recallAdjustment!.fired).toContain('bg↺')
  })

  it('leaves the hard window alone without a reserve', async () => {
    prime(hardWindowCorpus())

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 4,
      recallContext: ctx({ tuning: resolveRecallTuning({ boostGateAbs: 0.45, boostGateMargin: 0.15 }) }),
      occurredWithin: window,
      headSize: 3,
    })

    expect(results.map(r => r.memory.id)).toEqual(['in-1', 'in-2', 'in-3', 'in-4'])
  })
})

describe('reserveBackgroundSlots', () => {
  const row = (id: string, after: number) =>
    ({ memory: { id }, score: 0, recallAdjustment: { multiplier: 1, fired: [], blendedBefore: after, blendedAfter: after } }) as unknown as SemanticSearchResult
  const ids = (rs: SemanticSearchResult[]) => rs.map(r => r.memory.id)

  it('swaps the weakest head rows for the best background rows, keeping score order', () => {
    const ranked = [row('a', 0.9), row('b', 0.8), row('c', 0.7), row('d', 0.6), row('e', 0.5), row('f', 0.4)]
    const bg = [row('x', 0.65), row('y', 0.3)]

    expect(ids(reserveBackgroundSlots(ranked, bg, 6, 1 / 3))).toEqual(['a', 'b', 'c', 'x', 'd', 'y', 'e', 'f'])
  })

  it('returns unused slots to the ranked rows', () => {
    const ranked = [row('a', 0.9), row('b', 0.8), row('c', 0.7)]

    expect(ids(reserveBackgroundSlots(ranked, [row('x', 0.2)], 3, 0.5))).toEqual(['a', 'b', 'x', 'c'])
    expect(ids(reserveBackgroundSlots(ranked, [], 3, 0.5))).toEqual(['a', 'b', 'c'])
  })
})

describe('embeddingMemo', () => {
  it('embeds each text once across searches that share a memo', async () => {
    prime([memory('a', 0.6)])
    const memo = new Map()

    await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx(), embeddingMemo: memo, extraProbes: ['p'] })
    await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx(), embeddingMemo: memo, extraProbes: ['p'] })

    expect(mockEmbed.mock.calls.map(c => c[0])).toEqual(['q', 'p'])
  })

  it('embeds afresh without one', async () => {
    prime([memory('a', 0.6)])

    await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx() })
    await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: ctx() })

    expect(mockEmbed).toHaveBeenCalledTimes(2)
  })
})

describe('R5 — the cosine floor', () => {
  // OPENAI → the neural floor (0.30). Turn B's sub-floor rows were all related↗.
  it('holds for entity hits and probe hits; only related expansion is exempt', async () => {
    const entityLow = memory('entity-low', 0.2)
    const neighbour = memory('neighbour', 0.25)
    const seed = memory('seed', 0.6, { relatedMemoryIds: ['neighbour'] })
    prime([seed, entityLow, neighbour], { Tessarium: [entityLow] })
    vectorSearch.mockImplementation(() => [
      { id: 'seed', score: 0.6, metadata: { memoryId: 'seed', characterId: 'char-1' } },
      { id: 'probe-low', score: 0.29, metadata: { memoryId: 'probe-low', characterId: 'char-1' } },
    ])
    corpus.push(memory('probe-low', 0.29))

    const results = await searchMemoriesSemantic('char-1', 'q', {
      userId: 'u1',
      limit: 10,
      recallContext: ctx({ expandRelated: true }),
      entityAnchors: ['Tessarium'],
      extraProbes: ['p'],
    })

    const ids = results.map(r => r.memory.id)
    expect(ids).not.toContain('entity-low')
    expect(ids).not.toContain('probe-low')
    expect(ids).toContain('neighbour')
    expect(results.find(r => r.memory.id === 'neighbour')!.recallAdjustment!.fired).toContain('related↗')
  })
})

describe('the retuned defaults in searchMemoriesSemantic', () => {
  // A low-cosine row with every boost, beside a strong plain row.
  const NOW = Date.parse('2026-10-08T12:00:00.000Z')
  const stacked = () =>
    memory('stacked', 0.33, {
      keywords: ['scope: narrow', 'information', 'present'],
      projectId: 'proj-a',
      aboutCharacterId: 'char-present',
      chatId: 'chat-elsewhere',
      createdAt: new Date(NOW - 3600_000).toISOString(),
    })
  const liveCtx = () =>
    ctx({
      currentProjectId: 'proj-a',
      turnContext: 'information',
      presentAboutCharacterIds: ['char-present'],
      currentChatId: 'chat-here',
      nowMs: NOW,
    })

  it('gates boosts on relevance with no tuning given (neural embeddings)', async () => {
    prime([memory('strong', 0.6), stacked()])

    const results = await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: liveCtx() })

    const row = results.find(r => r.memory.id === 'stacked')!
    expect(row.recallAdjustment!.multiplier).toBe(1)
    expect(row.recallAdjustment!.fired).toContain('gate×0.00')
  })

  it('leaves the gate off for TF-IDF embeddings, keeping the cap', async () => {
    mockEmbed.mockResolvedValue({ embedding: new Float32Array([1, 0, 0]), provider: 'BUILTIN', model: 'tfidf' })
    prime([memory('strong', 0.6), stacked()])

    const results = await searchMemoriesSemantic('char-1', 'q', { userId: 'u1', limit: 10, recallContext: liveCtx() })

    const row = results.find(r => r.memory.id === 'stacked')!
    expect(row.recallAdjustment!.fired).not.toContain('gate×0.00')
    expect(row.recallAdjustment!.multiplier).toBeCloseTo(1.4)
  })
})
