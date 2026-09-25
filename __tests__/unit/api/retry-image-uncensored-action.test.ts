/**
 * POST /api/v1/chats/[id]?action=retry-image-uncensored
 *
 * "Try uncensored" on a picture (concierge-overhaul phase 5): the same
 * generate_image arguments, redrawn on the uncensored understudy, posted as a
 * new TOOL message beside the original with a trail via the Concierge; or a
 * story background queued with `forceUncensored`.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})
jest.mock('@/lib/tools/handlers/image-generation-handler', () => ({
  executeImageGenerationTool: jest.fn(),
}))
jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  saveToolMessages: jest.fn().mockResolvedValue({ firstToolMessageId: 'tool-new', generatedImageIds: ['img-9'] }),
}))
jest.mock('@/lib/services/dangerous-content/retry-uncensored', () => ({
  ...jest.requireActual('@/lib/services/dangerous-content/retry-uncensored'),
  resolveImageRetryUnderstudy: jest.fn(),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveImageProfileForChat: jest.fn().mockResolvedValue('img-profile-1'),
}))
jest.mock('@/app/api/v1/chats/[id]/actions/story-background', () => ({
  handleRegenerateBackground: jest.fn().mockResolvedValue({ status: 200, __kind: 'queued' }),
}))

import { handleRetryImageUncensored } from '@/app/api/v1/chats/[id]/actions/retry-image-uncensored'
import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler'
import { saveToolMessages } from '@/lib/services/chat-message/tool-execution.service'
import { resolveImageRetryUnderstudy } from '@/lib/services/dangerous-content/retry-uncensored'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { handleRegenerateBackground } from '@/app/api/v1/chats/[id]/actions/story-background'

const mockGenerate = jest.mocked(executeImageGenerationTool)
const mockSave = jest.mocked(saveToolMessages)
const mockGate = jest.mocked(resolveImageRetryUnderstudy)
const mockAnnounce = jest.mocked(postConciergeRefusalAnnouncement)
const mockRegenerateBackground = jest.mocked(handleRegenerateBackground)

const UNDERSTUDY = {
  profile: { id: 'desk-img', name: 'Kestrel Studio', provider: 'OPENROUTER', modelName: 'flux' },
  apiKey: 'sk-desk',
}

const CHAT = {
  id: 'chat-1',
  conciergeMode: 'moderated',
  imageProfileId: 'img-profile-1',
  participants: [{ id: 'seat-1', type: 'CHARACTER', characterId: 'char-1' }],
} as never

const REFUSED_TOOL = {
  type: 'message',
  id: 'tool-1',
  role: 'TOOL',
  participantId: 'seat-1',
  createdAt: '2026-09-25T12:00:00.000Z',
  content: JSON.stringify({ toolName: 'generate_image', success: false, arguments: { prompt: 'a portrait of {{me}}' } }),
  routeTrail: [
    { profileId: 'img-profile-1', profileName: 'Gemini', provider: 'GOOGLE', modelName: 'imagen', via: 'primary', outcome: 'refused', profileKind: 'image' },
  ],
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/chats/chat-1?action=retry-image-uncensored', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function ctx(messages: unknown[] = [REFUSED_TOOL]) {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: {
        getMessages: jest.fn().mockResolvedValue(messages),
        update: jest.fn(),
        setConciergeMode: jest.fn(),
      },
      chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
    },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('404 for an unknown tool message', async () => {
  const res = await handleRetryImageUncensored(request({ toolMessageId: 'nope' }), 'chat-1', CHAT, ctx())
  expect(res.status).toBe(404)
  expect(mockGate).not.toHaveBeenCalled()
})

it('400 for a tool that is not generate_image', async () => {
  const other = { ...REFUSED_TOOL, content: JSON.stringify({ toolName: 'rng', arguments: {} }) }
  const res = await handleRetryImageUncensored(request({ toolMessageId: 'tool-1' }), 'chat-1', CHAT, ctx([other]))
  expect(res.status).toBe(400)
})

it('409 no-understudy when there is nobody to send it to', async () => {
  mockGate.mockResolvedValue({ ok: false, reason: 'no-understudy' })
  const res = await handleRetryImageUncensored(request({ toolMessageId: 'tool-1' }), 'chat-1', CHAT, ctx())
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'no-understudy' })
  expect(mockGenerate).not.toHaveBeenCalled()
})

it('redraws on the understudy and posts a new TOOL message beside the original, trail via the Concierge', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  mockGenerate.mockResolvedValue({
    success: true,
    images: [{ id: 'img-9', url: '/f/img-9', filename: 'x.webp', filepath: 'files/x.webp', mimeType: 'image/webp', size: 10 }],
    provider: 'OPENROUTER',
    model: 'flux',
    expandedPrompt: 'a portrait of Amy',
  } as never)

  const repoCtx = ctx()
  const res = await handleRetryImageUncensored(request({ toolMessageId: 'tool-1' }), 'chat-1', CHAT, repoCtx)

  expect(res.status).toBe(200)
  expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({
    excludeProfileIds: ['img-profile-1'],
    trail: REFUSED_TOOL.routeTrail,
  }))
  expect(mockGenerate).toHaveBeenCalledWith(
    { prompt: 'a portrait of {{me}}' },
    expect.objectContaining({ profileId: 'desk-img', primaryVia: 'concierge', callingParticipantId: 'seat-1' }),
  )

  const [, chatId, , toolMessages, images, characterId, participantId, , options] = mockSave.mock.calls[0]
  expect(chatId).toBe('chat-1')
  expect(images.map(i => i.id)).toEqual(['img-9'])
  expect(characterId).toBe('char-1')
  expect(participantId).toBe('seat-1')
  expect(options?.createdAt).toBe('2026-09-25T12:00:00.001Z')
  expect(toolMessages[0].metadata?.routeTrail?.map(a => [a.profileId, a.outcome, a.via])).toEqual([
    ['img-profile-1', 'refused', 'primary'],
    ['desk-img', 'answered', 'concierge'],
  ])

  expect(mockAnnounce).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'refusal-rerouted',
    details: expect.objectContaining({ purpose: 'tool', refusingProvider: 'GOOGLE', answeringProfileName: 'Kestrel Studio' }),
  }))
  // The chat's state is untouched.
  const repos = (repoCtx as unknown as { repos: { chats: { update: jest.Mock; setConciergeMode: jest.Mock } } }).repos
  expect(repos.chats.update).not.toHaveBeenCalled()
  expect(repos.chats.setConciergeMode).not.toHaveBeenCalled()
})

it('a soft refusal (a picture that "succeeded") is redrawn without an announcement', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  mockGenerate.mockResolvedValue({
    success: true,
    images: [{ id: 'img-9', url: '/f/img-9', filename: 'x.webp', filepath: 'files/x.webp' }],
  } as never)
  const delivered = { ...REFUSED_TOOL, routeTrail: null }

  const res = await handleRetryImageUncensored(request({ toolMessageId: 'tool-1' }), 'chat-1', CHAT, ctx([delivered]))

  expect(res.status).toBe(200)
  expect(mockAnnounce).not.toHaveBeenCalled()
})

it('reports a failed redraw without posting anything', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  mockGenerate.mockResolvedValue({ success: false, error: 'PROVIDER_ERROR', message: 'nope' } as never)

  const res = await handleRetryImageUncensored(request({ toolMessageId: 'tool-1' }), 'chat-1', CHAT, ctx())

  expect(res.status).toBe(502)
  expect(mockSave).not.toHaveBeenCalled()
})

it('queues the Lantern\'s backdrop with forceUncensored', async () => {
  mockGate.mockResolvedValue({ ok: true, understudy: UNDERSTUDY as never })
  const c = ctx()
  await handleRetryImageUncensored(request({ kind: 'background' }), 'chat-1', CHAT, c)
  expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({ excludeProfileIds: ['img-profile-1'] }))
  expect(mockRegenerateBackground).toHaveBeenCalledWith('chat-1', CHAT, c, { forceUncensored: true })
})

it('409 locked for the backdrop on a Locked chat', async () => {
  mockGate.mockResolvedValue({ ok: false, reason: 'locked' })
  const res = await handleRetryImageUncensored(request({ kind: 'background' }), 'chat-1', CHAT, ctx())
  expect(res.status).toBe(409)
  expect(mockRegenerateBackground).not.toHaveBeenCalled()
})
