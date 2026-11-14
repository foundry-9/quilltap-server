/**
 * POST /api/v1/chats — the HTTP edge of casting. Casting itself is tested in
 * `__tests__/unit/lib/chat/opening/cast.test.ts`; here only the route's own
 * job: parse, hand to `castChat`, answer 201 with the chat `'pending'`, and
 * map a refusal to its status.
 *
 * Uses the global `jest` so jest.mock(...) calls hoist above the imports.
 */

jest.mock('@/lib/chat/opening/cast', () => ({ castChat: jest.fn() }))
jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantSummary: jest.fn((p: unknown) => Promise.resolve(p)),
  enrichChatsForList: jest.fn((chats: unknown) => chats),
  filterChatsByExcludedTags: jest.fn((chats: unknown) => chats),
  cleanEnrichedChats: jest.fn((chats: unknown) => chats),
}))

import { POST } from '@/app/api/v1/chats/route'
import { castChat } from '@/lib/chat/opening/cast'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '@/__tests__/unit/lib/fixtures/mock-repositories'

const CHAR = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  const url = 'http://localhost:3000/api/v1/chats'
  return { url, method: 'POST', nextUrl: new URL(url), headers: new Map(), json: async () => body } as never
}

const body = (seat: Record<string, unknown> = {}) => ({
  participants: [{ type: 'CHARACTER', characterId: CHAR, connectionProfileId: PROFILE, ...seat }],
})

describe('POST /api/v1/chats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const repos = createMockRepositoryContainer()
    setupAuthMocks(getServerSession as unknown as jest.Mock, repos, { id: 'user-1', email: 'u@example.com', name: 'U' } as never)
    ;(getRepositoriesSafe as unknown as jest.Mock).mockResolvedValue(repos)
    ;(getRepositories as unknown as jest.Mock).mockReturnValue(repos)
  })

  it('casts the chat and answers 201 with it waiting to be opened', async () => {
    ;(castChat as jest.Mock).mockResolvedValue({ ok: true, chat: { id: 'chat-1', title: 'Chat with Alice', participants: [] } })
    const res = await POST(request(body()), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.chat).toMatchObject({ id: 'chat-1', openingState: 'pending' })
    expect(castChat).toHaveBeenCalledWith(expect.objectContaining({ participants: [expect.objectContaining({ characterId: CHAR })] }), expect.objectContaining({ userId: 'user-1' }))
  })

  it('maps a refusal to its status', async () => {
    ;(castChat as jest.Mock).mockResolvedValue({ ok: false, refusal: { status: 404, message: 'Source chat not found' } })
    expect((await POST(request(body()), { params: Promise.resolve({}) } as never)).status).toBe(404)
    ;(castChat as jest.Mock).mockResolvedValue({ ok: false, refusal: { status: 400, message: 'Roleplay template not found' } })
    expect((await POST(request(body()), { params: Promise.resolve({}) } as never)).status).toBe(400)
  })

  it('refuses a seat carrying the retired per-seat imageProfileId (the participant object is strict)', async () => {
    const res = await POST(request(body({ imageProfileId: PROFILE })), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(400)
    expect(castChat).not.toHaveBeenCalled()
  })
})
