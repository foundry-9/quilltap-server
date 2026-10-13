/**
 * Bug 232 — the fold episode pass has an idle catch-up.
 *
 * The episode pass reads at most four slices per run, so after a regenerate
 * clears its watermark a long chat's episodes drained only as the chat folded
 * again. The daily sweep now enqueues a catch-up for an idle chat whose
 * episode watermark is behind its fold boundary, and each catch-up job reads
 * the next slices of folded history with the real episode pass.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({ extractEpisodesFromFold: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/memory/fold-catchup', () => {
  const actual = jest.requireActual('@/lib/memory/fold-catchup')
  return {
    ...actual,
    resolveFoldCatchupRoute: jest.fn(async () => ({
      cheapLLM: { provider: 'anthropic', modelName: 'haiku' },
      uncensoredFallback: { isDangerousChat: false },
    })),
  }
})

import { getRepositories } from '@/lib/repositories/factory'
import { extractEpisodesFromFold } from '@/lib/memory/cheap-llm-tasks'
import {
  findFoldEpisodeCatchupCandidates,
  foldEndIndex,
  isEpisodeBacklogBehind,
  isEpisodeBacklogBehindByAnchors,
  runFoldEpisodeCatchup,
} from '@/lib/memory/fold-episode-catchup'
import { resolveFoldCatchupRoute } from '@/lib/memory/fold-catchup'

type AnyRecord = Record<string, unknown>

const mockRepos = getRepositories as jest.Mock
const mockExtract = extractEpisodesFromFold as jest.Mock

const NOW = Date.UTC(2026, 9, 12, 12, 0)
const IDLE_AT = new Date(NOW - 3 * 60 * 60 * 1000).toISOString()

function history(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i + 1}`,
    type: 'message',
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `line ${i + 1}`,
    participantId: i % 2 === 0 ? 'p-user' : 'p-ai',
    createdAt: new Date(Date.UTC(2026, 6, 20, 9, i)).toISOString(),
  }))
}

function chatRow(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'chat-1',
    userId: 'u1',
    chatType: 'salon',
    messageCount: 600,
    lastMessageAt: IDLE_AT,
    episodeExtractionWatermarkMessageId: null,
    participants: [
      { id: 'p-user', type: 'USER', status: 'active', characterId: null },
      { id: 'p-ai', type: 'CHARACTER', status: 'active', characterId: 'char-1', connectionProfileId: 'prof-1' },
    ],
    ...over,
  }
}

let live: AnyRecord
let messages: AnyRecord[]

function primeRepos(chat: AnyRecord, all: AnyRecord[]) {
  live = chat
  messages = all
  mockRepos.mockReturnValue({
    chats: {
      findAll: jest.fn(async () => [live]),
      findById: jest.fn(async () => live),
      getMessages: jest.fn(async () => messages),
      update: jest.fn(async (_id: string, patch: AnyRecord) => {
        Object.assign(live, patch)
        return live
      }),
    },
    characters: { findByIdRaw: jest.fn(async (id: string) => ({ id, name: id })) },
    memories: { findByCharacterAndSourceMessageIds: jest.fn(async () => []) },
  })
}

const input = { chatId: 'chat-1', userId: 'u1', connectionProfile: {}, cheapLLMSettings: {}, availableProfiles: [], now: NOW } as never

beforeEach(() => {
  jest.clearAllMocks()
  mockExtract.mockResolvedValue({ success: true, result: [] })
})

describe('fold boundary and backlog', () => {
  const msgs = history(10)

  it('foldEndIndex is the last surviving anchor, or -1', () => {
    expect(foldEndIndex(msgs, ['h2', 'h7', 'gone'])).toBe(6)
    expect(foldEndIndex(msgs, [])).toBe(-1)
    expect(foldEndIndex(msgs, null)).toBe(-1)
    expect(foldEndIndex(msgs, ['gone'])).toBe(-1)
  })

  it('is behind when the watermark is before the fold end, missing, or vanished', () => {
    const anchors = msgs.slice(0, 8).map(m => m.id)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'h3' }).behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: null }).behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'gone' }).behind).toBe(true)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'h8' }).behind).toBe(false)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'h10' }).behind).toBe(false)
    expect(isEpisodeBacklogBehind(msgs, { summaryAnchorMessageIds: [], episodeExtractionWatermarkMessageId: null }).behind).toBe(false)
  })
})

describe('isEpisodeBacklogBehindByAnchors (the sweep reads no transcript)', () => {
  const anchors = ['h1', 'h2', 'h3', 'h4']
  it('is caught up only when the watermark sits on the last anchor', () => {
    expect(isEpisodeBacklogBehindByAnchors({ summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'h4' }))
      .toEqual({ behind: false, foldEndMessageId: 'h4' })
    expect(isEpisodeBacklogBehindByAnchors({ summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'h2' }).behind).toBe(true)
    expect(isEpisodeBacklogBehindByAnchors({ summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: null }).behind).toBe(true)
    // Not in the folded list: behind, for the job's transcript check to settle.
    expect(isEpisodeBacklogBehindByAnchors({ summaryAnchorMessageIds: anchors, episodeExtractionWatermarkMessageId: 'gone' }).behind).toBe(true)
    expect(isEpisodeBacklogBehindByAnchors({ summaryAnchorMessageIds: [], episodeExtractionWatermarkMessageId: null }))
      .toEqual({ behind: false, foldEndMessageId: null })
  })
})

describe('findFoldEpisodeCatchupCandidates', () => {
  it('selects an idle folded chat whose episode watermark is behind', async () => {
    const all = history(20)
    primeRepos(chatRow({ summaryAnchorMessageIds: all.slice(0, 16).map(m => m.id), episodeExtractionWatermarkMessageId: 'h4' }), all)

    const sel = await findFoldEpisodeCatchupCandidates({ now: NOW })

    expect(sel.candidates).toEqual([
      { chatId: 'chat-1', userId: 'u1', foldEndMessageId: 'h16', connectionProfileId: 'prof-1' },
    ])
  })

  it('skips a chat that never folded, one that is caught up, and one still active', async () => {
    const all = history(20)
    primeRepos(chatRow({ summaryAnchorMessageIds: [] }), all)
    expect((await findFoldEpisodeCatchupCandidates({ now: NOW })).candidates).toHaveLength(0)

    primeRepos(chatRow({ summaryAnchorMessageIds: ['h1', 'h2'], episodeExtractionWatermarkMessageId: 'h2' }), all)
    expect((await findFoldEpisodeCatchupCandidates({ now: NOW })).candidates).toHaveLength(0)

    primeRepos(chatRow({ summaryAnchorMessageIds: ['h1', 'h2'], lastMessageAt: new Date(NOW - 60_000).toISOString() }), all)
    expect((await findFoldEpisodeCatchupCandidates({ now: NOW })).candidates).toHaveLength(0)
  })

  it('reads no transcript, and uses a chat list it is handed instead of its own', async () => {
    const all = history(20)
    primeRepos(chatRow(), all)
    const shared = [chatRow({ summaryAnchorMessageIds: ['h1', 'h2', 'h3'], episodeExtractionWatermarkMessageId: 'h1' })]

    const sel = await findFoldEpisodeCatchupCandidates({ now: NOW, chats: shared as never })

    expect(sel.candidates.map(c => c.foldEndMessageId)).toEqual(['h3'])
    const repos = mockRepos.mock.results[0]?.value ?? mockRepos()
    expect(repos.chats.getMessages).not.toHaveBeenCalled()
    expect(repos.chats.findAll).not.toHaveBeenCalled()
  })
})

describe('runFoldEpisodeCatchup', () => {
  it('drains a 600-message regenerated backlog over follow-up jobs, monotonically, never past the fold', async () => {
    const all = history(600)
    // Folded through h580; regenerate cleared the episode watermark.
    primeRepos(chatRow({ summaryAnchorMessageIds: all.slice(0, 580).map(m => m.id) }), all)

    const marks: string[] = []
    const readIds: string[] = []
    mockExtract.mockImplementation(async (rendered: Array<{ content: string }>) => {
      readIds.push(...rendered.map(r => `h${r.content.split(' ')[1]}`))
      return { success: true, result: [] }
    })
    for (let job = 0; job < 5; job++) {
      const result = await runFoldEpisodeCatchup(input)
      if (result.watermarkAdvancedTo) marks.push(result.watermarkAdvancedTo)
      if (result.slicesDeferred === 0) break
    }

    expect(marks).toEqual(['h240', 'h480', 'h580'])
    expect(live.episodeExtractionWatermarkMessageId).toBe('h580')
    // Every folded message read exactly once, in order; nothing past the fold.
    expect(readIds).toEqual(all.slice(0, 580).map(m => m.id))
    expect(resolveFoldCatchupRoute).toHaveBeenCalled()

    // Caught up: the next run does nothing.
    const after = await runFoldEpisodeCatchup(input)
    expect(after.skippedReason).toBe('behind-watermark')
  })

  it('leaves an active chat to the fold unless told to ignore idleness', async () => {
    const all = history(10)
    primeRepos(chatRow({ summaryAnchorMessageIds: ['h1', 'h2'], lastMessageAt: new Date(NOW - 60_000).toISOString() }), all)

    expect((await runFoldEpisodeCatchup(input)).skippedReason).toBe('not-idle')
    expect(mockExtract).not.toHaveBeenCalled()

    const forced = await runFoldEpisodeCatchup({ ...(input as object), ignoreIdle: true } as never)
    expect(forced.watermarkAdvancedTo).toBe('h2')
  })

  it('reports a never-folded chat without reading it', async () => {
    primeRepos(chatRow({ summaryAnchorMessageIds: [] }), history(10))
    expect((await runFoldEpisodeCatchup(input)).skippedReason).toBe('never-folded')
    expect(mockExtract).not.toHaveBeenCalled()
  })
})
