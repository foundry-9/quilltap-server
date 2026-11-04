/**
 * Window-first recall (docs/developer/features/complete/search-window-first-and-honest-empty.md):
 * a dated search brings its period's rows into the pool before the cut, and a
 * narrow tool window is its own relevance filter. Undated searches and the
 * prompt path's floor are unchanged.
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
  lexicalEmbeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').lexicalEmbeddingTextFor,
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


import { searchMemories } from '@/lib/memory/recall/search'
import { gather } from '@/lib/memory/recall/gather'
import { score, isNarrowToolWindow, TOOL_WINDOW_FLOOR_MAX_DAYS } from '@/lib/memory/recall/score'
import type { RecallQuery } from '@/lib/memory/recall/query'
import type { HydratedHit, RecallTrace } from '@/lib/memory/recall/types'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { memoryIndex } from '@/lib/memory/index-store'


const mockRepos = getRepositories as jest.Mock
const mockEmbed = generateEmbeddingForUser as jest.Mock
const mockIndex = memoryIndex as unknown as { search: jest.Mock; shape: jest.Mock }

function memory(id: string, cosine: number, eventAt: string, over: Record<string, unknown> = {}) {
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
    embedding: new Float32Array([cosine, Math.sqrt(Math.max(0, 1 - cosine * cosine)), 0]),
    lastAccessedAt: null,
    lastReinforcedAt: null,
    occurredAt: eventAt,
    createdAt: eventAt,
    updatedAt: eventAt,
    ...over,
  }
}

type Mem = ReturnType<typeof memory>
let corpus: Mem[]
let findIdsInEventWindow: jest.Mock

function prime(memories: Mem[]) {
  corpus = memories
  mockIndex.search.mockImplementation(
    (_c: string, _q: unknown, opts: { limit: number; hotOnly: boolean; exclude?: ReadonlySet<string>; includeIds?: ReadonlySet<string> }) =>
      corpus
        .filter(m => !opts.includeIds || opts.includeIds.has(m.id))
        .filter(m => !opts.exclude?.has(m.id))
        .filter(m => !opts.hotOnly || (m as { tier?: string }).tier !== 'cold')
        .map(m => ({ id: m.id, score: m.embedding[0], metadata: { memoryId: m.id, characterId: 'char-1' } }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit),
  )
  mockIndex.shape.mockResolvedValue({ size: corpus.length, dominantDimensions: 3, matching: corpus.length })
  findIdsInEventWindow = jest.fn(async (_c: string, w: { from: string; to: string }) =>
    corpus.filter(m => (m.occurredAt ?? m.createdAt) >= w.from && (m.occurredAt ?? m.createdAt) <= w.to).map(m => m.id))
  mockRepos.mockReturnValue({
    memories: {
      findByIds: jest.fn(async (ids: string[]) => corpus.filter(m => ids.includes(m.id))),
      findIdsInEventWindow,
      searchByContent: jest.fn(async () => []),
    },
  })
}

const QUERY_VECTOR = new Float32Array([1, 0, 0])

beforeEach(() => {
  jest.clearAllMocks()
  mockEmbed.mockResolvedValue({ embedding: QUERY_VECTOR, provider: 'OPENAI', model: 'test' })
})

/** The Friday case: months of on-topic pool memories, and a day whose rows are about something else. */
function fridayCorpus(): Mem[] {
  const pool: Mem[] = []
  for (let i = 0; i < 40; i++) {
    const month = i < 20 ? '09' : '10'
    const day = String((i % 20) + 1).padStart(2, '0')
    pool.push(memory(`pool-${i}`, 0.6 + (i % 10) * 0.02, `2026-${month}-${day}T18:00:00.000Z`))
  }
  const nov3 = [0.28, 0.29, 0.31, 0.33, 0.34].map((c, i) =>
    memory(`nov3-${i}`, c, `2026-11-03T22:${String(40 + i * 4).padStart(2, '0')}:00.000Z`))
  return [...pool, ...nov3]
}

const NOV_3 = { from: '2026-11-03T06:00:00.000Z', to: '2026-11-04T05:59:59.999Z' }

function queryOf(window: { from: string; to: string } | null): RecallQuery {
  return {
    text: 'pool yesterday',
    embedding: { embedding: QUERY_VECTOR, provider: 'OPENAI', model: 'test' } as never,
    probes: [],
    signals: null,
    anchors: [],
    window,
    retrospective: false,
  }
}

describe('gather — window-first', () => {
  it('brings in-window rows into the pool with via "window" when the global top-K misses them', async () => {
    prime(fridayCorpus())
    const trace: RecallTrace = []
    const gathered = await gather('char-1', queryOf(NOV_3), { limit: 10, includeCold: true }, trace)
    const windowHits = gathered.hits.filter(h => h.via === 'window').map(h => h.id).sort()
    expect(windowHits).toEqual(['nov3-0', 'nov3-1', 'nov3-2', 'nov3-3', 'nov3-4'])
    expect(findIdsInEventWindow).toHaveBeenCalledWith('char-1', NOV_3, { hotOnly: false })
    const stage = trace.find(t => t.stage === 'gather')!
    expect(stage.detail).toMatchObject({ window: 5, windowAdded: 5 })
  })

  it('leaves the pool exactly as before without a window', async () => {
    prime(fridayCorpus())
    const gathered = await gather('char-1', queryOf(null), { limit: 10, includeCold: true })
    expect(findIdsInEventWindow).not.toHaveBeenCalled()
    expect(gathered.hits.every(h => h.via === 'vector')).toBe(true)
    expect(gathered.hits).toHaveLength(30)
    expect(gathered.hits.some(h => h.id.startsWith('nov3'))).toBe(false)
  })

  it('reads hot rows only when the archive is not searched', async () => {
    prime(fridayCorpus())
    await gather('char-1', queryOf(NOV_3), { limit: 10, includeCold: false })
    expect(findIdsInEventWindow).toHaveBeenCalledWith('char-1', NOV_3, { hotOnly: true })
  })
})

describe('score — the narrow tool window is its own relevance filter', () => {
  const inWin = memory('in', 0.2, '2026-11-03T22:00:00.000Z')
  const outWin = memory('out', 0.2, '2026-10-01T22:00:00.000Z')
  const hydrated: HydratedHit[] = [inWin, outWin].map(m => ({
    memory: m as never, rawScore: 0.2, score: 0.2, usedEmbedding: true,
  }))
  const gathered = { strategy: 'vector' as const, minScore: 0.3, provider: 'OPENAI' }
  const nowMs = Date.parse('2026-11-04T14:00:00.000Z')

  it('tool path, one-day window: an in-window row below the floor passes, an out-of-window row is filtered', () => {
    const trace: RecallTrace = []
    const scored = score(hydrated, gathered, { limit: 10, window: NOV_3, nowMs }, trace)
    expect(scored.ranked.map(r => r.memory.id)).toEqual(['in'])
    expect(trace.find(t => t.stage === 'score')!.detail).toMatchObject({ floorRelaxed: true })
  })

  it('tool path, thirty-day window: the floor holds', () => {
    const wide = { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }
    expect(score(hydrated, gathered, { limit: 10, window: wide, nowMs }).ranked).toEqual([])
  })

  it('prompt path (a recall context): the floor holds even inside a narrow window', () => {
    const scored = score(hydrated, gathered, {
      limit: 10,
      window: NOV_3,
      nowMs,
      recallContext: { currentProjectId: null, scopePolicy: 'down-weight' },
    })
    expect(scored.ranked).toEqual([])
  })

  it('isNarrowToolWindow agrees with the cut-off', () => {
    const DAY = 24 * 60 * 60 * 1000
    const from = Date.parse('2026-11-01T00:00:00.000Z')
    const at = (days: number) => ({ from: new Date(from).toISOString(), to: new Date(from + days * DAY).toISOString() })
    expect(isNarrowToolWindow(at(TOOL_WINDOW_FLOOR_MAX_DAYS))).toBe(true)
    expect(isNarrowToolWindow(at(TOOL_WINDOW_FLOOR_MAX_DAYS + 1))).toBe(false)
    expect(isNarrowToolWindow(null)).toBe(false)
  })
})

describe('the Friday regression: "what happened in the pool yesterday?"', () => {
  it('a search bracketed to Nov 3 returns the five Nov 3 memories', async () => {
    prime(fridayCorpus())
    const results = await searchMemories('char-1', 'pool yesterday', {
      userId: 'u1',
      limit: 10,
      window: NOV_3,
      includeCold: true,
      literalPhrase: true,
    })
    expect(results.map(r => r.memory.id).sort()).toEqual(['nov3-0', 'nov3-1', 'nov3-2', 'nov3-3', 'nov3-4'])
  })

  it('the same search with no window still returns the September–October pool memories', async () => {
    prime(fridayCorpus())
    const results = await searchMemories('char-1', 'pool yesterday', {
      userId: 'u1',
      limit: 10,
      includeCold: true,
      literalPhrase: true,
    })
    expect(results).toHaveLength(10)
    expect(results.every(r => r.memory.id.startsWith('pool-'))).toBe(true)
  })
})
