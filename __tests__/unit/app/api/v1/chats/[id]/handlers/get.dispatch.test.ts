/**
 * `GET /api/v1/chats/[id]` dispatches its `?action=` through `dispatchAction`.
 *
 * The handler used to walk a ladder of `if (action === '…')` blocks and let
 * anything it did not recognise fall through to the default "get chat" body,
 * so a typo in a client URL was served the whole chat instead of an error.
 * These tests pin the three outcomes: no action runs the default, a known
 * action runs its handler (and nothing else), and an unknown or empty action
 * is a 400 that names the registered actions.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/logger', () => {
  const child: Record<string, jest.Mock> = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
  child.child = jest.fn(() => child)
  return { logger: child }
})

jest.mock('@/lib/sillytavern/chat', () => ({
  exportSTChatAsJSONL: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  getChatCostBreakdown: jest.fn().mockResolvedValue({ totalCost: 0.25 }),
  getDetailedChatCostBreakdown: jest.fn().mockResolvedValue({ totalCost: 0.25, messages: [] }),
}))

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantDetail: jest.fn(async (participant: unknown) => participant),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  resolveAgentModeSetting: jest.fn(() => ({ enabled: false, enabledSource: 'global' })),
}))

jest.mock('@/lib/terminal/reconcile', () => ({
  reconcileTerminalSessionsForChat: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/post-office/surface-operator-mail', () => ({
  surfaceOperatorMailForChat: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/scriptorium/cold-chunk-reembed', () => ({
  maybeEnqueueColdChunkReembed: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/chat/transcript-projection', () => ({
  projectChatTranscript: jest.fn().mockResolvedValue({ messages: [], offSceneCharacters: [] }),
}))

jest.mock('@/lib/photos/chat-gallery', () => ({
  getChatGallery: jest.fn().mockResolvedValue({ images: [], total: 0, counts: {} }),
}))

jest.mock('@/app/api/v1/chats/[id]/actions', () => ({
  handleGetAvatars: jest.fn(),
  handleGetState: jest.fn(),
  handleGetOutfit: jest.fn(),
  handleGetOutfitSummary: jest.fn(),
  handleGetPhotoAlbums: jest.fn(),
  handleGetGroupStores: jest.fn(),
  handleAccessibleStores: jest.fn(),
  handleGetMailbox: jest.fn(),
  handleExportMarkdown: jest.fn(),
  handleGetInforms: jest.fn(),
  handleGetStoryBackground: jest.fn(),
}))

import { handleGet } from '@/app/api/v1/chats/[id]/handlers/get'
import * as actions from '@/app/api/v1/chats/[id]/actions'
import { getChatCostBreakdown } from '@/lib/services/cost-estimation.service'
import { projectChatTranscript } from '@/lib/chat/transcript-projection'

const CHAT_ID = 'chat-1'

const GET_ACTIONS = [
  'export',
  'export-markdown',
  'get-avatars',
  'get-state',
  'outfit',
  'outfit-summary',
  'photo-albums',
  'informs',
  'group-stores',
  'mailbox',
  'accessible-stores',
  'get-background',
  'gallery',
  'cost',
]

function buildCtx() {
  return {
    user: { id: 'user-1', name: 'Test User', image: null },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue({
          id: CHAT_ID,
          userId: 'user-1',
          title: 'Test Chat',
          participants: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getMessages: jest.fn().mockResolvedValue([]),
        getTranscriptVersion: jest.fn().mockResolvedValue(3),
        getModerationRefusalLedger: jest.fn().mockResolvedValue({ count: 0, lastAt: null }),
      },
      projects: { findById: jest.fn() },
      characters: { findById: jest.fn(), findByIds: jest.fn().mockResolvedValue([]) },
      chatSettings: { findByUserId: jest.fn().mockResolvedValue({}) },
    },
  } as any
}

function reqFor(query: string) {
  return new NextRequest(`http://localhost:3000/api/v1/chats/${CHAT_ID}${query}`)
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('runs the default get-chat body when there is no ?action=', async () => {
  const ctx = buildCtx()
  const response = await handleGet(reqFor(''), ctx, CHAT_ID)
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.chat.id).toBe(CHAT_ID)
  expect(body.chat.transcriptVersion).toBe(3)
  expect(projectChatTranscript).toHaveBeenCalledTimes(1)
  for (const handler of Object.values(actions)) {
    if (typeof handler === 'function') expect(handler).not.toHaveBeenCalled()
  }
})

it('routes a known action to its handler and nothing else', async () => {
  const ctx = buildCtx()
  const marker = { __kind: 'outfit' } as any
  ;(actions.handleGetOutfit as jest.Mock).mockResolvedValue(marker)

  const response = await handleGet(reqFor('?action=outfit'), ctx, CHAT_ID)

  expect(response).toBe(marker)
  expect(actions.handleGetOutfit).toHaveBeenCalledWith(CHAT_ID, ctx)
  expect(projectChatTranscript).not.toHaveBeenCalled()
  expect(getChatCostBreakdown).not.toHaveBeenCalled()
})

it('passes the mailbox request through and reads ?all= for accessible-stores', async () => {
  const ctx = buildCtx()
  ;(actions.handleGetMailbox as jest.Mock).mockResolvedValue({ __kind: 'mailbox' })
  ;(actions.handleAccessibleStores as jest.Mock).mockResolvedValue({ __kind: 'stores' })

  const mailboxReq = reqFor('?action=mailbox&characterId=char-1')
  await handleGet(mailboxReq, ctx, CHAT_ID)
  expect(actions.handleGetMailbox).toHaveBeenCalledWith(mailboxReq, CHAT_ID, ctx)

  await handleGet(reqFor('?action=accessible-stores&all=true'), ctx, CHAT_ID)
  expect(actions.handleAccessibleStores).toHaveBeenLastCalledWith(CHAT_ID, ctx, { all: true })

  await handleGet(reqFor('?action=accessible-stores'), ctx, CHAT_ID)
  expect(actions.handleAccessibleStores).toHaveBeenLastCalledWith(CHAT_ID, ctx, { all: false })
})

it('runs an inline action (cost) with the request it needs', async () => {
  const ctx = buildCtx()
  const response = await handleGet(reqFor('?action=cost'), ctx, CHAT_ID)
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body).toEqual({ totalCost: 0.25 })
  expect(getChatCostBreakdown).toHaveBeenCalledWith(CHAT_ID, 'user-1')
  expect(projectChatTranscript).not.toHaveBeenCalled()
})

it('answers 400 with availableActions for an unknown action instead of the chat', async () => {
  const ctx = buildCtx()
  const response = await handleGet(reqFor('?action=galery'), ctx, CHAT_ID)
  const body = await response.json()

  expect(response.status).toBe(400)
  expect(body.error).toBe('Unknown action: galery')
  expect(body.availableActions).toEqual(GET_ACTIONS)
  expect(projectChatTranscript).not.toHaveBeenCalled()
  expect(ctx.repos.chats.findById).not.toHaveBeenCalled()
})

it('treats a bare ?action= as unknown, not as the default', async () => {
  const ctx = buildCtx()
  const response = await handleGet(reqFor('?action='), ctx, CHAT_ID)
  const body = await response.json()

  expect(response.status).toBe(400)
  expect(body.availableActions).toEqual(GET_ACTIONS)
  expect(projectChatTranscript).not.toHaveBeenCalled()
})
