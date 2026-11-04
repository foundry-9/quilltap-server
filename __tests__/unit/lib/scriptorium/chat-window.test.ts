/**
 * Which chats fall in a time window (`lib/scriptorium/chat-window.ts`), and
 * the conversation chunk search restricted to them (`chatIds`).
 * See docs/developer/features/complete/search-window-first-and-honest-empty.md.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: jest.fn((a: ArrayLike<number>, b: ArrayLike<number>) => {
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] * b[i]
    return sum
  }),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { chatSpanOf, chatOverlapsWindow, findChatsInWindow } from '@/lib/scriptorium/chat-window'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'

const mockRepos = getRepositories as jest.Mock

function chat(id: string, createdAt: string, lastMessageAt: string | null, updatedAt = lastMessageAt ?? createdAt) {
  return { id, title: `Chat ${id}`, createdAt, updatedAt, lastMessageAt }
}

const TODAY = { from: '2026-11-04T06:00:00.000Z', to: '2026-11-05T05:59:59.999Z' }

describe('chatSpanOf', () => {
  it('ends at lastMessageAt, not updatedAt', () => {
    const c = chat('a', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z', '2026-11-04T12:00:00.000Z')
    expect(chatSpanOf(c)).toEqual({ start: Date.parse(c.createdAt), end: Date.parse('2026-10-28T11:00:00.000Z') })
  })

  it('falls back to updatedAt, then createdAt', () => {
    expect(chatSpanOf(chat('a', '2026-10-28T10:00:00.000Z', null, '2026-10-29T00:00:00.000Z'))!.end)
      .toBe(Date.parse('2026-10-29T00:00:00.000Z'))
    expect(chatSpanOf({ createdAt: '2026-10-28T10:00:00.000Z', updatedAt: 'garbage', lastMessageAt: null })!.end)
      .toBe(Date.parse('2026-10-28T10:00:00.000Z'))
  })

  it('is null when createdAt is unparseable', () => {
    expect(chatSpanOf({ createdAt: 'nope', updatedAt: 'nope', lastMessageAt: null })).toBeNull()
  })
})

describe('chatOverlapsWindow', () => {
  it('a chat retitled today whose last message was last week is not in today', () => {
    const c = chat('a', '2026-10-28T10:00:00.000Z', '2026-10-28T11:00:00.000Z', '2026-11-04T12:00:00.000Z')
    expect(chatOverlapsWindow(c, TODAY)).toBe(false)
  })

  it('a chat that started before the window and ran into it overlaps', () => {
    expect(chatOverlapsWindow(chat('a', '2026-11-03T22:00:00.000Z', '2026-11-04T07:00:00.000Z'), TODAY)).toBe(true)
  })
})

describe('findChatsInWindow', () => {
  const chats = [
    chat('old', '2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z'),
    chat('early', '2026-11-04T08:00:00.000Z', '2026-11-04T09:00:00.000Z'),
    chat('late', '2026-11-04T20:00:00.000Z', '2026-11-04T21:00:00.000Z'),
    chat('current', '2026-11-04T12:00:00.000Z', '2026-11-04T23:00:00.000Z'),
  ]

  it("reads the character's chats, newest first, leaving out the excluded one", async () => {
    const findByCharacterId = jest.fn(async () => chats)
    mockRepos.mockReturnValue({ chats: { findByCharacterId, findByUserId: jest.fn() } })
    const found = await findChatsInWindow({ characterId: 'c1', userId: 'u1', window: TODAY, excludeChatId: 'current' })
    expect(findByCharacterId).toHaveBeenCalledWith('c1')
    expect(found.map(c => c.id)).toEqual(['late', 'early'])
  })

  it("reads the user's chats on the operator surface", async () => {
    const findByUserId = jest.fn(async () => chats)
    mockRepos.mockReturnValue({ chats: { findByCharacterId: jest.fn(), findByUserId } })
    const found = await findChatsInWindow({ userId: 'u1', window: TODAY })
    expect(findByUserId).toHaveBeenCalledWith('u1')
    expect(found.map(c => c.id)).toEqual(['current', 'late', 'early'])
  })

  it('answers empty when the read fails', async () => {
    mockRepos.mockReturnValue({ chats: { findByCharacterId: jest.fn(async () => { throw new Error('boom') }) } })
    expect(await findChatsInWindow({ characterId: 'c1', userId: 'u1', window: TODAY })).toEqual([])
  })
})

describe('searchConversationChunks — chatIds', () => {
  const chunk = (id: string, chatId: string, score: number) => ({
    id, chatId, interchangeIndex: 0, content: `chunk ${id}`, participantNames: [], embedding: new Float32Array([score, 0]),
  })

  beforeEach(() => {
    mockRepos.mockReturnValue({
      chats: {
        findByCharacterId: jest.fn(async () => [
          chat('in', '2026-11-03T22:00:00.000Z', '2026-11-03T23:00:00.000Z'),
          chat('out', '2026-09-03T22:00:00.000Z', '2026-09-03T23:00:00.000Z'),
        ]),
      },
      conversationChunks: {
        findAllWithEmbeddings: jest.fn(async () => [chunk('a', 'out', 0.9), chunk('b', 'in', 0.1), chunk('c', 'foreign', 0.95)]),
      },
    })
  })

  it('never scores chunks from chats outside the set', async () => {
    const hits = await searchConversationChunks(new Float32Array([1, 0]), { characterId: 'c1', chatIds: new Set(['in']), minScore: 0 })
    expect(hits.map(h => h.chunkId)).toEqual(['b'])
  })

  it('honours an explicit minScore of 0 (not the 0.3 default)', async () => {
    const floored = await searchConversationChunks(new Float32Array([1, 0]), { characterId: 'c1', chatIds: new Set(['in']) })
    expect(floored).toEqual([])
  })

  it('without chatIds, searches every chat of the character as before', async () => {
    const hits = await searchConversationChunks(new Float32Array([1, 0]), { characterId: 'c1' })
    expect(hits.map(h => h.chunkId)).toEqual(['a'])
  })
})
