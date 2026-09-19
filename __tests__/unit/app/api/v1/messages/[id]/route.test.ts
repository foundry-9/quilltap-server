/**
 * Regression tests for the per-message edit/delete endpoints (commit b996d2eb).
 *
 * The old path located a message by loading and Zod-validating every message in
 * every chat, then SAVED by clearing the whole chat and re-inserting the
 * survivors one at a time — which silently dropped any sibling message that
 * failed validation (latent data loss) and was O(n²). The fix resolves the
 * owning chat with a single indexed lookup (findChatIdForMessage), enforces the
 * per-user ownership the account-wide scan used to give for free, and mutates
 * only the targeted row via updateMessage / deleteMessagesByIds.
 *
 * These tests pin: (1) edits/deletes NEVER call clearMessages/addMessage, only
 * the targeted single-row ops; (2) a message in another user's chat is not
 * reachable; (3) an unknown message id 404s without loading any chat.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) => {
    return async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params)
  },
  getActionParam: jest.fn(() => null),
}))

jest.mock('@/lib/api/responses', () => ({
  notFound: (what: string) => ({ __kind: 'notFound', status: 404, what }),
  badRequest: (msg: string) => ({ __kind: 'badRequest', status: 400, msg }),
  serverError: (msg: string) => ({ __kind: 'serverError', status: 500, msg }),
  // Mirror the real helpers through the global next/server mock: the payload
  // lands on `.body`, exactly as the raw NextResponse.json calls used to.
  successResponse: (data: any, status = 200) => ({ body: data, status }),
  created: (data: any) => ({ body: data, status: 201 }),
}))

jest.mock('@/lib/services/chat-message', () => ({
  regenerateMessageAsSwipe: jest.fn(),
  // The SSE encoders are thin `TextEncoder` wrappers in the real module; the
  // fakes keep the frame shape so a test can read the stream back as JSON.
  encodeContentChunk: (enc: TextEncoder, content: string) => enc.encode(`data: ${JSON.stringify({ content })}\n\n`),
  encodeReasoningChunk: (enc: TextEncoder, reasoning: string) => enc.encode(`data: ${JSON.stringify({ reasoning })}\n\n`),
  encodeStatusEvent: (enc: TextEncoder, status: any) => enc.encode(`data: ${JSON.stringify({ status })}\n\n`),
  encodeErrorEvent: (enc: TextEncoder, error: string, errorType: string, details: string) =>
    enc.encode(`data: ${JSON.stringify({ error, errorType, details })}\n\n`),
  safeEnqueue: (controller: any, data: any) => { controller.enqueue(data); return true },
  safeClose: (controller: any) => { controller.close() },
  sseStreamResponse: (stream: any) => ({ __kind: 'sse', stream }),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  deleteMemoriesBySourceMessagesWithVectors: jest.fn().mockResolvedValue({ deleted: 0, vectorsRemoved: 0 }),
  deleteMemoryWithVector: jest.fn(),
}))

jest.mock('@/lib/chat/context-summary', () => ({
  invalidateContextSummaryIfMessageCovered: jest.fn().mockResolvedValue(undefined),
}))

import { PUT, DELETE, POST } from '@/app/api/v1/messages/[id]/route'
import { regenerateMessageAsSwipe } from '@/lib/services/chat-message'
import { getActionParam } from '@/lib/api/middleware'

const MESSAGE_ID = 'msg-1'
const CHAT_ID = 'chat-1'
const OWNER_ID = 'user-1'

function buildMessage(overrides: Record<string, any> = {}) {
  return { type: 'message', id: MESSAGE_ID, content: 'original', participantId: 'p1', ...overrides }
}

function buildRepos(overrides: Record<string, any> = {}) {
  return {
    chats: {
      findChatIdForMessage: jest.fn().mockResolvedValue(CHAT_ID),
      findById: jest.fn().mockResolvedValue({ id: CHAT_ID, userId: OWNER_ID }),
      getMessages: jest.fn().mockResolvedValue([buildMessage()]),
      updateMessage: jest.fn().mockResolvedValue(buildMessage({ content: 'edited' })),
      deleteMessagesByIds: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      // Legacy clear-and-rewrite ops — must never be touched by the new path.
      clearMessages: jest.fn().mockResolvedValue(undefined),
      addMessage: jest.fn().mockResolvedValue(undefined),
      ...overrides.chats,
    },
    memories: {
      countBySourceMessageIds: jest.fn().mockResolvedValue(0),
      ...overrides.memories,
    },
  }
}

function putReq(content: string) {
  return { json: async () => ({ content }) }
}

function deleteReq() {
  return { nextUrl: { searchParams: new URLSearchParams() } }
}

const params = { params: Promise.resolve({ id: MESSAGE_ID }) }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PUT /api/v1/messages/[id] — edit', () => {
  it('updates only the targeted row and never clears/rewrites the chat', async () => {
    const repos = buildRepos()
    mockCtx = { user: { id: OWNER_ID }, repos }

    const res: any = await PUT(putReq('edited'), params)

    expect(repos.chats.updateMessage).toHaveBeenCalledWith(CHAT_ID, MESSAGE_ID, { content: 'edited' })
    expect(repos.chats.clearMessages).not.toHaveBeenCalled()
    expect(repos.chats.addMessage).not.toHaveBeenCalled()
    // Response carries the updated message so the Salon bubble reflects the edit.
    expect(res.body?.message?.content ?? res?.message?.content).toBe('edited')
  })

  it('resolves the chat with a single indexed lookup, not an account-wide scan', async () => {
    const repos = buildRepos()
    mockCtx = { user: { id: OWNER_ID }, repos }

    await PUT(putReq('edited'), params)

    expect(repos.chats.findChatIdForMessage).toHaveBeenCalledWith(MESSAGE_ID)
    expect(repos.chats.findById).toHaveBeenCalledWith(CHAT_ID)
  })

  it("404s and does not mutate when the message belongs to another user's chat", async () => {
    const repos = buildRepos({ chats: { findById: jest.fn().mockResolvedValue({ id: CHAT_ID, userId: 'someone-else' }) } })
    mockCtx = { user: { id: OWNER_ID }, repos }

    const res: any = await PUT(putReq('edited'), params)

    expect(res.__kind).toBe('notFound')
    expect(repos.chats.updateMessage).not.toHaveBeenCalled()
  })

  it('404s when the message id resolves to no chat, without loading any chat', async () => {
    const repos = buildRepos({ chats: { findChatIdForMessage: jest.fn().mockResolvedValue(null) } })
    mockCtx = { user: { id: OWNER_ID }, repos }

    const res: any = await PUT(putReq('edited'), params)

    expect(res.__kind).toBe('notFound')
    expect(repos.chats.getMessages).not.toHaveBeenCalled()
    expect(repos.chats.updateMessage).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/messages/[id]', () => {
  it('deletes only the targeted id and never clears/rewrites the chat', async () => {
    const repos = buildRepos()
    mockCtx = { user: { id: OWNER_ID }, repos }

    await DELETE(deleteReq(), params)

    expect(repos.chats.deleteMessagesByIds).toHaveBeenCalledWith(CHAT_ID, [MESSAGE_ID])
    expect(repos.chats.clearMessages).not.toHaveBeenCalled()
    expect(repos.chats.addMessage).not.toHaveBeenCalled()
  })

  it('deletes the whole swipe group by id when the target has a swipeGroupId', async () => {
    const messages = [
      buildMessage({ id: 'a', swipeGroupId: 'g1' }),
      buildMessage({ id: MESSAGE_ID, swipeGroupId: 'g1' }),
      buildMessage({ id: 'c', swipeGroupId: 'g2' }),
    ]
    const repos = buildRepos({ chats: { getMessages: jest.fn().mockResolvedValue(messages) } })
    mockCtx = { user: { id: OWNER_ID }, repos }

    await DELETE(deleteReq(), params)

    const [, ids] = repos.chats.deleteMessagesByIds.mock.calls[0]
    expect(new Set(ids)).toEqual(new Set(['a', MESSAGE_ID]))
    expect(repos.chats.clearMessages).not.toHaveBeenCalled()
  })
})


// jsdom has no WHATWG streams; the SSE handler builds a real ReadableStream.
// Borrow Node's, rather than moving the whole file to the node environment and
// disturbing the edit/delete tests above.
if (typeof (globalThis as any).ReadableStream === 'undefined') {
  ;(globalThis as any).ReadableStream = require('node:stream/web').ReadableStream
}

/**
 * Streaming regeneration. The Salon dims the line being replaced and fills it
 * back in as the new one arrives, which only works if the server narrates the
 * re-roll instead of going quiet until it is finished.
 */
describe('POST /api/v1/messages/[id]?action=swipe&stream=1', () => {
  function swipeReq(stream: boolean) {
    return {
      json: async () => ({}),
      nextUrl: { searchParams: new URLSearchParams(stream ? 'stream=1' : '') },
    }
  }

  async function readStream(stream: ReadableStream<Uint8Array>): Promise<any[]> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    return text
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)))
  }

  beforeEach(() => {
    ;(getActionParam as jest.Mock).mockReturnValue('swipe')
  })

  it('forwards every progress event and ends with the persisted swipe', async () => {
    const repos = buildRepos({
      chats: { getMessages: jest.fn().mockResolvedValue([buildMessage({ role: 'ASSISTANT' })]) },
    })
    mockCtx = { user: { id: OWNER_ID }, repos }

    const newSwipe = { type: 'message', id: 'swipe-1', content: 'the new line' }
    ;(regenerateMessageAsSwipe as jest.Mock).mockImplementation(async ({ onProgress }: any) => {
      onProgress({ kind: 'status', stage: 'gathering', message: 'Regenerating — gathering...' })
      onProgress({ kind: 'delta', content: 'the new ' })
      onProgress({ kind: 'delta', content: 'line' })
      onProgress({ kind: 'reasoning', reasoning: 'thinking about it' })
      return newSwipe
    })

    const res: any = await POST(swipeReq(true), params)
    expect(res.__kind).toBe('sse')

    const events = await readStream(res.stream)
    expect(events[0].status.stage).toBe('gathering')
    expect(events.filter(e => e.content).map(e => e.content)).toEqual(['the new ', 'line'])
    expect(events.find(e => e.reasoning)?.reasoning).toBe('thinking about it')
    expect(events.at(-1)).toEqual({ done: true, message: newSwipe })
  })

  it('reports a mid-stream failure as an error event, not a dropped connection', async () => {
    const repos = buildRepos({
      chats: { getMessages: jest.fn().mockResolvedValue([buildMessage({ role: 'ASSISTANT' })]) },
    })
    mockCtx = { user: { id: OWNER_ID }, repos }
    ;(regenerateMessageAsSwipe as jest.Mock).mockRejectedValue(new Error('provider went quiet'))

    const res: any = await POST(swipeReq(true), params)
    const events = await readStream(res.stream)

    expect(events.at(-1).error).toBe('Failed to generate alternative response')
    expect(events.at(-1).details).toBe('provider went quiet')
  })

  it('refuses a staff message before the stream opens, as an ordinary JSON error', async () => {
    const repos = buildRepos({
      chats: {
        getMessages: jest.fn().mockResolvedValue([buildMessage({ role: 'ASSISTANT', systemSender: 'host' })]),
      },
    })
    mockCtx = { user: { id: OWNER_ID }, repos }

    const res: any = await POST(swipeReq(true), params)

    expect(res.__kind).toBe('badRequest')
    expect(regenerateMessageAsSwipe).not.toHaveBeenCalled()
  })

  it('still answers with JSON when the caller does not ask for a stream', async () => {
    const repos = buildRepos({
      chats: { getMessages: jest.fn().mockResolvedValue([buildMessage({ role: 'ASSISTANT' })]) },
    })
    mockCtx = { user: { id: OWNER_ID }, repos }
    ;(regenerateMessageAsSwipe as jest.Mock).mockResolvedValue({ id: 'swipe-1' })

    const res: any = await POST(swipeReq(false), params)

    expect(res.status).toBe(201)
    expect(res.body.message).toEqual({ id: 'swipe-1' })
  })
})
