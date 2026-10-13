/**
 * The fold-time episode pass (`runFoldPass(ctx, 'episode-fold', …)`).
 *
 * This pass rides the fold cadence, so its first duty is to never damage the
 * fold: every failure path — an empty window, nobody present, a dead
 * extractor, a repository or admission that throws — must return a result
 * rather than throw. Its second duty is the fragment linking, which is
 * union-preserving on both sides (deltas through `linkBothWays`); a clobbering
 * write here would quietly sever links admission had already made.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/memory/time/clock', () => {
  const actual = jest.requireActual('@/lib/memory/time/clock')
  return { ...actual, resolveWhenPhrase: jest.fn(() => null) }
})
jest.mock('@/lib/memory/extraction/prompts/episode', () => {
  const actual = jest.requireActual('@/lib/memory/extraction/prompts/episode')
  return { ...actual, buildEpisodeFoldMessages: jest.fn(actual.buildEpisodeFoldMessages) }
})
jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})

import { getRepositories } from '@/lib/repositories/factory'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { resolveWhenPhrase } from '@/lib/memory/time/clock'
import { buildEpisodeFoldMessages } from '@/lib/memory/extraction/prompts/episode'
import { runFoldPass, runFoldCatchup, MAX_FRAGMENT_LINKS } from '@/lib/memory/extraction'
import type { MessageEvent } from '@/lib/schemas/types'
import { mockAdmitRow, admissionOutcome } from '../../../../helpers/admission-mock'
import { makeExtractionContext, seatMessage, type TestContextOptions, type TestSeat } from '../../../../helpers/extraction-context'

const mockRepos = getRepositories as jest.Mock
const mockExecute = jest.mocked(executeCheapLLMTask)
const mockResolveWhen = resolveWhenPhrase as jest.Mock
const mockBuild = buildEpisodeFoldMessages as jest.Mock
const mockAdmit = mockAdmitRow

type AnyRecord = Record<string, unknown>
type Reply = { raw: string } | { timedOut: true } | { failed: string }

/** The AI seat; the human's lines come from a participant outside the cast. */
const AI: TestSeat = { characterId: 'char-1', name: 'Name-char-1', participantId: 'p-ai' }
const USER: TestSeat = { characterId: 'nobody', name: 'User', participantId: 'p-user', isUser: true }

function message(id: string, over: Partial<MessageEvent> = {}): MessageEvent {
  return seatMessage(id, USER, `content ${id}`, '2026-07-20T09:00:00.000Z', over)
}

const WINDOW = [
  message('m1', { createdAt: '2026-07-20T09:00:00.000Z' }),
  message('m2', { role: 'ASSISTANT', participantId: 'p-ai', createdAt: '2026-07-20T09:05:00.000Z' } as Partial<MessageEvent>),
]

const history = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    message(`h${i + 1}`, {
      role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
      participantId: i % 2 === 0 ? 'p-user' : 'p-ai',
      createdAt: new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString(),
    } as Partial<MessageEvent>),
  )

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

/** A scripted model: `reply(callNumber)` (1-based) says what the call returns. */
function model(reply: (n: number) => Reply) {
  let n = 0
  mockExecute.mockImplementation(async (_sel, _messages, _user, parse) => {
    n++
    const r = reply(n)
    if ('timedOut' in r) return { success: false, timedOut: true, error: 'timeout' } as never
    if ('failed' in r) return { success: false, error: r.failed } as never
    return { success: true, result: (parse as (raw: string) => unknown)(r.raw) } as never
  })
}
const episodes = (...eps: AnyRecord[]) => model(() => ({ raw: JSON.stringify(eps) }))

/** The rendered stretch each call was built from. */
const stretchOf = (i: number) => (mockBuild.mock.calls[i][0] as { stretch: Array<{ speaker: string; content: string; createdAt: string | null }> }).stretch
const renderedIds = (i: number) => stretchOf(i).map(m => m.content.replace('content ', ''))

let addRelatedMemoryIds: jest.Mock
let findFragments: jest.Mock

function ctxFor(over: TestContextOptions = {}) {
  return makeExtractionContext({
    seats: [AI],
    messages: WINDOW,
    projectId: 'proj-1',
    ...over,
  })
}

const run = (ctx = ctxFor(), windowMessages: MessageEvent[] = WINDOW, extra: AnyRecord = {}) =>
  runFoldPass(ctx, 'episode-fold', { windowMessages, ...extra })

const payloads = () => mockAdmit.mock.calls.map(c => c[0] as AnyRecord)

beforeEach(() => {
  jest.clearAllMocks()
  addRelatedMemoryIds = jest.fn(async () => [])
  findFragments = jest.fn(async () => [])
  mockRepos.mockReturnValue({
    memories: { findByCharacterAndSourceMessageIds: findFragments, addRelatedMemoryIds },
  })
  mockResolveWhen.mockReturnValue(null)
  episodes(episode())
  mockAdmit.mockResolvedValue(admissionOutcome('insert', { id: 'mem-ep', relatedMemoryIds: [] }))
})

describe('episode-fold — bail-outs never throw', () => {
  it('returns an empty result for an empty window without calling anything', async () => {
    const result = await run(ctxFor(), [])

    expect(result).toMatchObject({ skippedReason: 'empty-window', slices: 0, createdIds: [] })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns an empty result when no character participant is present', async () => {
    const result = await run(ctxFor({ seats: [{ ...AI, present: false }] }))

    expect(result.skippedReason).toBe('nobody-present')
    expect(result.admitted).toHaveLength(0)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('swallows an extractor failure', async () => {
    model(() => ({ failed: 'model down' }))

    await expect(run()).resolves.toMatchObject({ failed: 1, admitted: [] })
  })

  it('swallows an extractor that succeeds with nothing to say', async () => {
    episodes()

    const result = await run()

    expect(result.admitted).toHaveLength(0)
    expect(mockAdmit).not.toHaveBeenCalled()
  })

  it('swallows an outright throw from the repositories', async () => {
    mockRepos.mockImplementation(() => {
      throw new Error('database on fire')
    })

    // The linker's failure is logged; the episode itself was admitted.
    await expect(run()).resolves.toMatchObject({ createdIds: ['mem-ep'], cursorAdvancedTo: 'm2' })
  })

  it('swallows a throwing cursor store', async () => {
    const ctx = ctxFor()
    ctx.cursors.read = async () => { throw new Error('cursor table gone') }

    await expect(run(ctx)).resolves.toMatchObject({ skippedReason: 'error', createdIds: [] })
  })

  it('an admission that throws costs that character alone: the others are written and the slice is read', async () => {
    const ctx = ctxFor({
      seats: [
        { characterId: 'char-a', name: 'A', participantId: 'p-a' },
        { characterId: 'char-b', name: 'B', participantId: 'p-b' },
      ],
    })
    mockAdmit.mockImplementation(async (payload: AnyRecord) => {
      if (payload.characterId === 'char-a') throw new Error('gate exploded')
      return admissionOutcome('insert', { id: 'mem-b', relatedMemoryIds: [] })
    })

    const result = await run(ctx)

    expect(result.skippedReason).toBeUndefined()
    expect(result.createdIds).toEqual(['mem-b'])
    expect(result.debugLogs.some(l => l.includes('admission failed (gate exploded)'))).toBe(true)
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).not.toBeNull()
  })
})

describe('episode-fold — the episode memory', () => {
  it('admits one episodic memory per present character', async () => {
    let n = 0
    mockAdmit.mockImplementation(async () => admissionOutcome('insert', { id: `mem-${++n}`, relatedMemoryIds: [] }))
    const ctx = ctxFor({
      seats: [
        { characterId: 'char-a', name: 'A', participantId: 'p-a' },
        { characterId: 'char-b', name: 'B', participantId: 'p-b' },
        { characterId: 'char-gone', name: 'Gone', participantId: 'p-gone', present: false },
      ],
    })

    const result = await run(ctx)

    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(result.createdIds).toEqual(['mem-1', 'mem-2'])
    expect(payloads().map(p => p.characterId)).toEqual(['char-a', 'char-b'])
  })

  it('tags the memory as episodic with the retrieval keywords the recall path expects', async () => {
    await run()

    expect(payloads()[0]).toMatchObject({
      kind: 'episodic',
      source: 'AUTO',
      summary: 'The cellar expedition',
      content: 'They went down and found the crates.',
      importance: 0.7,
      entities: ['Cellar', 'Crates'],
      projectId: 'proj-1',
      witnessedContext: 'user_present',
      aboutCharacterId: null,
      sourceMessageId: 'm2',
      sourceMessageTimestamp: '2026-07-20T09:05:00.000Z',
    })
    // Entities are lower-cased into keywords, then the three fixed markers.
    expect(payloads()[0].keywords).toEqual(['cellar', 'crates', 'past', 'scope: narrow', 'history'])
  })

  it('marks an autonomous-room fold as such', async () => {
    await run(ctxFor({ chat: { chatType: 'autonomous' } }))

    expect(payloads()[0].witnessedContext).toBe('autonomous_room')
  })

  it('anchors the clock to the newest stamped message, not to now', async () => {
    await run(ctxFor({ timeZone: 'Asia/Tokyo' }))

    // The memory-calendar zone rides on the clock.
    expect(mockBuild.mock.calls[0][0].clock).toEqual({
      nowIso: '2026-07-20T09:05:00.000Z',
      timelineMode: 'realtime',
      timeZone: 'Asia/Tokyo',
    })
  })

  it('dates the episode from the window start when the when-phrase does not resolve', async () => {
    episodes(episode({ when: 'last Tuesday' }))
    mockResolveWhen.mockReturnValue(null)

    await run()

    expect(payloads()[0].occurredAt).toBe('2026-07-20T09:00:00.000Z')
  })

  it('prefers a resolved when-phrase over the window start', async () => {
    episodes(episode({ when: 'last Tuesday' }))
    mockResolveWhen.mockReturnValue('2026-07-14T00:00:00.000Z')

    await run(ctxFor({ timeZone: 'Asia/Tokyo' }))

    // Resolved in the same zone the extractor's clock was rendered in.
    expect(mockResolveWhen).toHaveBeenCalledWith('last Tuesday', '2026-07-20T09:05:00.000Z', 'Asia/Tokyo')
    expect(payloads()[0].occurredAt).toBe('2026-07-14T00:00:00.000Z')
  })

  it('falls back to the when-phrase for narrativeTime only in narrative mode', async () => {
    episodes(episode({ when: 'the second evening', narrativeTime: null }))

    await run(ctxFor({ chat: { timelineMode: 'narrative' } }))
    expect(payloads()[0].narrativeTime).toBe('the second evening')

    mockAdmit.mockClear()
    await run(ctxFor({ chat: { timelineMode: 'realtime' } }))
    expect(payloads()[0].narrativeTime).toBeNull()
  })

  it('renders each message under its speaker name, falling back to a role label', async () => {
    await run()

    expect(stretchOf(0)).toEqual([
      { speaker: 'User', content: 'content m1', createdAt: '2026-07-20T09:00:00.000Z' },
      { speaker: 'Name-char-1', content: 'content m2', createdAt: '2026-07-20T09:05:00.000Z' },
    ])
  })

  it.each([
    ['insert', 1, 0],
    ['insert-linked', 1, 0],
    ['reinforce', 0, 1],
    ['absorb', 0, 0],
    ['promote-and-reinforce', 0, 1],
  ] as const)('counts a %s admission as %i created, %i reinforced', async (kind, created, reinforced) => {
    mockAdmit.mockResolvedValue(admissionOutcome(kind, { id: 'mem-ep', relatedMemoryIds: [] }))

    const result = await run()

    expect(result.createdIds).toHaveLength(created)
    expect(result.reinforcedIds).toHaveLength(reinforced)
  })

  it('skips linking when admission returns no memory at all', async () => {
    mockAdmit.mockResolvedValue(admissionOutcome('reject', null))

    const result = await run()

    expect(result.createdIds).toHaveLength(0)
    expect(findFragments).not.toHaveBeenCalled()
  })

  it('hands the extractor the uncensored fallback the route carries (bug 213)', async () => {
    const ctx = ctxFor()
    const fallback = { conciergePolicy: {}, availableProfiles: [], isDangerousChat: true }
    ;(ctx.route as AnyRecord).uncensoredFallback = fallback

    await run(ctx)

    expect(mockExecute.mock.calls[0][7]).toBe(fallback)
  })
})

describe('episode-fold — fragment linking', () => {
  it('links the window fragments both ways without clobbering existing links', async () => {
    mockAdmit.mockResolvedValue(admissionOutcome('insert', { id: 'mem-ep', relatedMemoryIds: ['pre-existing'] }))
    findFragments.mockResolvedValue([
      { id: 'frag-1', relatedMemoryIds: ['other'] },
      { id: 'frag-2', relatedMemoryIds: [] },
    ])

    await run()

    expect(findFragments).toHaveBeenCalledWith('char-1', ['m1', 'm2'])
    // Links are deltas against the rows at commit (bug 231): the episode
    // gains both fragments, each fragment gains the episode, and no whole
    // list is ever written, so prior links survive however they changed.
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'mem-ep', ['frag-1', 'frag-2'])
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'frag-1', ['mem-ep'])
    expect(addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'frag-2', ['mem-ep'])
    expect(addRelatedMemoryIds).toHaveBeenCalledTimes(3)
  })

  it('never links an episode to itself', async () => {
    findFragments.mockResolvedValue([{ id: 'mem-ep', relatedMemoryIds: [] }])

    await run()

    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
  })

  it('skips the write when every fragment is already linked', async () => {
    mockAdmit.mockResolvedValue(admissionOutcome('insert', { id: 'mem-ep', relatedMemoryIds: ['frag-1'] }))
    findFragments.mockResolvedValue([{ id: 'frag-1', relatedMemoryIds: ['mem-ep'] }])

    await run()

    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
  })

  it(`caps fragment links at ${MAX_FRAGMENT_LINKS} per episode`, async () => {
    findFragments.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ id: `frag-${i}`, relatedMemoryIds: [] })))

    await run()

    const episodeWrite = addRelatedMemoryIds.mock.calls.find(c => c[1] === 'mem-ep')
    expect(episodeWrite![2] as string[]).toHaveLength(8)
    expect(MAX_FRAGMENT_LINKS).toBe(8)
  })

  it('does nothing further when the window produced no fragments', async () => {
    findFragments.mockResolvedValue([])

    await run()

    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
  })

  it('links nothing in a dry run, and asks admission to decide only', async () => {
    findFragments.mockResolvedValue([{ id: 'frag-1', relatedMemoryIds: [] }])

    const result = await run(ctxFor({ dryRun: true }))

    expect(mockAdmit.mock.calls[0][1]).toMatchObject({ dryRun: true })
    expect(findFragments).not.toHaveBeenCalled()
    expect(addRelatedMemoryIds).not.toHaveBeenCalled()
    expect(result.createdIds).toEqual([])
    expect(result.admitted).toHaveLength(1)
  })
})

describe('episode-fold — cursor and slices (bug 207)', () => {
  it('advances the cursor to the end of the window it read', async () => {
    const ctx = ctxFor()
    const result = await run(ctx)

    expect(result.cursorAdvancedTo).toBe('m2')
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('m2')
  })

  it('reads only what lies past the cursor on a hard-rebuild window', async () => {
    const all = history(10)
    const ctx = ctxFor({ messages: all, cursors: { 'episode-fold': 'h6' } })

    await run(ctx, all)

    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(renderedIds(0)).toEqual(['h7', 'h8', 'h9', 'h10'])
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('h10')
  })

  it('does nothing for a window wholly behind the cursor', async () => {
    const ctx = ctxFor({ cursors: { 'episode-fold': 'm2' } })
    const advance = jest.spyOn(ctx.cursors, 'advance')

    const result = await run(ctx)

    expect(result.skippedReason).toBe('behind-cursor')
    expect(mockExecute).not.toHaveBeenCalled()
    expect(advance).not.toHaveBeenCalled()
  })

  it('drops empty and seatless messages before rendering', async () => {
    const ctx = ctxFor()
    await run(ctx, [...WINDOW, message('m3', { content: '   ' }), message('m4', { participantId: null } as Partial<MessageEvent>)])

    expect(stretchOf(0)).toHaveLength(2)
    // The ineligible tail is still covered by the cursor.
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('m4')
  })

  it('reads a wide window in consecutive 60-message slices, advancing past each', async () => {
    const all = history(150)
    const ctx = ctxFor({ messages: all })
    const advance = jest.spyOn(ctx.cursors, 'advance')

    const result = await run(ctx, all)

    expect(result.slices).toBe(3)
    expect(mockExecute).toHaveBeenCalledTimes(3)
    expect(mockBuild.mock.calls.map((_, i) => stretchOf(i).length)).toEqual([60, 60, 30])
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60', 'h120', 'h150'])
    expect(result.cursorAdvancedTo).toBe('h150')
  })

  it('stops at a slice lost to a timeout and leaves the cursor before it', async () => {
    const all = history(150)
    const ctx = ctxFor({ messages: all })
    const advance = jest.spyOn(ctx.cursors, 'advance')
    model(n => (n === 2 ? { timedOut: true } : { raw: '[]' }))

    const result = await run(ctx, all)

    expect(result.timedOut).toBe(1)
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(advance.mock.calls.map(c => c[1])).toEqual(['h60'])
  })
})

describe('episode-fold — review findings 4, 7, 10, 13', () => {
  it('#4: a slice lost to a timeout is read by the next fold even when that fold only covers newer turns', async () => {
    const all = history(250)
    const ctx = ctxFor({ messages: all })
    model(n => (n === 2 ? { timedOut: true } : { raw: '[]' }))

    // First fold: turns 1..240, four slices; slice 2 times out.
    const first = await run(ctx, all.slice(0, 240))
    expect(first.timedOut).toBe(1)
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('h60')

    // Second fold: only the ten newest turns. The gap h61..h240 must be read first.
    mockBuild.mockClear()
    model(() => ({ raw: '[]' }))
    const second = await run(ctx, all.slice(240))

    expect(renderedIds(0)[0]).toBe('h61')
    const read = mockBuild.mock.calls.flatMap((_, i) => renderedIds(i))
    expect(read).toEqual(all.slice(60).map(m => m.id))
    expect(second.cursorAdvancedTo).toBe('h250')
  })

  it('#7: a long backlog takes several jobs and the cursor advances monotonically', async () => {
    const all = history(600)
    const ctx = ctxFor({ messages: all, chat: { summaryAnchorMessageIds: all.map(m => m.id) } })
    model(() => ({ raw: '[]' }))

    const marks: string[] = []
    for (let job = 0; job < 4; job++) {
      mockExecute.mockClear()
      const r = await runFoldCatchup(ctx, 'episode-fold', { ignoreIdle: true })
      expect(mockExecute.mock.calls.length).toBeLessThanOrEqual(4)
      if (r.cursorAdvancedTo) marks.push(r.cursorAdvancedTo)
      if ((await ctx.cursors.read('episode-fold')).afterMessageId === 'h600') break
    }

    expect(marks).toEqual(['h240', 'h480', 'h600'])
  })

  it('#10: a second episode from the same slice does not link the first as a fragment', async () => {
    episodes(episode({ summary: 'first' }), episode({ summary: 'second' }))
    const created: AnyRecord[] = []
    mockAdmit.mockImplementation(async () => {
      const memory = { id: `mem-ep${created.length + 1}`, relatedMemoryIds: [], kind: 'episodic', sourceMessageId: 'm2' }
      created.push(memory)
      return admissionOutcome('insert', memory)
    })
    // The child overlay surfaces buffered creates: earlier episodes share the slice's source message.
    findFragments.mockImplementation(async () => [
      { id: 'frag-1', relatedMemoryIds: [], kind: 'semantic', sourceMessageId: 'm1' },
      ...created.map(m => ({ ...m })),
    ])

    await run()

    const ep2Write = addRelatedMemoryIds.mock.calls.find(c => c[1] === 'mem-ep2')
    expect(ep2Write![2]).toEqual(['frag-1'])
    expect(addRelatedMemoryIds.mock.calls.find(c => c[1] === 'mem-ep1' && (c[2] as string[]).includes('mem-ep2'))).toBeUndefined()
    // Each episode linked frag-1 (and frag-1 each episode): one fragment per episode.
    expect(addRelatedMemoryIds.mock.calls.filter(c => c[1] === 'frag-1').map(c => c[2])).toEqual([['mem-ep1'], ['mem-ep2']])
  })

  it('#13: reads the range past the cursor from the chat transcript, not only the window handed over', async () => {
    const all = history(10)
    const ctx = ctxFor({ messages: all, cursors: { 'episode-fold': 'h4' } })

    await run(ctx, all.slice(6))

    expect(renderedIds(0)).toEqual(['h5', 'h6', 'h7', 'h8', 'h9', 'h10'])
  })
})
