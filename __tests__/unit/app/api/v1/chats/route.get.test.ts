/**
 * GET /api/v1/chats — list only.
 *
 * The collection's one GET action (`has-dangerous`) was removed once the
 * sidebar's quick-hide button stopped needing it, so GET now lists chats and
 * rejects any `?action=` — including an empty one — with a 400 rather than
 * quietly listing.
 *
 * Uses the global `jest` (not @jest/globals) so jest.mock(...) calls hoist
 * above the ES module imports under the SWC transform.
 */

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantSummary: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
  enrichChatsForList: jest.fn().mockImplementation((chats: unknown) => chats),
  filterChatsByExcludedTags: jest.fn().mockImplementation((chats: unknown) => chats),
  cleanEnrichedChats: jest.fn().mockImplementation((chats: unknown) => chats),
}))

import { GET } from '@/app/api/v1/chats/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import {
  createMockRepositoryContainer,
  setupAuthMocks,
  type MockRepositoryContainer,
} from '@/__tests__/unit/lib/fixtures/mock-repositories'

const USER_ID = 'c1111111-1111-4111-8111-111111111111'

function createMockRequest(query = '') {
  const url = `http://localhost:3000/api/v1/chats${query}`
  return {
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: new Map(),
  } as any
}

describe('GET /api/v1/chats', () => {
  let mockRepos: MockRepositoryContainer

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepositoryContainer()
    setupAuthMocks(getServerSession as unknown as jest.Mock, mockRepos, {
      id: USER_ID,
      email: 'user@example.com',
      name: 'Test User',
    } as any)
    ;(getRepositoriesSafe as unknown as jest.Mock).mockResolvedValue(mockRepos)
    ;(getRepositories as unknown as jest.Mock).mockReturnValue(mockRepos)
    ;(mockRepos.chats as any).findByUserId = jest.fn().mockResolvedValue([
      { id: 'chat-1', chatType: 'salon', title: 'A salon chat' },
    ])
  })

  it('lists chats when no action is given', async () => {
    const res = await GET(createMockRequest(), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.chats).toHaveLength(1)
    expect(mockRepos.chats.findByUserId).toHaveBeenCalledWith(USER_ID)
  })

  it.each([
    ['the removed has-dangerous action', '?action=has-dangerous'],
    ['an empty action', '?action='],
    ['a bare action key', '?action'],
  ])('rejects %s with a 400 and does not list', async (_label, query) => {
    const res = await GET(createMockRequest(query), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(mockRepos.chats.findByUserId).not.toHaveBeenCalled()
  })
})
