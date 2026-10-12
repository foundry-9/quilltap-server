/**
 * Fold-time episode pass.
 *
 * This pass rides the fold cadence, so its first duty is to never damage the
 * fold: every failure path — no chat, no participants, a dead extractor, a
 * per-character write that throws — must return a result rather than throw.
 * Its second duty is the fragment linking, which is union-preserving on both
 * sides; a clobbering write here would quietly sever links the gate had
 * already made.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractEpisodesFromFold: jest.fn(),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  createMemoryWithGate: jest.fn(),
}))

jest.mock('@/lib/memory/episodic', () => ({
  resolveWhenPhrase: jest.fn(() => null),
}))

import { runFoldEpisodePass } from '@/lib/memory/fold-episode-pass'
import { getRepositories } from '@/lib/repositories/factory'
import { extractEpisodesFromFold } from '@/lib/memory/cheap-llm-tasks'
import { createMemoryWithGate } from '@/lib/memory/memory-service'
import { resolveWhenPhrase } from '@/lib/memory/episodic'

const mockRepos = getRepositories as jest.Mock
const mockExtract = extractEpisodesFromFold as jest.Mock
const mockGate = createMemoryWithGate as jest.Mock
const mockResolveWhen = resolveWhenPhrase as jest.Mock

type AnyRecord = Record<string, unknown>

const cheapLLM = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' } as never

function message(id: string, over: AnyRecord = {}) {
  return {
    id,
    type: 'message',
    role: 'USER',
    content: `content ${id}`,
    createdAt: '2026-07-20T09:00:00.000Z',
    participantId: 'p-user',
    ...over,
  } as never
}

const WINDOW = [
  message('m1', { participantId: 'p-user', createdAt: '2026-07-20T09:00:00.000Z' }),
  message('m2', {
    role: 'ASSISTANT',
    participantId: 'p-ai',
    createdAt: '2026-07-20T09:05:00.000Z',
  }),
]

function episode(over: AnyRecord = {}) {
  return {
    summary: 'The cellar expedition',
    narrative: 'They went down and found the crates.',
    entities: ['Cellar', 'Crates'],
    importance: 0.7,
    when: null,
    narrativeTime: null,
    ...over,
  }
}

let updateForCharacter: jest.Mock
let addRelatedMemoryIds: jest.Mock
let findFragments: jest.Mock
let chatUpdate: jest.Mock
let chatMessages: unknown[]

function primeRepos(over: { chat?: AnyRecord | null } = {}) {
  updateForCharacter = jest.fn(async () => undefined)
  addRelatedMemoryIds = jest.fn(async () => undefined)
  findFragments = jest.fn(async () => [])
  chatUpdate = jest.fn(async () => ({}))
  chatMessages = WINDOW

  const chat =
    over.chat === undefined
      ? {
          id: 'chat-1',
          participants: [
            { id: 'p-user', type: 'USER', status: 'active', characterId: null },
            { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1' },
          ],
        }
      : over.chat

  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => chatMessages),
      update: chatUpdate,
    },
    characters: { findByIdRaw: jest.fn(async (id: string) => ({ id, name: `Name-${id}` })) },
    memories: {
      findByCharacterAndSourceMessageIds: findFragments,
      updateForCharacter,
      addRelatedMemoryIds,
    },
  })
}

function input(over: AnyRecord = {}) {
  return {
    chatId: 'chat-1',
    userId: 'u1',
    windowMessages: WINDOW,
    cheapLLM,
    timelineMode: 'realtime',
    projectId: 'proj-1',
    inAutonomousRoom: false,
    ...over,
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockResolveWhen.mockReturnValue(null)
  mockExtract.mockResolvedValue({ success: true, result: [episode()] })
  mockGate.mockResolvedValue({
    action: 'INSERT',
    memory: { id: 'mem-ep', relatedMemoryIds: [] },
  })
})

describe('runFoldEpisodePass — bail-outs never throw', () => {
  it('returns an empty result for an empty window without calling anything', async () => {
    const result = await runFoldEpisodePass(input({ windowMessages: [] }))

    expect(result).toMatchObject({ episodesExtracted: 0, memoriesWritten: 0, fragmentsLinked: 0 })
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('returns an empty result when the chat is gone', async () => {
    primeRepos({ chat: null })

    await expect(runFoldEpisodePass(input())).resolves.toMatchObject({
      episodesExtracted: 0,
      memoriesWritten: 0,
      fragmentsLinked: 0,
    })
  })

  it('returns an empty result when no character participant is present', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-user', type: 'USER', status: 'active', characterId: null },
          { id: 'p-gone', type: 'CHARACTER', status: 'removed', characterId: 'char-9' },
        ],
      },
    })

    const result = await runFoldEpisodePass(input())

    expect(result.episodesExtracted).toBe(0)
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('swallows an extractor failure', async () => {
    mockExtract.mockResolvedValue({ success: false, error: 'model down' })

    await expect(runFoldEpisodePass(input())).resolves.toMatchObject({ episodesExtracted: 0 })
  })

  it('swallows an extractor that succeeds with nothing to say', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [] })

    const result = await runFoldEpisodePass(input())

    expect(result.episodesExtracted).toBe(0)
    expect(mockGate).not.toHaveBeenCalled()
  })

  it('swallows an outright throw from the repositories', async () => {
    mockRepos.mockImplementation(() => {
      throw new Error('database on fire')
    })

    await expect(runFoldEpisodePass(input())).resolves.toMatchObject({
      episodesExtracted: 0,
      memoriesWritten: 0,
      fragmentsLinked: 0,
    })
  })

  it('isolates a per-character write failure from the other characters', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', type: 'CHARACTER', status: 'active', characterId: 'char-a' },
          { id: 'p-b', type: 'CHARACTER', status: 'active', characterId: 'char-b' },
        ],
      },
    })
    mockGate.mockImplementation(async (payload: AnyRecord) => {
      if (payload.characterId === 'char-a') throw new Error('gate exploded')
      return { action: 'INSERT', memory: { id: 'mem-b', relatedMemoryIds: [] } }
    })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(1)
    expect(mockGate).toHaveBeenCalledTimes(2)
  })
})

describe('runFoldEpisodePass — the episode memory', () => {
  it('writes one episodic memory per present character', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        participants: [
          { id: 'p-a', type: 'CHARACTER', status: 'active', characterId: 'char-a' },
          { id: 'p-b', type: 'CHARACTER', status: 'active', characterId: 'char-b' },
        ],
      },
    })

    const result = await runFoldEpisodePass(input())

    expect(result).toMatchObject({ episodesExtracted: 1, memoriesWritten: 2 })
    expect(mockGate.mock.calls.map((c) => (c[0] as AnyRecord).characterId)).toEqual([
      'char-a',
      'char-b',
    ])
  })

  it('tags the memory as episodic with the retrieval keywords the recall path expects', async () => {
    await runFoldEpisodePass(input())

    const [payload] = mockGate.mock.calls[0]
    expect(payload).toMatchObject({
      kind: 'episodic',
      source: 'AUTO',
      summary: 'The cellar expedition',
      content: 'They went down and found the crates.',
      importance: 0.7,
      entities: ['Cellar', 'Crates'],
      projectId: 'proj-1',
      witnessedContext: 'user_present',
    })
    // Entities are lower-cased into keywords, then the three fixed markers.
    expect((payload as AnyRecord).keywords).toEqual([
      'cellar',
      'crates',
      'past',
      'scope: narrow',
      'history',
    ])
  })

  it('marks an autonomous-room fold as such', async () => {
    await runFoldEpisodePass(input({ inAutonomousRoom: true }))

    expect((mockGate.mock.calls[0][0] as AnyRecord).witnessedContext).toBe('autonomous_room')
  })

  it('anchors the clock to the newest stamped message, not to now', async () => {
    await runFoldEpisodePass(input())

    const [, clock] = mockExtract.mock.calls[0]
    // The memory-calendar zone is resolved before the prompt and rides on the clock.
    expect(clock).toEqual({ nowIso: '2026-07-20T09:05:00.000Z', timelineMode: 'realtime', timeZone: expect.any(String) })
  })

  it('dates the episode from the window start when the when-phrase does not resolve', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [episode({ when: 'last Tuesday' })] })
    mockResolveWhen.mockReturnValue(null)

    await runFoldEpisodePass(input())

    expect((mockGate.mock.calls[0][0] as AnyRecord).occurredAt).toBe('2026-07-20T09:00:00.000Z')
  })

  it('prefers a resolved when-phrase over the window start', async () => {
    mockExtract.mockResolvedValue({ success: true, result: [episode({ when: 'last Tuesday' })] })
    mockResolveWhen.mockReturnValue('2026-07-14T00:00:00.000Z')

    await runFoldEpisodePass(input())

    // Resolved in the same zone the extractor's clock was rendered in.
    const [, clock] = mockExtract.mock.calls[0] as [unknown, { timeZone: string }]
    expect(mockResolveWhen).toHaveBeenCalledWith('last Tuesday', '2026-07-20T09:05:00.000Z', clock.timeZone)
    expect((mockGate.mock.calls[0][0] as AnyRecord).occurredAt).toBe('2026-07-14T00:00:00.000Z')
  })

  it('falls back to the when-phrase for narrativeTime only in narrative mode', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      result: [episode({ when: 'the second evening', narrativeTime: null })],
    })

    await runFoldEpisodePass(input({ timelineMode: 'narrative' }))
    expect((mockGate.mock.calls[0][0] as AnyRecord).narrativeTime).toBe('the second evening')

    jest.clearAllMocks()
    primeRepos()
    mockExtract.mockResolvedValue({
      success: true,
      result: [episode({ when: 'the second evening', narrativeTime: null })],
    })
    mockGate.mockResolvedValue({ action: 'INSERT', memory: { id: 'm', relatedMemoryIds: [] } })

    await runFoldEpisodePass(input({ timelineMode: 'realtime' }))
    expect((mockGate.mock.calls[0][0] as AnyRecord).narrativeTime).toBeNull()
  })

  it('renders each message under its speaker name, falling back to a role label', async () => {
    await runFoldEpisodePass(input())

    const [rendered] = mockExtract.mock.calls[0]
    expect(rendered).toEqual([
      { speaker: 'User', content: 'content m1', createdAt: '2026-07-20T09:00:00.000Z' },
      { speaker: 'Name-char-1', content: 'content m2', createdAt: '2026-07-20T09:05:00.000Z' },
    ])
  })

  it.each([
    ['INSERT', 1],
    ['INSERT_RELATED', 1],
    ['SKIP_GATE', 1],
    ['MERGE', 0],
    ['SKIP_DUPLICATE', 0],
  ])('counts a %s gate outcome as %i written', async (action, expected) => {
    mockGate.mockResolvedValue({ action, memory: { id: 'mem-ep', relatedMemoryIds: [] } })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(expected)
  })

  it('skips linking when the gate returns no memory at all', async () => {
    mockGate.mockResolvedValue({ action: 'SKIP_DUPLICATE', memory: null })

    const result = await runFoldEpisodePass(input())

    expect(result.memoriesWritten).toBe(0)
    expect(findFragments).not.toHaveBeenCalled()
  })
})

describe('runFoldEpisodePass — fragment linking', () => {
  it('links the window fragments both ways without clobbering existing links', async () => {
    mockGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-ep', relatedMemoryIds: ['pre-existing'] },
    })
    findFragments.mockResolvedValue([
      { id: 'frag-1', relatedMemoryIds: ['other'] },
      { id: 'frag-2', relatedMemoryIds: [] },
    ])

    const result = await runFoldEpisodePass(input())

    expect(findFragments).toHaveBeenCalledWith('char-1', ['m1', 'm2'])
    // Links are deltas against the rows at commit (bug 231): the episode
    // gains both fragments, each fragment gains the episode, and no whole
    // list is ever written, so prior links survive however they changed.
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'mem-ep', ['frag-1', 'frag-2'])
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'frag-1', ['mem-ep'])
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'frag-2', ['mem-ep'])
    expect(updateForCharacter).not.toHaveBeenCalled()
    expect(result.fragmentsLinked).toBe(2)
  })

  it('never links an episode to itself', async () => {
    findFragments.mockResolvedValue([{ id: 'mem-ep', relatedMemoryIds: [] }])

    const result = await runFoldEpisodePass(input())

    expect(result.fragmentsLinked).toBe(0)
    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
  })

  it('skips the episode-side write when every fragment is already linked', async () => {
    mockGate.mockResolvedValue({
      action: 'INSERT',
      memory: { id: 'mem-ep', relatedMemoryIds: ['frag-1'] },
    })
    findFragments.mockResolvedValue([{ id: 'frag-1', relatedMemoryIds: ['mem-ep'] }])

    const result = await runFoldEpisodePass(input())

    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
    expect(result.fragmentsLinked).toBe(0)
  })

  it('caps fragment links at eight per episode', async () => {
    findFragments.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ id: `frag-${i}`, relatedMemoryIds: [] }))
    )

    const result = await runFoldEpisodePass(input())

    const episodeWrite = addRelatedMemoryIds.mock.calls.find((c) => c[1] === 'mem-ep')
    expect(episodeWrite![2] as string[]).toHaveLength(8)
    expect(result.fragmentsLinked).toBe(8)
  })

  it('does nothing further when the window produced no fragments', async () => {
    findFragments.mockResolvedValue([])

    const result = await runFoldEpisodePass(input())

    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
    expect(result.fragmentsLinked).toBe(0)
  })
})

describe('runFoldEpisodePass — watermark and slices (bug 207)', () => {
  const seat = (i: number) => (i % 2 === 0 ? 'p-user' : 'p-ai')
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      message(`h${i + 1}`, {
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        participantId: seat(i),
        createdAt: new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString(),
      }),
    )

  it('advances the watermark to the end of the window it read', async () => {
    const result = await runFoldEpisodePass(input())

    expect(result.watermarkAdvancedTo).toBe('m2')
    expect(chatUpdate).toHaveBeenCalledWith('chat-1', { episodeExtractionWatermarkMessageId: 'm2' })
  })

  it('reads only what lies past the watermark on a hard-rebuild window', async () => {
    const all = history(10)
    chatMessages = all
    primeRepos({
      chat: {
        id: 'chat-1',
        episodeExtractionWatermarkMessageId: 'h6',
        participants: [
          { id: 'p-user', type: 'USER', status: 'active', characterId: null },
          { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1' },
        ],
      },
    })
    chatMessages = all

    await runFoldEpisodePass(input({ windowMessages: all }))

    expect(mockExtract).toHaveBeenCalledTimes(1)
    const [rendered] = mockExtract.mock.calls[0]
    expect((rendered as Array<{ content: string }>).map((m) => m.content)).toEqual([
      'content h7',
      'content h8',
      'content h9',
      'content h10',
    ])
    expect(chatUpdate).toHaveBeenCalledWith('chat-1', { episodeExtractionWatermarkMessageId: 'h10' })
  })

  it('does nothing for a window wholly behind the watermark', async () => {
    primeRepos({
      chat: {
        id: 'chat-1',
        episodeExtractionWatermarkMessageId: 'm2',
        participants: [{ id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1' }],
      },
    })

    const result = await runFoldEpisodePass(input())

    expect(result.skippedReason).toBe('behind-watermark')
    expect(mockExtract).not.toHaveBeenCalled()
    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it('drops empty and seatless messages before rendering', async () => {
    await runFoldEpisodePass(
      input({
        windowMessages: [
          ...WINDOW,
          message('m3', { content: '   ' }),
          message('m4', { participantId: null }),
        ],
      }),
    )

    const [rendered] = mockExtract.mock.calls[0]
    expect(rendered).toHaveLength(2)
    // The ineligible tail is still covered by the watermark.
    expect(chatUpdate).toHaveBeenCalledWith('chat-1', { episodeExtractionWatermarkMessageId: 'm4' })
  })

  it('reads a wide window in consecutive 60-message slices, advancing past each', async () => {
    const all = history(150)
    chatMessages = all

    const result = await runFoldEpisodePass(input({ windowMessages: all }))

    expect(result.slices).toBe(3)
    expect(mockExtract).toHaveBeenCalledTimes(3)
    expect(mockExtract.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([60, 60, 30])
    expect(chatUpdate.mock.calls.map((c) => c[1].episodeExtractionWatermarkMessageId)).toEqual([
      'h60',
      'h120',
      'h150',
    ])
    expect(result.watermarkAdvancedTo).toBe('h150')
  })

  it('stops at a slice lost to a timeout and leaves the watermark before it', async () => {
    const all = history(150)
    chatMessages = all
    mockExtract
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValueOnce({ success: false, timedOut: true, error: 'timeout' })

    const result = await runFoldEpisodePass(input({ windowMessages: all }))

    expect(result.timedOut).toBe(true)
    expect(mockExtract).toHaveBeenCalledTimes(2)
    expect(chatUpdate.mock.calls.map((c) => c[1].episodeExtractionWatermarkMessageId)).toEqual(['h60'])
  })
})

describe('runFoldEpisodePass — uncensored fallback (bug 213)', () => {
  it('hands the extractor the uncensored fallback it was given', async () => {
    const fallback = { conciergePolicy: {}, availableProfiles: [], isDangerousChat: true }

    await runFoldEpisodePass(input({ uncensoredFallback: fallback }))

    expect(mockExtract.mock.calls[0][5]).toBe(fallback)
  })
})

describe('runFoldEpisodePass — review findings 4, 7, 10, 13', () => {
  const seat = (i: number) => (i % 2 === 0 ? 'p-user' : 'p-ai')
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      message(`h${i + 1}`, {
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        participantId: seat(i),
        createdAt: new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString(),
      }),
    )

  let liveChat: AnyRecord
  let getMessages: jest.Mock

  /** A chat whose watermark actually moves when the pass writes it. */
  function primeLiveChat(all: unknown[], watermark: string | null = null) {
    primeRepos()
    chatMessages = all
    liveChat = {
      id: 'chat-1',
      episodeExtractionWatermarkMessageId: watermark,
      participants: [
        { id: 'p-user', type: 'USER', status: 'active', characterId: null },
        { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1' },
      ],
    }
    chatUpdate.mockImplementation(async (_id: string, patch: AnyRecord) => {
      Object.assign(liveChat, patch)
      return liveChat
    })
    getMessages = jest.fn(async () => chatMessages)
    const repos = mockRepos()
    mockRepos.mockReturnValue({
      ...repos,
      chats: { ...repos.chats, findById: jest.fn(async () => liveChat), getMessages },
    })
  }

  const renderedIds = (call: unknown[]) =>
    (call[0] as Array<{ content: string }>).map((m) => m.content.replace('content ', ''))

  it('#4: a slice lost to a timeout is read by the next fold even when that fold only covers newer turns', async () => {
    const all = history(250)
    primeLiveChat(all)
    mockExtract
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValueOnce({ success: false, timedOut: true, error: 'timeout' })

    // First fold: turns 1..240, four slices; slice 2 times out.
    const first = await runFoldEpisodePass(input({ windowMessages: all.slice(0, 240) }))
    expect(first.timedOut).toBe(true)
    expect(liveChat.episodeExtractionWatermarkMessageId).toBe('h60')

    // Second fold: only the ten newest turns. The gap h61..h240 must be read first.
    mockExtract.mockReset()
    mockExtract.mockResolvedValue({ success: true, result: [] })
    const second = await runFoldEpisodePass(input({ windowMessages: all.slice(240) }))

    expect(renderedIds(mockExtract.mock.calls[0])[0]).toBe('h61')
    const read = mockExtract.mock.calls.flatMap((c) => renderedIds(c))
    expect(read).toEqual(all.slice(60).map((m) => (m as unknown as { id: string }).id))
    expect(second.watermarkAdvancedTo).toBe('h250')
  })

  it('#7: a long backlog takes several jobs and the watermark advances monotonically', async () => {
    const all = history(600)
    primeLiveChat(all)
    mockExtract.mockResolvedValue({ success: true, result: [] })

    const marks: string[] = []
    for (let job = 0; job < 4; job++) {
      mockExtract.mockClear()
      const r = await runFoldEpisodePass(input({ windowMessages: all }))
      expect(mockExtract.mock.calls.length).toBeLessThanOrEqual(4)
      if (r.watermarkAdvancedTo) marks.push(r.watermarkAdvancedTo)
      if (liveChat.episodeExtractionWatermarkMessageId === 'h600') break
    }

    expect(marks).toEqual(['h240', 'h480', 'h600'])
  })

  it('#10: a second episode from the same slice does not link the first as a fragment', async () => {
    primeLiveChat(WINDOW)
    mockExtract.mockResolvedValue({
      success: true,
      result: [episode({ summary: 'first' }), episode({ summary: 'second' })],
    })
    const created: AnyRecord[] = []
    mockGate.mockImplementation(async () => {
      const memory = { id: `mem-ep${created.length + 1}`, relatedMemoryIds: [], kind: 'episodic', sourceMessageId: 'm2' }
      created.push(memory)
      return { action: 'INSERT', memory }
    })
    // The child overlay surfaces buffered creates: earlier episodes share the slice's source message.
    findFragments.mockImplementation(async () => [
      { id: 'frag-1', relatedMemoryIds: [], kind: 'semantic', sourceMessageId: 'm1' },
      ...created.map((m) => ({ ...m })),
    ])

    const result = await runFoldEpisodePass(input())

    const ep2Write = addRelatedMemoryIds.mock.calls.find((c) => c[1] === 'mem-ep2')
    expect(ep2Write![2]).toEqual(['frag-1'])
    expect(addRelatedMemoryIds.mock.calls.find((c) => c[1] === 'mem-ep1' && (c[2] as string[]).includes('mem-ep2'))).toBeUndefined()
    expect(result.fragmentsLinked).toBe(2)
  })

  it('#13: uses the transcript it is handed instead of reading it again', async () => {
    const all = history(10)
    primeLiveChat(all, 'h4')

    await runFoldEpisodePass(input({ windowMessages: all.slice(6), chatMessages: all }))

    expect(getMessages).not.toHaveBeenCalled()
    expect(renderedIds(mockExtract.mock.calls[0])).toEqual(['h5', 'h6', 'h7', 'h8', 'h9', 'h10'])
  })
})
