import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mockRenderCourierRequestAsMarkdown = jest.fn()
const mockRenderCourierDeltaAsMarkdown = jest.fn()

const mockSafeEnqueue = jest.fn((controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => {
  controller.enqueue(chunk)
})
const mockEncodeDoneEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => ({ done: payload }))
const mockEncodePendingExternalTurnEvent = jest.fn((_encoder: TextEncoder, payload: unknown) => ({ pendingExternalTurn: payload }))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/llm/courier/render-markdown', () => ({
  renderCourierRequestAsMarkdown: (...args: any[]) => mockRenderCourierRequestAsMarkdown(...args),
  renderCourierDeltaAsMarkdown: (...args: any[]) => mockRenderCourierDeltaAsMarkdown(...args),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => mockSafeEnqueue(controller, chunk),
  encodeDoneEvent: (encoder: TextEncoder, payload: unknown) => mockEncodeDoneEvent(encoder, payload),
  encodePendingExternalTurnEvent: (encoder: TextEncoder, payload: unknown) => mockEncodePendingExternalTurnEvent(encoder, payload),
}))

const {
  dispatchCourierTransport,
} = require('@/lib/services/chat-message/courier-transport.service') as typeof import('@/lib/services/chat-message/courier-transport.service')

interface MakeReposOptions {
  messages?: any[]
  files?: Record<string, any>
}

function makeRepos(opts: MakeReposOptions = {}) {
  const addMessage = jest.fn(async (_chatId: string, _msg: unknown) => undefined)
  const update = jest.fn(async (_chatId: string, _patch: unknown) => undefined)
  const getMessages = jest.fn(async (_chatId: string) => opts.messages ?? [])
  const findById = jest.fn(async (fileId: string) => (opts.files ?? {})[fileId] ?? null)
  return {
    repos: {
      chats: { addMessage, update, getMessages },
      files: { findById },
    } as any,
    spies: { addMessage, update, getMessages, findById },
  }
}

function makeChat(overrides: Partial<any> = {}) {
  return {
    id: 'chat-1',
    participants: [
      { id: 'p-char', characterId: 'char-1' },
      { id: 'p-user', characterId: null },
    ],
    courierCheckpoints: null,
    ...overrides,
  }
}

const baseCharacter = { id: 'char-1', name: 'Alice' } as any
const baseStreaming = {
  fullResponse: '',
  effectiveProfile: {
    provider: 'CUSTOM',
    modelName: 'gpt-mystery',
    transport: 'courier',
    courierDeltaMode: true,
  },
  effectiveApiKey: '',
  usage: null,
  cacheUsage: null,
  attachmentResults: null,
  rawResponse: null,
  thoughtSignature: undefined,
  hasStartedStreaming: false,
} as any

describe('courier-transport.service', () => {
  const encoder = new TextEncoder()
  let controller: { enqueue: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    controller = { enqueue: jest.fn() }
    mockRenderCourierRequestAsMarkdown.mockReturnValue({
      markdown: '# Full bundle\n…',
      attachments: [{ fileId: 'f1', filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 10, downloadUrl: '/api/v1/files/f1' }],
    })
    mockRenderCourierDeltaAsMarkdown.mockReturnValue({
      markdown: '## Delta bundle\n…',
      attachments: [{ fileId: 'f2', filename: 'b.txt', mimeType: 'text/plain', sizeBytes: 20, downloadUrl: '/api/v1/files/f2' }],
    })
  })

  it('renders the full bundle, persists a placeholder, pauses the chat, and emits SSE events when no checkpoint exists', async () => {
    const { repos, spies } = makeRepos()

    const result = await dispatchCourierTransport({
      repos,
      chatId: 'chat-1',
      chat: makeChat(),
      character: baseCharacter,
      characterParticipant: { id: 'p-char' },
      userParticipantId: 'p-user',
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null },
      formattedMessages: [{ role: 'user', content: 'Hi' }],
      streaming: baseStreaming,
      controller: controller as any,
      encoder,
    })

    expect(mockRenderCourierRequestAsMarkdown).toHaveBeenCalledTimes(1)
    expect(mockRenderCourierDeltaAsMarkdown).not.toHaveBeenCalled()

    expect(spies.addMessage).toHaveBeenCalledTimes(1)
    const [, persisted] = spies.addMessage.mock.calls[0] as [string, any]
    expect(persisted.role).toBe('ASSISTANT')
    expect(persisted.participantId).toBe('p-char')
    expect(persisted.pendingExternalPrompt).toBe('# Full bundle\n…')
    expect(persisted.pendingExternalPromptFull).toBeNull()
    expect(persisted.pendingExternalAttachments).toHaveLength(1)

    expect(spies.update).toHaveBeenCalledTimes(1)
    const [, patch] = spies.update.mock.calls[0] as [string, any]
    expect(patch.isPaused).toBe(true)

    expect(mockEncodePendingExternalTurnEvent).toHaveBeenCalledTimes(1)
    expect(mockEncodeDoneEvent).toHaveBeenCalledTimes(1)
    const [, donePayload] = mockEncodeDoneEvent.mock.calls[0] as [TextEncoder, any]
    expect(donePayload.pendingExternalTurn).toBe(true)

    expect(result).toEqual({
      isMultiCharacter: false,
      hasContent: false,
      messageId: persisted.id,
      userParticipantId: 'p-user',
      isPaused: true,
    })
  })

  it('renders the delta as primary and the full bundle as fallback when a checkpoint exists', async () => {
    const checkpoint = {
      lastResolvedMessageId: 'msg-prior',
      resolvedAt: '2026-05-01T00:00:00.000Z',
    }
    const chat = makeChat({
      courierCheckpoints: { 'char-1': checkpoint },
    })

    // One message after the checkpoint to feed the delta path.
    const { repos, spies } = makeRepos({
      messages: [
        { id: 'msg-prior', type: 'message', role: 'ASSISTANT', participantId: 'p-char', createdAt: '2026-04-30T00:00:00.000Z', content: 'old', attachments: [] },
        { id: 'msg-new', type: 'message', role: 'USER', participantId: 'p-user', createdAt: '2026-05-02T00:00:00.000Z', content: 'fresh', attachments: [], targetParticipantIds: null },
      ],
    })

    await dispatchCourierTransport({
      repos,
      chatId: 'chat-1',
      chat,
      character: baseCharacter,
      characterParticipant: { id: 'p-char' },
      userParticipantId: 'p-user',
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null },
      formattedMessages: [{ role: 'user', content: 'Hi' }],
      streaming: baseStreaming,
      controller: controller as any,
      encoder,
    })

    expect(mockRenderCourierRequestAsMarkdown).toHaveBeenCalledTimes(1)
    expect(mockRenderCourierDeltaAsMarkdown).toHaveBeenCalledTimes(1)
    expect(spies.getMessages).toHaveBeenCalledWith('chat-1')

    const [, persisted] = spies.addMessage.mock.calls[0] as [string, any]
    expect(persisted.pendingExternalPrompt).toBe('## Delta bundle\n…')
    expect(persisted.pendingExternalPromptFull).toBe('# Full bundle\n…')
    // Union of attachments from both bundles
    const fileIds = (persisted.pendingExternalAttachments as Array<{ fileId: string }>).map(a => a.fileId)
    expect(fileIds).toEqual(['f1', 'f2'])

    // Delta input excluded the checkpoint event and included only msg-new
    const deltaCallArgs = mockRenderCourierDeltaAsMarkdown.mock.calls[0]?.[0] as { events: Array<{ content: string }> } | undefined
    expect(deltaCallArgs?.events).toHaveLength(1)
    expect(deltaCallArgs?.events[0]?.content).toBe('fresh')
  })

  it('skips the delta path when the profile disables courierDeltaMode, even with a checkpoint present', async () => {
    const chat = makeChat({
      courierCheckpoints: {
        'char-1': { lastResolvedMessageId: 'x', resolvedAt: '2026-04-01T00:00:00.000Z' },
      },
    })
    const streaming = {
      ...baseStreaming,
      effectiveProfile: { ...baseStreaming.effectiveProfile, courierDeltaMode: false },
    }
    const { repos } = makeRepos()

    await dispatchCourierTransport({
      repos,
      chatId: 'chat-1',
      chat,
      character: baseCharacter,
      characterParticipant: { id: 'p-char' },
      userParticipantId: null,
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null },
      formattedMessages: [],
      streaming,
      controller: controller as any,
      encoder,
    })

    expect(mockRenderCourierDeltaAsMarkdown).not.toHaveBeenCalled()
  })

  it('filters out whispers from the delta when the responding character is neither sender nor target', async () => {
    const checkpoint = { lastResolvedMessageId: 'x', resolvedAt: '2026-05-01T00:00:00.000Z' }
    const chat = makeChat({
      participants: [
        { id: 'p-char', characterId: 'char-1' },
        { id: 'p-other', characterId: 'char-2' },
        { id: 'p-user', characterId: null },
      ],
      courierCheckpoints: { 'char-1': checkpoint },
    })

    const { repos } = makeRepos({
      messages: [
        // Whisper from another character to itself — must be filtered.
        {
          id: 'whisper-other',
          type: 'message',
          role: 'ASSISTANT',
          participantId: 'p-other',
          createdAt: '2026-05-02T00:00:00.000Z',
          content: 'private to char-2',
          attachments: [],
          targetParticipantIds: ['p-other'],
        },
        // Whisper addressed to the responding character — must be kept.
        {
          id: 'whisper-for-me',
          type: 'message',
          role: 'ASSISTANT',
          participantId: 'p-other',
          createdAt: '2026-05-02T01:00:00.000Z',
          content: 'audible to char-1',
          attachments: [],
          targetParticipantIds: ['p-char'],
        },
      ],
    })

    await dispatchCourierTransport({
      repos,
      chatId: 'chat-1',
      chat,
      character: baseCharacter,
      characterParticipant: { id: 'p-char' },
      userParticipantId: 'p-user',
      isMultiCharacter: true,
      participantCharacters: new Map([['char-2', { id: 'char-2', name: 'Other' } as any]]),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null },
      formattedMessages: [],
      streaming: baseStreaming,
      controller: controller as any,
      encoder,
    })

    const deltaCallArgs = mockRenderCourierDeltaAsMarkdown.mock.calls[0]?.[0] as { events: Array<{ content: string }> } | undefined
    expect(deltaCallArgs?.events).toHaveLength(1)
    expect(deltaCallArgs?.events[0]?.content).toBe('audible to char-1')
  })

  it('resolves Staff systemSender labels in the delta speaker column', async () => {
    const checkpoint = { lastResolvedMessageId: 'x', resolvedAt: '2026-05-01T00:00:00.000Z' }
    const chat = makeChat({
      courierCheckpoints: { 'char-1': checkpoint },
    })

    const { repos } = makeRepos({
      messages: [
        {
          id: 'staff-1',
          type: 'message',
          role: 'ASSISTANT',
          participantId: null,
          createdAt: '2026-05-02T00:00:00.000Z',
          content: 'the lights flicker',
          attachments: [],
          systemSender: 'lantern',
          targetParticipantIds: null,
        },
      ],
    })

    await dispatchCourierTransport({
      repos,
      chatId: 'chat-1',
      chat,
      character: baseCharacter,
      characterParticipant: { id: 'p-char' },
      userParticipantId: 'p-user',
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null },
      formattedMessages: [],
      streaming: baseStreaming,
      controller: controller as any,
      encoder,
    })

    const deltaCallArgs = mockRenderCourierDeltaAsMarkdown.mock.calls[0]?.[0] as { events: Array<{ speaker: string }> } | undefined
    expect(deltaCallArgs?.events[0]?.speaker).toBe('[Staff: The Lantern]')
  })
})
