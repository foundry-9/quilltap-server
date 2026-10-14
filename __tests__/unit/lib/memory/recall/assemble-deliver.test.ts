/**
 * `assembleRecall` → `deliverRecall` over one small corpus:
 *
 * - **One embedding per turn.** The query is embedded once; the head, the
 *   inter-character relevance half, the recap's conversation list, the
 *   per-turn conversation list and the retrospective mini-recap all ride it.
 * - **A row reaches the model in at most one pool** (bug 224): archive →
 *   head → inter-character; the recap narrative skips the archive's rows but
 *   never takes a row from the head (it is a summary, not the memory's words).
 * - **The inter-character relevance half is a filter of the turn's pool**
 *   (decision 12) — no search of its own.
 * - **`deliver` stamps only what reached the model**: a line compression cut
 *   is not stamped, and the ring records only the head's delivered ids.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
  cosineSimilarity: (a: ArrayLike<number>, b: ArrayLike<number>) => {
    let dot = 0
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
    return dot
  },
}))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { search: jest.fn(), shape: jest.fn() },
  embeddingTextFor: jest.fn(),
}))
jest.mock('@/lib/memory/recall/conversations', () => ({
  ...jest.requireActual('@/lib/memory/recall/conversations'),
  searchVaultConversationSummaries: jest.fn(),
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  summarizeMemoryRecap: jest.fn(),
}))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({
  refreshMemoryTimeZone: jest.fn(async () => 'UTC'),
}))

import { assembleRecall, emptyRecallBundle, type RecallPlan } from '@/lib/memory/recall/assemble'
import { deliverRecall, RECALL_RING_PREFIX } from '@/lib/memory/recall/deliver'
import { buildRecallQuery } from '@/lib/memory/recall/query'
import { searchRecall } from '@/lib/memory/recall/search'
import { buildTurnRecallContext } from '@/lib/memory/recall/tags'
import { resetFrozenArchiveCacheForTests } from '@/lib/memory/recall/archive'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { memoryIndex } from '@/lib/memory/index-store'
import { searchVaultConversationSummaries } from '@/lib/memory/recall/conversations'
import { summarizeMemoryRecap } from '@/lib/memory/cheap-llm-tasks'
import type { Memory } from '@/lib/schemas/types'

const mockEmbed = generateEmbeddingForUser as jest.Mock
const mockVault = searchVaultConversationSummaries as jest.Mock
const mockRecap = summarizeMemoryRecap as jest.Mock

const NOW = Date.now()
const LYRA = 'char-a'
const IRIS = 'char-b'

function mem(id: string, cos: number, over: Partial<Memory> = {}): Memory {
  const createdAt = new Date(NOW - 5 * 86_400_000).toISOString()
  return {
    id,
    characterId: LYRA,
    content: `${id} content`,
    summary: `${id} summary`,
    keywords: [],
    tags: [],
    importance: 0.6,
    reinforcedImportance: 0.6,
    aboutCharacterId: null,
    chatId: null,
    projectId: null,
    source: 'AUTO',
    tier: 'hot',
    relatedMemoryIds: [],
    embedding: new Float32Array([cos, Math.sqrt(1 - cos * cos)]),
    createdAt,
    updatedAt: createdAt,
    ...over,
  } as Memory
}

// The archive holds `archived` (by importance) and the digest about Iris.
const archived = mem('archived', 0.8, { summary: 'Lyra keeps the brass ledger' })
const digestB = mem('digest-b', 0.3, {
  source: 'CONSOLIDATED',
  aboutCharacterId: IRIS,
  summary: 'Lyra and Iris crossed the Shivering Bridge',
  content: 'Lyra and Iris crossed the Shivering Bridge',
})
// Eight rows outrank everything else in the head (the 2000-token head takes 8).
const fillers = Array.from({ length: 8 }, (_, i) => mem(`filler-${i}`, 0.79 - i * 0.01, { summary: `filler ${i} remembered` }))
// About Iris, in the pool but below the head's cut: the relevance half's to take.
const aboutIris = mem('about-iris', 0.5, { aboutCharacterId: IRIS, content: 'Iris told Lyra the lighthouse secret', summary: 'iris secret' })
const partitionB = mem('partition-b', 0.1, { aboutCharacterId: IRIS, content: 'Iris hums when she is nervous', summary: 'iris hums' })
const recapOnly = mem('recap-only', 0.9, { summary: 'the recap narrates this' })
const corpus = [archived, digestB, ...fillers, aboutIris, partitionB, recapOnly]

let repos: Record<string, Record<string, jest.Mock>>

beforeEach(() => {
  jest.clearAllMocks()
  resetFrozenArchiveCacheForTests()
  mockEmbed.mockImplementation(async () => ({ embedding: new Float32Array([1, 0]), provider: 'OPENAI', model: 'm', dimensions: 2 }))
  mockVault.mockResolvedValue([])
  mockRecap.mockResolvedValue({ success: true, result: 'Lyra remembers a great deal.' })
  ;(memoryIndex.shape as jest.Mock).mockResolvedValue({ size: corpus.length, dominantDimensions: 2, matching: corpus.length })
  ;(memoryIndex.search as jest.Mock).mockImplementation(async (_c: string, v: Float32Array, opts: { limit: number }) =>
    corpus
      .map(m => ({ id: m.id, score: v[0] * m.embedding![0] + v[1] * m.embedding![1], metadata: {} }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit),
  )
  repos = {
    memories: {
      findByIds: jest.fn(async (ids: string[]) => corpus.filter(m => ids.includes(m.id))),
      searchByContent: jest.fn(async () => []),
      findHotDigests: jest.fn(async (_holder: string, about: string) => (about === IRIS ? [digestB] : [])),
      findMostImportant: jest.fn(async () => [archived]),
      findByCharacterAboutCharacters: jest.fn(async () => [digestB, partitionB]),
      findRecentByImportanceTier: jest.fn(async () => ({ high: [recapOnly, archived], medium: [], low: [] })),
      updateAccessTimeBulk: jest.fn(async () => 0),
    },
    characters: { findNamesByIds: jest.fn(async () => new Map([[IRIS, 'Iris']])) },
    chats: { update: jest.fn(async () => null), findRecentSummarizedByCharacter: jest.fn(async () => []) },
  }
  ;(getRepositories as jest.Mock).mockReturnValue(repos)
})

function plan(over: Partial<RecallPlan> = {}): RecallPlan {
  return {
    userId: 'user-1',
    provider: 'OPENAI' as never,
    character: { id: LYRA, name: 'Lyra' },
    chat: { id: 'chat-1', projectId: null, compactionGeneration: 0, commonplaceRecallHistory: null },
    memoryBudget: 2000,
    minImportance: 0.3,
    skipMemories: false,
    present: [{ id: LYRA, name: 'Lyra' }, { id: IRIS, name: 'Iris' }],
    interCharacterSubjects: [{ id: IRIS, name: 'Iris' }],
    currentStateTokens: 0,
    recallSettings: { scopePolicy: 'down-weight', expandRelated: false, perTurnConversationSummaries: true },
    recentWindow: 'What did Iris tell you at the lighthouse?',
    conversations: { maxContext: 32000, standingIds: async () => new Set() },
    ...over,
  }
}

const everything = (b: Awaited<ReturnType<typeof assembleRecall>>) =>
  [b.sections.recap, b.sections.relevant, b.sections.interCharacter].filter(Boolean).join('\n\n')

describe('assembleRecall', () => {
  it('embeds an ordinary turn once and lets every pool ride the vector', async () => {
    const bundle = await assembleRecall(plan())

    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(mockVault).toHaveBeenCalledWith(expect.objectContaining({ precomputedEmbedding: expect.any(Float32Array) }))
    expect(bundle.path).toBe('two-pool')
  })

  it('delivers a row in at most one pool, archive first (bug 224)', async () => {
    const bundle = await assembleRecall(plan())
    const text = everything(bundle)

    expect(text.split('Shivering Bridge').length - 1).toBe(1)
    expect(bundle.pools.archive).toEqual(expect.arrayContaining(['archived', 'digest-b']))
    expect(bundle.pools.head).not.toContain('archived')
    expect(bundle.pools.interCharacter).not.toContain('digest-b')
    const all = [...bundle.pools.archive, ...bundle.pools.head, ...bundle.pools.interCharacter]
    expect(new Set(all).size).toBe(all.length)
  })

  it('fills the inter-character relevance half from the turn’s own pool', async () => {
    const bundle = await assembleRecall(plan())

    expect(bundle.pools.interCharacter).toEqual(expect.arrayContaining(['about-iris', 'partition-b']))
    expect(bundle.sections.interCharacter).toContain('Iris told Lyra the lighthouse secret')
    // One search for the turn: the head's.
    expect((memoryIndex.search as jest.Mock).mock.calls).toHaveLength(1)
  })

  it('keeps the recap’s rows in the head on the turn it runs — a summary is no stand-in for the line', async () => {
    const bundle = await assembleRecall(plan({
      recap: { selection: {} as never, fallbackQuery: 'the scenario' },
    }))

    expect(bundle.pools.recap).toContain('recap-only')
    expect(bundle.pools.recap).not.toContain('archived')
    expect(bundle.pools.head).toContain('recap-only')
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    // The per-turn list stands down when the recap already lists the shelf.
    expect(mockVault).toHaveBeenCalledTimes(1)
    expect(mockVault).toHaveBeenCalledWith(expect.objectContaining({ query: 'What did Iris tell you at the lighthouse?', precomputedEmbedding: expect.any(Float32Array) }))
  })

  it('embeds only the query and its probes on a retrospective turn, never again downstream', async () => {
    const query = await buildRecallQuery({
      userId: 'user-1',
      text: 'w',
      signals: {
        keywords: ['lighthouse'],
        paraphrase: 'They remember the lighthouse.',
        retrospective: true,
        entities: ['Lighthouse Point'],
        timeRange: { from: new Date(NOW - 9 * 86_400_000).toISOString(), to: new Date(NOW - 86_400_000).toISOString() },
      },
    })
    expect(mockEmbed).toHaveBeenCalledTimes(3)
    const ctx = buildTurnRecallContext({
      chat: { id: 'chat-1' }, recallSettings: { scopePolicy: 'down-weight', expandRelated: false },
      turnContext: null, turnTemporal: null, turnRetrospective: true, nowMs: NOW,
    })
    const { candidates, trace } = await searchRecall(LYRA, query, { limit: 30, minImportance: 0.3, recallContext: ctx })
    mockVault.mockResolvedValue([{ conversationId: 'conv-1', conversationTitle: 'The Lighthouse', relativePath: 'x.md', score: 0.8, firstMessageAt: null, lastMessageAt: null }])

    // The per-turn list is off here; it would already list the conversation.
    const bundle = await assembleRecall(plan({
      preRecall: { query, candidates, trace },
      recallSettings: { scopePolicy: 'down-weight', expandRelated: false, perTurnConversationSummaries: false },
    }))

    expect(mockEmbed).toHaveBeenCalledTimes(3)
    expect(bundle.path).toBe('pre-searched')
    expect(bundle.sections.retrospective).toContain('The Lighthouse')
    expect(bundle.retroSignature).toContain('lighthouse point')
    // The mini-recap asks about the paraphrase and the names (review of PR 95):
    // a text of its own, so the vault search embeds it.
    expect(mockVault).toHaveBeenCalledWith(expect.objectContaining({
      query: 'They remember the lighthouse. — Lighthouse Point',
      precomputedEmbedding: null,
    }))
  })

  it('rides the turn’s vector for a mini-recap that names no one', async () => {
    const query = await buildRecallQuery({
      userId: 'user-1',
      text: 'w',
      signals: { keywords: ['bridge'], paraphrase: 'They remember the bridge.', retrospective: true, entities: [] },
    })
    const { candidates } = await searchRecall(LYRA, query, { limit: 30 })
    await assembleRecall(plan({
      preRecall: { query, candidates },
      recallSettings: { scopePolicy: 'down-weight', expandRelated: false, perTurnConversationSummaries: false },
    }))
    expect(mockVault).toHaveBeenCalledWith(expect.objectContaining({
      query: 'They remember the bridge.',
      precomputedEmbedding: expect.any(Float32Array),
    }))
  })

  it('runs the fallback search when the proactive pass found nothing', async () => {
    const query = await buildRecallQuery({ userId: 'user-1', text: 'nothing matched this' })
    const bundle = await assembleRecall(plan({ preRecall: { query, candidates: [] } }))

    expect(bundle.path).toBe('two-pool')
    expect(bundle.pool.length).toBeGreaterThan(0)
  })

  it('reads the inter-character relevance half past the head’s cut', async () => {
    const query = await buildRecallQuery({ userId: 'user-1', text: 'w' })
    const { candidates, ranked } = await searchRecall(LYRA, query, { limit: 30, minImportance: 0.3 })
    const head = candidates.filter(c => c.memory.id !== 'about-iris').slice(0, 3)

    const bundle = await assembleRecall(plan({ preRecall: { query, candidates: head, ranked } }))

    expect(bundle.pool.map(c => c.memory.id)).not.toContain('about-iris')
    expect(bundle.pools.interCharacter).toContain('about-iris')
  })

  it('writes nothing: no stamp, no ring, until delivery', async () => {
    await assembleRecall(plan())
    expect(repos.memories.updateAccessTimeBulk).not.toHaveBeenCalled()
    expect(repos.chats.update).not.toHaveBeenCalled()
  })
})

describe('deliverRecall', () => {
  it('stamps what reached the model, not a line compression cut', async () => {
    const bundle = await assembleRecall(plan())
    const cut = bundle.lines.head![0]
    // Phase-2 compression dropped the head's first line.
    const delivered = everything(bundle).replace(cut.line, '')

    const delivery = await deliverRecall(bundle, { characterId: LYRA, chat: { id: 'chat-1' }, deliveredText: delivered })

    expect(delivery.lost).toEqual([cut.memoryId])
    const stamped = repos.memories.updateAccessTimeBulk.mock.calls[0][1] as string[]
    expect(stamped).not.toContain(cut.memoryId)
    expect(stamped).toEqual(expect.arrayContaining(['archived', 'digest-b', 'about-iris']))
  })

  it('records the delivered head in the ring, and only the head', async () => {
    const bundle = await assembleRecall(plan())
    const delivery = await deliverRecall(bundle, { characterId: LYRA, chat: { id: 'chat-1' }, deliveredText: everything(bundle) })

    const ring = (repos.chats.update.mock.calls[0][1] as { commonplaceRecallHistory: { turns: string[][] } }).commonplaceRecallHistory
    expect(ring.turns).toEqual([bundle.pools.head])
    expect(delivery.debugLog.find(l => l.startsWith(RECALL_RING_PREFIX))).toBe(`${RECALL_RING_PREFIX} ${bundle.pools.head.join(' ')}`)
    // The stage trace rides in the debug record.
    expect(delivery.debugLog.some(l => l.startsWith('[Recall] query'))).toBe(true)
    expect(delivery.debugLog.some(l => l.startsWith('[Recall] assemble (interCharacter)'))).toBe(true)
  })

  it('does not stamp rows the recap only summarised', async () => {
    // A row the narrative read that no line-rendered pool delivers.
    const narrated = mem('narrated', 0, { summary: 'only the narrative mentions this' })
    repos.memories.findRecentByImportanceTier.mockResolvedValueOnce({ high: [recapOnly, narrated], medium: [], low: [] })
    const bundle = await assembleRecall(plan({ recap: { selection: {} as never, fallbackQuery: '' }, recallSettings: { scopePolicy: 'down-weight', expandRelated: false, perTurnConversationSummaries: false } }))
    await deliverRecall(bundle, { characterId: LYRA, chat: { id: 'chat-1' }, deliveredText: everything(bundle) })

    const recapLeftOut = bundle.pools.recap.filter(id => !bundle.pools.head.includes(id) && !bundle.pools.archive.includes(id))
    const stamped = repos.memories.updateAccessTimeBulk.mock.calls[0][1] as string[]
    expect(recapLeftOut).toEqual(['narrated'])
    expect(stamped).not.toContain('narrated')
    // What the head delivered verbatim is stamped, recap row or not.
    expect(stamped).toContain('recap-only')
  })

  it('counts the mini-recap delivered though the whisper builder trimmed it', async () => {
    const bundle = emptyRecallBundle()
    bundle.sections.retrospective = '### Relevant Past Conversations\n\n#### The Lighthouse (`conv-1`)\n'
    bundle.retroSignature = 'sig'
    await deliverRecall(bundle, { characterId: LYRA, chat: { id: 'chat-1' }, deliveredText: `before\n\n${bundle.sections.retrospective.trim()}\n\nafter` })

    const ring = (repos.chats.update.mock.calls[0][1] as { commonplaceRecallHistory: { retroSignatures: string[] } }).commonplaceRecallHistory
    expect(ring.retroSignatures).toEqual(['sig'])
  })

  it('stamps nothing when nothing was delivered', async () => {
    const bundle = await assembleRecall(plan())
    const delivery = await deliverRecall(bundle, { characterId: LYRA, chat: { id: 'chat-1' }, deliveredText: '' })

    expect(repos.memories.updateAccessTimeBulk).not.toHaveBeenCalled()
    expect(repos.chats.update).not.toHaveBeenCalled()
    expect(delivery.debugLog).toContain(`${RECALL_RING_PREFIX}`)
  })
})

describe('assembleRecall — the archive holds still on a retrospective turn', () => {
  it('renders byte-identical archive lines whether or not the turn reaches back', async () => {
    const ordinary = await assembleRecall(plan())
    const query = await buildRecallQuery({ userId: 'user-1', text: 'w', signals: { keywords: ['x'], paraphrase: 'Remember the bridge?', retrospective: true } })
    const retro = await assembleRecall(plan({ preRecall: { query, candidates: [] } }))

    expect(retro.lines.archive).toEqual(ordinary.lines.archive)
  })
})
