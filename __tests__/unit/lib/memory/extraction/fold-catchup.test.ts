/**
 * Idle catch-ups for the two fold-grain passes (`lib/memory/extraction/catchup.ts`).
 *
 * Both passes read at most four slices per run, so a chat that stops folding
 * (or never folds, or was regenerated and lost its cursors) would leave its
 * backlog stalled. The daily sweep picks idle chats whose cursor is behind
 * (`findFoldCatchupCandidates`), and each catch-up job reads the next slices
 * with the ordinary fold runner (`runFoldCatchup`): `other-fold` everything
 * past its cursor, `episode-fold` only folded history (bug 232).
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryExtractionModeSettings: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...l, child: jest.fn(() => l) } }
})

import { getRepositories } from '@/lib/repositories/factory'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import {
  findFoldCatchupCandidates,
  foldEndIndex,
  idleChatsForCatchup,
  isChatActiveForCatchup,
  isEpisodeBacklogBehind,
  isEpisodeBacklogBehindByAnchors,
  runFoldCatchup,
  FOLD_CATCHUP_IDLE_MS,
} from '@/lib/memory/extraction'
import type { MessageEvent } from '@/lib/schemas/types'
import { makeExtractionContext, seatMessage, type TestSeat } from '../../../../helpers/extraction-context'

type AnyRecord = Record<string, unknown>

const mockRepos = getRepositories as jest.Mock
const mockMode = getMemoryExtractionModeSettings as jest.Mock
const mockExecute = jest.mocked(executeCheapLLMTask)

const NOW = Date.UTC(2026, 9, 12, 12, 0)
const IDLE_AT = new Date(NOW - 3 * 60 * 60 * 1000).toISOString()

const AI: TestSeat = { characterId: 'char-1', name: 'Ai', participantId: 'p-ai' }
const HUMAN: TestSeat = { characterId: 'char-u', name: 'Human', participantId: 'p-user', isUser: true }

function history(n: number): MessageEvent[] {
  return Array.from({ length: n }, (_, i) =>
    seatMessage(`h${i + 1}`, i % 2 === 0 ? HUMAN : AI, `say-h${i + 1}`, new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString()),
  )
}

function chatRow(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'chat-1',
    userId: 'u1',
    chatType: 'salon',
    messageCount: 600,
    lastMessageAt: IDLE_AT,
    summaryAnchorMessageIds: [],
    participants: [
      { id: 'p-user', type: 'CHARACTER', status: 'active', characterId: 'char-u', controlledBy: 'user' },
      { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1', controlledBy: 'llm', connectionProfileId: 'prof-1' },
    ],
    ...over,
  }
}

let chats: AnyRecord[]
let messages: MessageEvent[]
let cursorMap: Map<string, AnyRecord>

function primeRepos(chatList: AnyRecord[], all: MessageEvent[], cursors: Record<string, AnyRecord> = {}) {
  chats = chatList
  messages = all
  cursorMap = new Map(Object.entries(cursors))
  mockRepos.mockReturnValue({
    chats: {
      findAll: jest.fn(async () => chats),
      getMessages: jest.fn(async () => messages),
    },
    memoryExtractionCursors: { findAllByChat: jest.fn(async () => cursorMap) },
    memories: { findByCharacterAndSourceMessageIds: jest.fn(async () => []), addRelatedMemoryIds: jest.fn(async () => []) },
  })
}

/** Ids rendered in every cheap-LLM call so far, in order. */
const idsRead = () =>
  mockExecute.mock.calls.flatMap(c =>
    [...(c[1] as Array<{ content: string }>).map(m => m.content).join('\n').matchAll(/say-(\w+)/g)].map(m => m[1]),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockMode.mockResolvedValue({ otherPass: 'hybrid', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
  mockExecute.mockImplementation(async (_s, _m, _u, parse) => ({ success: true, result: (parse as (r: string) => unknown)('[]') }) as never)
})

describe('fold boundary and backlog', () => {
  const msgs = history(10)

  it('foldEndIndex is the last surviving anchor, or -1', () => {
    expect(foldEndIndex(msgs, ['h2', 'h7', 'gone'])).toBe(6)
    expect(foldEndIndex(msgs, [])).toBe(-1)
    expect(foldEndIndex(msgs, null)).toBe(-1)
    expect(foldEndIndex(msgs, ['gone'])).toBe(-1)
  })

  it('is behind when the cursor is before the fold end, missing, or vanished', () => {
    const anchors = msgs.slice(0, 8).map(m => m.id)
    expect(isEpisodeBacklogBehind(msgs, anchors, 'h3').behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, anchors, null).behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, anchors, 'gone').behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, anchors, 'h8')).toEqual({ behind: false, endIndex: 7 })
    expect(isEpisodeBacklogBehind(msgs, anchors, 'h10').behind).toBe(false)
    expect(isEpisodeBacklogBehind(msgs, [], null)).toEqual({ behind: false, endIndex: -1 })
  })
})

describe('isEpisodeBacklogBehindByAnchors (the sweep reads no transcript)', () => {
  const anchors = ['h1', 'h2', 'h3', 'h4']
  it('is caught up only when the cursor sits on the last anchor', () => {
    expect(isEpisodeBacklogBehindByAnchors(anchors, 'h4')).toEqual({ behind: false, foldEndMessageId: 'h4' })
    expect(isEpisodeBacklogBehindByAnchors(anchors, 'h2').behind).toBe(true)
    expect(isEpisodeBacklogBehindByAnchors(anchors, null).behind).toBe(true)
    // Not in the folded list: behind, for the job's transcript check to settle.
    expect(isEpisodeBacklogBehindByAnchors(anchors, 'gone').behind).toBe(true)
    expect(isEpisodeBacklogBehindByAnchors([], null)).toEqual({ behind: false, foldEndMessageId: null })
  })
})

describe('idleChatsForCatchup / isChatActiveForCatchup', () => {
  it('keeps idle, recent, non-help chats with two or more messages, most recent first', () => {
    const at = (h: number) => new Date(NOW - h * 3600_000).toISOString()
    const list = [
      { id: 'older', messageCount: 5, lastMessageAt: at(5) },
      { id: 'newer', messageCount: 5, lastMessageAt: at(3) },
      { id: 'active', messageCount: 5, lastMessageAt: at(1) },
      { id: 'ancient', messageCount: 5, lastMessageAt: at(24 * 31) },
      { id: 'short', messageCount: 1, lastMessageAt: at(3) },
      { id: 'help', chatType: 'help', messageCount: 5, lastMessageAt: at(3) },
      { id: 'silent', messageCount: 5, lastMessageAt: null },
    ]
    expect(idleChatsForCatchup(list as never, NOW).map(c => c.id)).toEqual(['newer', 'older'])
  })

  it('treats a chat that spoke within the idle window as active', () => {
    expect(isChatActiveForCatchup({ lastMessageAt: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(true)
    expect(isChatActiveForCatchup({ lastMessageAt: new Date(NOW - FOLD_CATCHUP_IDLE_MS - 1).toISOString() }, NOW)).toBe(false)
    expect(isChatActiveForCatchup({ lastMessageAt: null } as never, NOW)).toBe(false)
  })
})

describe("findFoldCatchupCandidates('other-fold')", () => {
  it('selects an idle chat whose last message is past the cursor', async () => {
    primeRepos([chatRow()], history(4), { 'chat-1': { 'other-fold': 'h2' } })
    const sel = await findFoldCatchupCandidates('other-fold', { now: NOW })
    expect(sel).toEqual({
      candidates: [{ chatId: 'chat-1', userId: 'u1', anchorMessageId: 'h4', connectionProfileId: 'prof-1' }],
      deferred: 0,
    })
  })

  it('selects a chat with no cursor at all', async () => {
    primeRepos([chatRow()], history(4))
    expect((await findFoldCatchupCandidates('other-fold', { now: NOW })).candidates).toHaveLength(1)
  })

  it('skips a chat whose cursor is already its last message', async () => {
    primeRepos([chatRow()], history(4), { 'chat-1': { 'other-fold': 'h4' } })
    expect((await findFoldCatchupCandidates('other-fold', { now: NOW })).candidates).toHaveLength(0)
  })

  it('skips a chat that is not yet idle', async () => {
    primeRepos([chatRow({ lastMessageAt: new Date(NOW - 3600_000).toISOString() })], history(4))
    expect((await findFoldCatchupCandidates('other-fold', { now: NOW })).candidates).toHaveLength(0)
  })

  it('selects nothing in turn mode', async () => {
    mockMode.mockResolvedValue({ otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    primeRepos([chatRow()], history(4))
    expect((await findFoldCatchupCandidates('other-fold', { now: NOW })).candidates).toHaveLength(0)
    expect(mockRepos().chats.findAll).not.toHaveBeenCalled()
  })

  it('skips a chat with no connection profile on any seat', async () => {
    primeRepos([chatRow({ participants: [{ id: 'p-ai', type: 'CHARACTER', characterId: 'char-1' }] })], history(4))
    expect((await findFoldCatchupCandidates('other-fold', { now: NOW })).candidates).toHaveLength(0)
  })

  it('bounds the sweep and reports the overflow', async () => {
    const second = chatRow({ id: 'chat-2', lastMessageAt: new Date(NOW - 4 * 3600_000).toISOString() })
    primeRepos([second, chatRow()], history(4))
    const sel = await findFoldCatchupCandidates('other-fold', { now: NOW, limit: 1 })
    expect(sel.candidates.map(c => c.chatId)).toEqual(['chat-1'])
    expect(sel.deferred).toBe(1)
  })

  it('uses a chat list and a cursor map it is handed instead of reading its own', async () => {
    primeRepos([], history(4))
    const sel = await findFoldCatchupCandidates('other-fold', {
      now: NOW,
      chats: [chatRow()] as never,
      cursors: new Map([['chat-1', { 'other-fold': 'h3' }]]),
    })
    expect(sel.candidates.map(c => c.anchorMessageId)).toEqual(['h4'])
    expect(mockRepos().chats.findAll).not.toHaveBeenCalled()
    expect(mockRepos().memoryExtractionCursors.findAllByChat).not.toHaveBeenCalled()
  })
})

describe("findFoldCatchupCandidates('episode-fold')", () => {
  it('selects an idle folded chat whose episode cursor is behind, anchored on the fold boundary', async () => {
    const all = history(20)
    primeRepos([chatRow({ summaryAnchorMessageIds: all.slice(0, 16).map(m => m.id) })], all, { 'chat-1': { 'episode-fold': 'h4' } })

    const sel = await findFoldCatchupCandidates('episode-fold', { now: NOW })

    expect(sel.candidates).toEqual([{ chatId: 'chat-1', userId: 'u1', anchorMessageId: 'h16', connectionProfileId: 'prof-1' }])
  })

  it('selects regardless of the OTHER mode', async () => {
    mockMode.mockResolvedValue({ otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    primeRepos([chatRow({ summaryAnchorMessageIds: ['h1', 'h2'] })], history(4))
    expect((await findFoldCatchupCandidates('episode-fold', { now: NOW })).candidates).toHaveLength(1)
  })

  it('skips a chat that never folded, one that is caught up, and one still active', async () => {
    const all = history(20)
    primeRepos([chatRow({ summaryAnchorMessageIds: [] })], all)
    expect((await findFoldCatchupCandidates('episode-fold', { now: NOW })).candidates).toHaveLength(0)

    primeRepos([chatRow({ summaryAnchorMessageIds: ['h1', 'h2'] })], all, { 'chat-1': { 'episode-fold': 'h2' } })
    expect((await findFoldCatchupCandidates('episode-fold', { now: NOW })).candidates).toHaveLength(0)

    primeRepos([chatRow({ summaryAnchorMessageIds: ['h1', 'h2'], lastMessageAt: new Date(NOW - 60_000).toISOString() })], all)
    expect((await findFoldCatchupCandidates('episode-fold', { now: NOW })).candidates).toHaveLength(0)
  })

  it('reads no transcript, and uses a chat list it is handed instead of its own', async () => {
    primeRepos([chatRow()], history(20), { 'chat-1': { 'episode-fold': 'h1' } })
    const shared = [chatRow({ summaryAnchorMessageIds: ['h1', 'h2', 'h3'] })]

    const sel = await findFoldCatchupCandidates('episode-fold', { now: NOW, chats: shared as never })

    expect(sel.candidates.map(c => c.anchorMessageId)).toEqual(['h3'])
    expect(mockRepos().chats.getMessages).not.toHaveBeenCalled()
    expect(mockRepos().chats.findAll).not.toHaveBeenCalled()
  })
})

describe("runFoldCatchup('episode-fold')", () => {
  const ctxFor = (all: MessageEvent[], chat: AnyRecord) =>
    makeExtractionContext({ seats: [HUMAN, AI], messages: all, chat: { lastMessageAt: IDLE_AT, ...chat } })

  it('drains a 600-message regenerated backlog over follow-up jobs, monotonically, never past the fold', async () => {
    const all = history(600)
    primeRepos([], all)
    // Folded through h580; regenerate cleared the episode cursor.
    const ctx = ctxFor(all, { summaryAnchorMessageIds: all.slice(0, 580).map(m => m.id) })

    const marks: string[] = []
    for (let job = 0; job < 5; job++) {
      const result = await runFoldCatchup(ctx, 'episode-fold', { now: NOW })
      if (result.cursorAdvancedTo) marks.push(result.cursorAdvancedTo)
      if (result.slicesDeferred === 0) break
    }

    expect(marks).toEqual(['h240', 'h480', 'h580'])
    expect((await ctx.cursors.read('episode-fold')).afterMessageId).toBe('h580')
    // Every folded message read exactly once, in order; nothing past the fold.
    expect(idsRead()).toEqual(all.slice(0, 580).map(m => m.id))

    // Caught up: the next run does nothing.
    const after = await runFoldCatchup(ctx, 'episode-fold', { now: NOW })
    expect(after.skippedReason).toBe('behind-cursor')
  })

  it('leaves an active chat to the fold unless told to ignore idleness', async () => {
    const all = history(10)
    const ctx = ctxFor(all, { summaryAnchorMessageIds: ['h1', 'h2'], lastMessageAt: new Date(NOW - 60_000).toISOString() })

    expect((await runFoldCatchup(ctx, 'episode-fold', { now: NOW })).skippedReason).toBe('not-idle')
    expect(mockExecute).not.toHaveBeenCalled()

    const forced = await runFoldCatchup(ctx, 'episode-fold', { now: NOW, ignoreIdle: true })
    expect(forced.cursorAdvancedTo).toBe('h2')
  })

  it('reports a never-folded chat without reading it', async () => {
    const ctx = ctxFor(history(10), { summaryAnchorMessageIds: [] })
    expect((await runFoldCatchup(ctx, 'episode-fold', { now: NOW })).skippedReason).toBe('never-folded')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe("runFoldCatchup('other-fold')", () => {
  it('reads everything past its cursor, folded or not, through the last message', async () => {
    const all = history(10)
    const ctx = makeExtractionContext({
      seats: [HUMAN, AI],
      messages: all,
      mode: { otherPass: 'fold' },
      cursors: { 'other-fold': 'h6' },
      chat: { lastMessageAt: IDLE_AT, summaryAnchorMessageIds: [] },
    })

    const result = await runFoldCatchup(ctx, 'other-fold', { now: NOW })

    expect(idsRead().slice(0, 4)).toEqual(['h7', 'h8', 'h9', 'h10'])
    expect(result.cursorAdvancedTo).toBe('h10')
  })

  it('skips a chat whose cursor is already at its end', async () => {
    const all = history(4)
    const ctx = makeExtractionContext({
      seats: [HUMAN, AI],
      messages: all,
      mode: { otherPass: 'fold' },
      cursors: { 'other-fold': 'h4' },
      chat: { lastMessageAt: IDLE_AT },
    })
    expect((await runFoldCatchup(ctx, 'other-fold', { now: NOW })).skippedReason).toBe('behind-cursor')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
