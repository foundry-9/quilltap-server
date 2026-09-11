/**
 * `GET /api/v1/messages?chatId=…&action=transcript` — the conditional read.
 *
 * This is the Salon's authoritative delivery path, driven by a realtime
 * `{topic:'chats', id}` hint. The conditional is not an optimisation: one busy
 * turn fires wardrobe, backdrop, whisper and memory hints at the same topic, and
 * a single Commonplace whisper can run to 17 KB. A hint storm has to cost round
 * trips, not payloads.
 *
 * These pin the three answers the endpoint can give — unchanged, the whole
 * transcript, and "no such chat" — and that the projection is never built for a
 * read that is going to answer "unchanged".
 */

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => {
    return async (req: any) => handler(req, mockCtx)
  },
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  successResponse: (data: any, status = 200) => ({ body: data, status }),
}))

jest.mock('@/lib/services/chat-message', () => ({
  handleSendMessage: jest.fn(),
  sendMessageSchema: { safeParse: jest.fn() },
  continueMessageSchema: { safeParse: jest.fn() },
  buildSendMessageOptions: jest.fn(),
  buildContinueMessageOptions: jest.fn(),
  sseStreamResponse: jest.fn(),
}))

const projectChatTranscript = jest.fn()
jest.mock('@/lib/chat/transcript-projection', () => ({
  projectChatTranscript: (...args: unknown[]) => projectChatTranscript(...args),
}))

import { GET } from '@/app/api/v1/messages/route'

const CHAT_ID = '9be06466-0000-4000-8000-000000000000'
const OWNER_ID = 'user-1'

/** A request for the transcript action, with an optional `knownVersion`. */
function transcriptRequest(knownVersion?: number, chatId: string = CHAT_ID) {
  const params = new URLSearchParams({ chatId, action: 'transcript' })
  if (knownVersion !== undefined) params.set('knownVersion', String(knownVersion))
  return { nextUrl: { searchParams: params } } as any
}

function setChat(chat: Record<string, unknown> | null) {
  mockCtx = {
    user: { id: OWNER_ID },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue(chat),
        getMessages: jest.fn().mockResolvedValue([]),
      },
    },
  }
}

beforeEach(() => {
  projectChatTranscript.mockReset()
  projectChatTranscript.mockResolvedValue({
    messages: [{ id: 'm1', role: 'ASSISTANT', content: 'As you like.' }],
    offSceneCharacters: [],
  })
  setChat({ id: CHAT_ID, userId: OWNER_ID, transcriptVersion: 5 })
})

describe('transcript action', () => {
  it('answers "unchanged" without projecting anything', async () => {
    const res: any = await GET(transcriptRequest(5))
    expect(res.body).toEqual({ unchanged: true, version: 5 })
    expect(projectChatTranscript).not.toHaveBeenCalled()
  })

  it('returns the whole transcript when the version has moved', async () => {
    const res: any = await GET(transcriptRequest(4))
    expect(res.body.unchanged).toBe(false)
    expect(res.body.version).toBe(5)
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.count).toBe(1)
  })

  it('returns the whole transcript when no version is offered — the first read', async () => {
    const res: any = await GET(transcriptRequest())
    expect(res.body.unchanged).toBe(false)
    expect(projectChatTranscript).toHaveBeenCalledTimes(1)
  })

  it('ignores a version that is not an integer rather than trusting it', async () => {
    const req = { nextUrl: { searchParams: new URLSearchParams({ chatId: CHAT_ID, action: 'transcript', knownVersion: 'five' }) } } as any
    const res: any = await GET(req)
    expect(res.body.unchanged).toBe(false)
  })

  it('treats a chat row with no counter yet as version 0', async () => {
    setChat({ id: CHAT_ID, userId: OWNER_ID })
    const res: any = await GET(transcriptRequest(0))
    expect(res.body).toEqual({ unchanged: true, version: 0 })
  })

  it('carries the off-scene author cards the renderer needs for an avatar', async () => {
    projectChatTranscript.mockResolvedValue({
      messages: [],
      offSceneCharacters: [{ id: 'c1', name: 'Abigail', title: null, avatarUrl: null }],
    })
    const res: any = await GET(transcriptRequest())
    expect(res.body.offSceneCharacters).toHaveLength(1)
  })

  it('404s for a chat this user cannot see', async () => {
    setChat(null)
    const res: any = await GET(transcriptRequest(5))
    expect(res).toMatchObject({ __kind: 'notFound' })
  })

  it('requires a chatId', async () => {
    const req = { nextUrl: { searchParams: new URLSearchParams({ action: 'transcript' }) } } as any
    const res: any = await GET(req)
    expect(res).toMatchObject({ __kind: 'badRequest' })
  })
})

describe('the plain listing still answers', () => {
  it('returns stored message events when no action is given', async () => {
    mockCtx.repos.chats.getMessages.mockResolvedValue([
      { type: 'message', id: 'm1', content: 'hi' },
      { type: 'context-summary', id: 's1' },
    ])
    const req = { nextUrl: { searchParams: new URLSearchParams({ chatId: CHAT_ID }) } } as any
    const res: any = await GET(req)
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.count).toBe(1)
  })
})
