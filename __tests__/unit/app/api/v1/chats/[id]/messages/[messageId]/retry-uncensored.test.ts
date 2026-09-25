/**
 * POST /api/v1/chats/[id]/messages/[messageId]?action=retry-uncensored
 *
 * "Try uncensored" on a text line (concierge-overhaul phase 5): a regenerate of
 * the target on the Concierge's uncensored understudy, as a new swipe whose
 * trail ends via the Concierge. 409 when the chat is Locked or nobody can take
 * it; the chat's state is never written.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

const mockCtx: { user: { id: string }; repos: any } = { user: { id: 'user-1' }, repos: null }
jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
    async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params),
}))
jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerTurnMemoryExtraction: jest.fn(),
  triggerChatDangerClassification: jest.fn(),
  triggerContextSummaryCheck: jest.fn(),
}))
jest.mock('@/lib/photos/save-image-to-album', () => ({
  saveImageToAlbum: jest.fn(),
  SaveImageToAlbumError: class extends Error {},
  SaveImageRequestSchema: { safeParse: jest.fn() },
}))
jest.mock('@/lib/photos/save-attribution', () => ({ resolveSaveAttribution: jest.fn() }))
jest.mock('@/lib/services/chat-message', () => ({
  regenerateMessageAsSwipe: jest.fn(),
  streamSwipeRegeneration: jest.fn(() => ({ __kind: 'sse' })),
}))
jest.mock('@/lib/services/dangerous-content/retry-uncensored', () => ({
  ...jest.requireActual('@/lib/services/dangerous-content/retry-uncensored'),
  resolveTextRetryUnderstudy: jest.fn(),
}))

import { POST } from '@/app/api/v1/chats/[id]/messages/[messageId]/route'
import { regenerateMessageAsSwipe, streamSwipeRegeneration } from '@/lib/services/chat-message'
import { resolveTextRetryUnderstudy } from '@/lib/services/dangerous-content/retry-uncensored'

const mockRegenerate = jest.mocked(regenerateMessageAsSwipe)
const mockStream = jest.mocked(streamSwipeRegeneration)
const mockGate = jest.mocked(resolveTextRetryUnderstudy)

const UNDERSTUDY = {
  profile: { id: 'desk-1', name: 'The Back Room', provider: 'OPENROUTER', modelName: 'free-model' },
  apiKey: 'sk-desk',
}

const CHAT = { id: 'chat-1', conciergeMode: 'moderated', participants: [], activeTypingParticipantId: null }
const TARGET = {
  type: 'message', id: 'msg-1', role: 'ASSISTANT', content: 'I would rather not.', participantId: 'seat-1',
  createdAt: '2026-09-25T00:00:00.000Z',
}

function request(stream = false): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/chats/chat-1/messages/msg-1?action=retry-uncensored${stream ? '&stream=1' : ''}`,
    { method: 'POST' },
  )
}

async function call(stream = false, messageId = 'msg-1') {
  return POST(request(stream), { params: Promise.resolve({ id: 'chat-1', messageId }) } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx.repos = {
    chats: {
      findById: jest.fn().mockResolvedValue(CHAT),
      getMessages: jest.fn().mockResolvedValue([TARGET]),
      update: jest.fn(),
      setConciergeMode: jest.fn(),
    },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
  }
})

it('409 no-understudy when there is nobody to send it to', async () => {
  mockGate.mockResolvedValue({ ok: false, reason: 'no-understudy' })
  const res = await call()
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'no-understudy' })
  expect(mockRegenerate).not.toHaveBeenCalled()
})

it('409 locked on a Locked chat', async () => {
  mockGate.mockResolvedValue({ ok: false, reason: 'locked' })
  const res = await call()
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'locked' })
})

it('regenerates as a swipe on the understudy, trail via the Concierge, and leaves the chat\'s state alone', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  mockRegenerate.mockResolvedValue({ id: 'swipe-1' } as never)

  const res = await call()

  expect(res.status).toBe(201)
  const options = mockRegenerate.mock.calls[0][0]
  expect(options.profileOverride).toBe(UNDERSTUDY)
  expect(options.targetMessage).toMatchObject({ id: 'msg-1' })
  expect(options.routeTrail).toEqual([
    expect.objectContaining({ profileId: 'desk-1', via: 'concierge', outcome: 'answered' }),
  ])
  expect(mockCtx.repos.chats.update).not.toHaveBeenCalled()
  expect(mockCtx.repos.chats.setConciergeMode).not.toHaveBeenCalled()
})

it('narrates on the regeneration stream when asked', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  await call(true)
  expect(mockStream).toHaveBeenCalledWith(
    expect.objectContaining({ profileOverride: UNDERSTUDY }),
    expect.any(String),
  )
  expect(mockRegenerate).not.toHaveBeenCalled()
})

it('404 for an unknown message', async () => {
  const res = await call(false, 'nope')
  expect(res.status).toBe(404)
  expect(mockGate).not.toHaveBeenCalled()
})

it('refuses a Staff message', async () => {
  mockCtx.repos.chats.getMessages.mockResolvedValue([{ ...TARGET, systemSender: 'lantern' }])
  const res = await call()
  expect(res.status).toBe(400)
})
