/**
 * Recall replay harness.
 *
 * This is the instrument the episodic-recall constants get tuned against, so
 * it is only useful while it faithfully reproduces the live path. The
 * load-bearing claims: the replayed turn resolves against ITS OWN clock rather
 * than wall-clock now (replaying a June turn must not date "last week" from
 * today), the old path runs with the episodic signals genuinely inert, and the
 * new path's head size widens only for a retrospective turn.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractMemorySearchKeywords: jest.fn(),
  stripToolArtifacts: jest.fn((s: string) => s),
}))

jest.mock('@/lib/memory/recall/search', () => ({
  searchRecall: jest.fn(),
}))

jest.mock('@/lib/memory/recall/assemble', () => ({
  ...jest.requireActual('@/lib/memory/recall/assemble'),
  assembleRecall: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}))

jest.mock('@/lib/instance-settings', () => ({
  getMemoryRecallSettings: jest.fn(),
}))

import { runRecallReplay } from '@/lib/memory/recall/replay'
import { getRepositories } from '@/lib/repositories/factory'
import { extractMemorySearchKeywords } from '@/lib/memory/cheap-llm-tasks'
import { searchRecall } from '@/lib/memory/recall/search'
import { assembleRecall } from '@/lib/memory/recall/assemble'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { DYNAMIC_HEAD_DEFAULT_SIZE, RETRO_HEAD_SIZE } from '@/lib/memory/recall/assemble'

const mockRepos = getRepositories as jest.Mock
const mockDistill = extractMemorySearchKeywords as jest.Mock
const mockSearch = searchRecall as jest.Mock
const mockAssemble = assembleRecall as jest.Mock
const mockEmbed = generateEmbeddingForUser as jest.Mock
/** A search result as the stages return it. */
const found = (rows: unknown[]) => ({ candidates: rows, strategy: 'vector', trace: [] })
/** The query a search call was handed. */
const queryOf = (n: number) => mockSearch.mock.calls[n][1] as AnyRecord
const mockRecallSettings = getMemoryRecallSettings as jest.Mock

type AnyRecord = Record<string, unknown>

const cheapLLM = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' } as never

function message(id: string, role: 'USER' | 'ASSISTANT', content: string, createdAt: string) {
  return { id, type: 'message', role, content, createdAt, systemSender: null }
}

/** Two interchanges, a month apart, so the historical clock is observable. */
const DEFAULT_MESSAGES = [
  message('m1', 'USER', 'What did we do at the fair?', '2026-06-10T12:00:00.000Z'),
  message('m2', 'ASSISTANT', 'We rode the wheel.', '2026-06-10T12:01:00.000Z'),
  message('m3', 'USER', 'And the cellar?', '2026-07-20T09:00:00.000Z'),
  message('m4', 'ASSISTANT', 'Dusty, as ever.', '2026-07-20T09:01:00.000Z'),
]

function hit(id: string, over: AnyRecord = {}) {
  return {
    memory: {
      id,
      summary: `summary ${id}`,
      kind: 'semantic',
      occurredAt: null,
      narrativeTime: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      keywords: ['k'],
    },
    score: 0.5,
    salience: 0.4,
    recallAdjustment: null,
    ...over,
  }
}

function primeRepos(
  over: { chat?: AnyRecord | null; character?: AnyRecord | null; messages?: unknown[]; recentMemories?: AnyRecord[] } = {},
) {
  const chat =
    over.chat === undefined
      ? {
          id: 'chat-1',
          projectId: 'proj-1',
          chatType: 'salon',
          timelineMode: 'realtime',
          commonplaceRecallHistory: null,
          participants: [
            { id: 'p-user', characterId: null, controlledBy: 'user', status: 'active' },
            { id: 'p-ai', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
          ],
        }
      : over.chat

  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => over.messages ?? DEFAULT_MESSAGES),
    },
    characters: {
      // Echo the requested id so "which participant did it pick?" is observable.
      findByIdRaw: jest.fn(async (id: string) =>
        over.character === undefined ? { id, name: `Name-${id}` } : over.character
      ),
    },
    memories: {
      countCreatedSince: jest.fn(async () => (over.recentMemories ?? []).length),
      findRecent: jest.fn(async () => over.recentMemories ?? []),
    },
  })
  return chat
}

function baseInput(over: AnyRecord = {}) {
  return { chatId: 'chat-1', userId: 'u1', cheapLLM, ...over } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockRecallSettings.mockResolvedValue({ scopePolicy: 'chat', expandRelated: true })
  mockDistill.mockResolvedValue({
    success: true,
    result: { paraphrase: 'the cellar', keywords: ['cellar'], retrospective: false, entities: [] },
  })
  mockSearch.mockResolvedValue(found([hit('mem-1'), hit('mem-2')]))
  mockAssemble.mockResolvedValue({ trace: [{ stage: 'assemble', label: 'head', detail: { rendered: 2 } }], pools: { archive: [], head: ['mem-1'], interCharacter: [], recap: [] } })
  mockEmbed.mockImplementation(async (text: string) => ({ embedding: new Float32Array([text.length, 1]), provider: 'OPENAI', model: 'm', dimensions: 2 }))
})

describe('runRecallReplay — resolution and guards', () => {
  it('throws when the chat is missing', async () => {
    primeRepos({ chat: null })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Chat not found')
  })

  it('throws when no LLM-controlled character participates', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [{ id: 'p-user', characterId: null, controlledBy: 'user', status: 'active' }],
      },
    })

    await expect(runRecallReplay(baseInput())).rejects.toThrow(/No LLM-controlled character/)
  })

  it('skips a removed participant when auto-selecting the character', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-gone', characterId: 'char-gone', controlledBy: 'llm', status: 'removed' },
          { id: 'p-ai', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
        ],
      },
    })

    const result = await runRecallReplay(baseInput())

    expect(result.characterId).toBe('char-1')
  })

  it('throws when the chat has no turns', async () => {
    primeRepos({ messages: [] })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Chat has no turns to replay')
  })

  it('throws when the character row is gone', async () => {
    primeRepos({ character: null })

    await expect(runRecallReplay(baseInput())).rejects.toThrow('Character record not found')
  })

  it('throws when no query can be derived', async () => {
    mockDistill.mockResolvedValue({ success: true, result: { paraphrase: '', keywords: [] } })
    primeRepos({
      messages: [message('m1', 'USER', '   ', '2026-07-20T09:00:00.000Z')],
    })

    await expect(runRecallReplay(baseInput())).rejects.toThrow(/Could not derive a recall query/)
  })
})

describe('runRecallReplay — the historical clock', () => {
  it('dates the distillation from the replayed turn, not from now', async () => {
    await runRecallReplay(baseInput({ turnIndex: 1 }))

    const [, , , , , , opts] = mockDistill.mock.calls[0]
    // Turn 1 ends in June; replaying it must resolve "last week" against June.
    expect((opts as AnyRecord).nowIso).toBe('2026-06-10T12:01:00.000Z')
  })

  it('passes that same clock to the searches as nowMs', async () => {
    await runRecallReplay(baseInput({ turnIndex: 1 }))

    const [, , options] = mockSearch.mock.calls[0]
    expect((options as AnyRecord).recallContext).toMatchObject({
      nowMs: Date.parse('2026-06-10T12:01:00.000Z'),
      currentChatId: 'chat-1',
      currentProjectId: 'proj-1',
    })
  })

  it('defaults to the last turn and reports the total', async () => {
    const result = await runRecallReplay(baseInput())

    expect(result.totalTurns).toBe(2)
    expect(result.turnIndex).toBe(2)
    expect(result.clockIso).toBe('2026-07-20T09:01:00.000Z')
  })

  it.each([
    [0, 1],
    [-5, 1],
    [99, 2],
  ])('clamps a turnIndex of %i to %i', async (requested, expected) => {
    const result = await runRecallReplay(baseInput({ turnIndex: requested }))

    expect(result.turnIndex).toBe(expected)
  })
})

describe('runRecallReplay — the two paths', () => {
  it('runs the old path with every episodic signal inert', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the fair',
        keywords: ['fair'],
        retrospective: true,
        entities: ['Wheel'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    const [, , oldOptions] = mockSearch.mock.calls[0]
    expect(queryOf(0)).toMatchObject({ anchors: [], window: null, probes: [] })
    expect((oldOptions as AnyRecord).recallContext).not.toHaveProperty('turnRetrospective')
  })

  it('gives the new path the retrospective flip, window, anchors and probes', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the fair',
        keywords: ['fair'],
        retrospective: true,
        entities: ['Wheel', 'Cellar'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect(queryOf(1)).toMatchObject({
      anchors: ['Wheel', 'Cellar'],
      window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
    })
    expect((newOptions as AnyRecord).recallContext).toMatchObject({ turnRetrospective: true })
    expect((queryOf(1).probes as AnyRecord[]).map(p => p.text)).toEqual([
      'Wheel Cellar',
      'the fair (around 2026-06-01 to 2026-06-30)',
    ])
  })

  it('raises no extra probes on a non-retrospective turn', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: {
        paraphrase: 'the cellar',
        keywords: ['cellar'],
        retrospective: false,
        entities: ['Cellar'],
        timeRange: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
      },
    })

    await runRecallReplay(baseInput())

    expect(queryOf(1).probes).toEqual([])
    // The window is ungated from the flag, matching the live consumers.
    expect(queryOf(1).window).toEqual({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    })
  })

  it('widens the new path head only when the turn is retrospective', async () => {
    const rows = Array.from({ length: RETRO_HEAD_SIZE + 4 }, (_, i) => hit(`m${i}`))
    mockSearch.mockResolvedValue(found(rows))

    const plain = await runRecallReplay(baseInput())
    expect(plain.newPath.filter((r) => r.selected)).toHaveLength(DYNAMIC_HEAD_DEFAULT_SIZE)

    mockDistill.mockResolvedValue({
      success: true,
      result: { paraphrase: 'the fair', keywords: ['fair'], retrospective: true, entities: [] },
    })
    const retro = await runRecallReplay(baseInput())
    expect(retro.newPath.filter((r) => r.selected)).toHaveLength(RETRO_HEAD_SIZE)
    // The old path never widens — that is what makes the comparison meaningful.
    expect(retro.oldPath.filter((r) => r.selected)).toHaveLength(DYNAMIC_HEAD_DEFAULT_SIZE)
  })
})

describe('runRecallReplay — query derivation and rows', () => {
  it('prefers the paraphrase, then the keywords, then the last message', async () => {
    mockDistill.mockResolvedValue({ success: true, result: { paraphrase: 'the cellar' } })
    expect((await runRecallReplay(baseInput())).query).toBe('the cellar')

    mockDistill.mockResolvedValue({
      success: true,
      result: { paraphrase: '', keywords: ['dust', 'stairs'] },
    })
    expect((await runRecallReplay(baseInput())).query).toBe('dust stairs')

    mockDistill.mockResolvedValue({ success: false, error: 'model down' })
    expect((await runRecallReplay(baseInput())).query).toBe('Dusty, as ever.')
  })

  it('reports null signals when distillation fails, without throwing', async () => {
    mockDistill.mockResolvedValue({ success: false, error: 'model down' })

    const result = await runRecallReplay(baseInput())

    expect(result.signals).toBeNull()
    expect(result.oldPath).toHaveLength(2)
    expect(result.newPath).toHaveLength(2)
  })

  it('flattens a candidate row, including a null recallAdjustment', async () => {
    mockSearch.mockResolvedValue(found([
      hit('mem-1', {
        score: 0.81,
        salience: 0.62,
        recallAdjustment: {
          blendedBefore: 0.5,
          multiplier: 1.4,
          fired: ['retrospective'],
          blendedAfter: 0.7,
        },
      }),
      hit('mem-2', { salience: undefined, recallAdjustment: null }),
    ]))

    const { newPath } = await runRecallReplay(baseInput())

    expect(newPath[0]).toMatchObject({
      memoryId: 'mem-1',
      cosine: 0.81,
      salience: 0.62,
      blendedBefore: 0.5,
      multiplier: 1.4,
      fired: ['retrospective'],
      blendedAfter: 0.7,
      selected: true,
    })
    expect(newPath[1]).toMatchObject({
      salience: null,
      blendedBefore: null,
      multiplier: null,
      fired: [],
      blendedAfter: null,
    })
  })

  it('honours an explicit characterId and limit', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', characterId: 'char-1', controlledBy: 'llm', status: 'active' },
          { id: 'p-b', characterId: 'char-2', controlledBy: 'llm', status: 'active' },
        ],
      },
    })

    const result = await runRecallReplay(baseInput({ characterId: 'char-2', limit: 5 }))

    // The named character wins over the first LLM participant in the list.
    expect(result.characterId).toBe('char-2')
    expect(result.characterName).toBe('Name-char-2')

    const [characterArg, , options] = mockSearch.mock.calls[0]
    expect(characterArg).toBe('char-2')
    expect((options as AnyRecord).limit).toBe(5)
  })

  it('defaults the candidate table to 25 rows per path', async () => {
    await runRecallReplay(baseInput())

    expect((mockSearch.mock.calls[0][2] as AnyRecord).limit).toBe(25)
    expect((mockSearch.mock.calls[1][2] as AnyRecord).limit).toBe(25)
  })

  it('widens the default table past a retrospective head', async () => {
    mockDistill.mockResolvedValue({
      success: true,
      result: { paraphrase: 'the fair', keywords: ['fair'], retrospective: true, entities: [] },
    })

    // A budget-sized retrospective head (30) outgrows the old default of 25.
    const result = await runRecallReplay(baseInput({ memoryBudget: 8000 }))

    expect(result.newHeadSize).toBe(30)
    expect((mockSearch.mock.calls[1][2] as AnyRecord).limit).toBe(40)
  })

  it('excludes staff messages and events from the replay window', async () => {
    primeRepos({
      messages: [
        message('m1', 'USER', 'A question.', '2026-07-20T09:00:00.000Z'),
        { ...message('m2', 'ASSISTANT', 'A whisper.', '2026-07-20T09:00:30.000Z'), systemSender: 'commonplaceBook' },
        { id: 'e1', type: 'event', createdAt: '2026-07-20T09:00:45.000Z' },
        message('m3', 'ASSISTANT', 'A reply.', '2026-07-20T09:01:00.000Z'),
      ],
    })
    mockDistill.mockResolvedValue({ success: false, error: 'no model' })

    const result = await runRecallReplay(baseInput())

    // Falls through to the last *eligible* message, not the whisper or event.
    expect(result.query).toBe('A reply.')
    const [distilled] = mockDistill.mock.calls[0]
    expect((distilled as AnyRecord[]).map((m) => m.content)).toEqual(['A question.', 'A reply.'])
  })
})

describe('runRecallReplay — harness knobs (R7)', () => {
  const pinned = { paraphrase: 'the pinned fair', keywords: ['fair'], retrospective: false, entities: ['Wheel'] }

  it('reuses pinned signals without calling the cheap LLM', async () => {
    const result = await runRecallReplay(baseInput({ signals: pinned }))

    expect(mockDistill).not.toHaveBeenCalled()
    expect(result.query).toBe('the pinned fair')
    expect(result.signalsPinned).toBe(true)
    expect(result.signals).toEqual(pinned)
  })

  it('applies tuning to the new path only', async () => {
    const result = await runRecallReplay(baseInput({ tuning: { boostCap: 1.6 } }))

    const [, , oldOptions] = mockSearch.mock.calls[0]
    const [, , newOptions] = mockSearch.mock.calls[1]
    expect((oldOptions as AnyRecord).recallContext).not.toHaveProperty('tuning')
    expect(((newOptions as AnyRecord).recallContext as AnyRecord).tuning).toMatchObject({ boostCap: 1.6 })
    expect(result.tuning).toBe('cap=1.6')
  })

  it('leaves the context untouched with no tuning, and says so', async () => {
    const result = await runRecallReplay(baseInput())

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect((newOptions as AnyRecord).recallContext).not.toHaveProperty('tuning')
    expect((newOptions as AnyRecord).excludeIds).toBeUndefined()
    expect((newOptions as AnyRecord).nowMs).toBeUndefined()
    expect(result).toMatchObject({ tuning: 'defaults', signalsPinned: false, asOf: null, excludedAfterAsOf: 0 })
  })

  it('gives R4 the names of the characters in the room', async () => {
    await runRecallReplay(baseInput({ tuning: { specificAnchors: true } }))

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect(((newOptions as AnyRecord).recallContext as AnyRecord).presentParticipantNames).toEqual(['Name-char-1'])
  })

  it('under asOf, leaves out memories created at or after the turn opened, on both paths', async () => {
    primeRepos({
      recentMemories: [
        { id: 'during', createdAt: '2026-06-10T12:00:30.000Z' },
        { id: 'at', createdAt: '2026-06-10T12:00:00.000Z' },
        { id: 'before', createdAt: '2026-06-10T11:59:59.000Z' },
      ],
    })

    const result = await runRecallReplay(baseInput({ turnIndex: 1, asOf: true }))

    for (const call of mockSearch.mock.calls) {
      const options = call[2] as AnyRecord
      expect([...(options.excludeIds as Set<string>)].sort()).toEqual(['at', 'during'])
      // Salience decays against the replayed turn's clock, not today's.
      expect(options.nowMs).toBe(Date.parse('2026-06-10T12:01:00.000Z'))
    }
    expect(result.asOf).toBe('2026-06-10T12:00:00.000Z')
    expect(result.excludedAfterAsOf).toBe(2)
  })

  it('hands the new path its head size for R6', async () => {
    await runRecallReplay(baseInput({ memoryBudget: 8000 }))

    const [, , newOptions] = mockSearch.mock.calls[1]
    expect((newOptions as AnyRecord).headSize).toBe(15)
  })

  it('embeds the query once, for both paths and across runs', async () => {
    // A text no other case embeds: the memo lives for the server process.
    const signals = { paraphrase: 'a question asked only here', keywords: ['only'], entities: [] }
    await runRecallReplay(baseInput({ signals }))
    await runRecallReplay(baseInput({ signals }))

    // One query, embedded once, reused by every path of both runs.
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(queryOf(0).embedding).toBe(queryOf(1).embedding)
  })

  it('reports the stage trace, the fallback path and the pools of the turn’s assemble', async () => {
    const result = await runRecallReplay(baseInput())

    // Old, new, then the text fallback with the same question.
    expect(mockSearch).toHaveBeenCalledTimes(3)
    expect(mockSearch.mock.calls[2][2]).toMatchObject({ forceText: true })
    expect(result.fallbackPath.map(r => r.memoryId)).toEqual(['mem-1', 'mem-2'])
    // assemble ran over the live pool, writing nothing, its archive uncached.
    const plan = mockAssemble.mock.calls[0][0] as AnyRecord
    expect((plan.preRecall as AnyRecord).candidates).toHaveLength(2)
    expect(plan.recap).toBeUndefined()
    expect(plan.conversations).toBeUndefined()
    expect((plan.replay as AnyRecord).excludeIds).toBeInstanceOf(Set)
    expect(result.pools.head).toEqual(['mem-1'])
    expect(result.trace.map(t => t.stage)).toEqual(['query', 'assemble'])
  })

  it('ranks under the ring as it stood at the turn, read from the recall records', async () => {
    const recallLog = (ids: string) => ['[Recall] deliver: head 1', `[Recall:ring] ${ids}`]
    primeRepos({
      messages: [
        message('m1', 'USER', 'First.', '2026-07-20T09:00:00.000Z'),
        { ...message('m2', 'ASSISTANT', 'One.', '2026-07-20T09:01:00.000Z'), debugMemoryLogs: recallLog('old-a') },
        message('m3', 'USER', 'Second.', '2026-07-20T09:02:00.000Z'),
        { ...message('m4', 'ASSISTANT', 'Two.', '2026-07-20T09:03:00.000Z'), debugMemoryLogs: recallLog('old-b old-c') },
        message('m5', 'USER', 'Third.', '2026-07-20T09:04:00.000Z'),
        // Written AFTER the replayed turn opened: not part of its ring.
        { ...message('m6', 'ASSISTANT', 'Three.', '2026-07-20T09:05:00.000Z'), debugMemoryLogs: recallLog('later') },
      ],
    })

    const result = await runRecallReplay(baseInput())

    expect(result.ringSource).toBe('debug-log')
    expect(result.ring.sort()).toEqual(['old-a', 'old-b', 'old-c'])
    const ctx = (mockSearch.mock.calls[1][2] as AnyRecord).recallContext as AnyRecord
    expect([...(ctx.recentlyWhisperedIds as Set<string>)].sort()).toEqual(['old-a', 'old-b', 'old-c'])
  })

  it("falls back to the chat's current ring when the chat predates recall records", async () => {
    const result = await runRecallReplay(baseInput())
    expect(result.ringSource).toBe('chat')
  })

})
