import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockRenderConversationMarkdown = jest.fn()
const mockEnqueueEmbeddingGenerate = jest.fn()
const mockGetRepositories = jest.fn()
const mockFindChatById = jest.fn()
const mockFindCharacterById = jest.fn()
const mockGetMessages = jest.fn()
const mockUpdateChat = jest.fn()
const mockUpsertChunk = jest.fn()
const mockFindChunkByInterchangeIndex = jest.fn()
const mockFindEmbeddingProfiles = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/scriptorium/markdown-renderer', () => ({
  renderConversationMarkdown: (...args: unknown[]) => mockRenderConversationMarkdown(...args),
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingGenerate: (...args: unknown[]) => mockEnqueueEmbeddingGenerate(...args),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))

const {
  handleConversationRender,
} = require('@/lib/background-jobs/handlers/conversation-render') as typeof import('@/lib/background-jobs/handlers/conversation-render')

describe('conversation-render handler', () => {
  const job = {
    id: 'job-1',
    userId: 'user-1',
    payload: {
      chatId: 'chat-1',
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue({
      chats: {
        findById: mockFindChatById,
        getMessages: mockGetMessages,
        update: mockUpdateChat,
      },
      characters: {
        findByIdRaw: mockFindCharacterById,
      },
      conversationChunks: {
        upsert: mockUpsertChunk,
        findByInterchangeIndex: mockFindChunkByInterchangeIndex,
      },
      embeddingProfiles: {
        findAll: mockFindEmbeddingProfiles,
      },
    })
  })

  it('returns early when the chat does not exist', async () => {
    mockFindChatById.mockResolvedValue(null)

    await handleConversationRender(job as any)

    expect(mockGetMessages).not.toHaveBeenCalled()
    expect(mockRenderConversationMarkdown).not.toHaveBeenCalled()
    expect(mockUpdateChat).not.toHaveBeenCalled()
  })

  it('returns early when there are no messages to render', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-1',
      title: 'Empty conversation',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      messageCount: 0,
      participants: [],
    })
    mockGetMessages.mockResolvedValue([])

    await handleConversationRender(job as any)

    expect(mockRenderConversationMarkdown).not.toHaveBeenCalled()
    expect(mockUpdateChat).not.toHaveBeenCalled()
  })

  it('renders, stores chunks (not the Markdown), and only enqueues missing embeddings by default', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-1',
      title: 'Rendered conversation',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      messageCount: 2,
      participants: [
        { id: 'participant-1', characterId: 'character-1', controlledBy: 'assistant' },
        { id: 'participant-2', controlledBy: 'user' },
      ],
    })
    mockFindCharacterById.mockResolvedValue({ name: 'Ada' })
    mockGetMessages.mockResolvedValue([{ id: 'message-1' }, { id: 'message-2' }])
    mockRenderConversationMarkdown.mockReturnValue({
      markdown: '# Conversation',
      interchanges: [
        {
          index: 0,
          content: 'Chunk 0',
          participantNames: ['Ada'],
          messageIds: ['message-1'],
        },
        {
          index: 1,
          content: 'Chunk 1',
          participantNames: ['User'],
          messageIds: ['message-2'],
        },
      ],
    })
    mockFindEmbeddingProfiles.mockResolvedValue([{ id: 'profile-1', isDefault: true }])
    mockFindChunkByInterchangeIndex
      .mockResolvedValueOnce({ id: 'chunk-0', content: 'Chunk 0', embedding: null })
      .mockResolvedValueOnce({ id: 'chunk-1', content: 'Chunk 1', embedding: [0.2] })

    await handleConversationRender(job as any)

    expect(mockRenderConversationMarkdown).toHaveBeenCalledTimes(1)
    const renderArgs = mockRenderConversationMarkdown.mock.calls[0]
    const characterNames = renderArgs[2] as Map<string, string>
    expect(characterNames.get('participant-1')).toBe('Ada')
    // A seat with no character is left for the renderer's own 'User' label.
    expect(characterNames.has('participant-2')).toBe(false)

    // The Markdown is rendered on demand now; only the chunks are stored.
    expect(mockUpdateChat).not.toHaveBeenCalled()
    expect(mockUpsertChunk).toHaveBeenCalledTimes(2)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(1)
    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith('user-1', {
      entityType: 'CONVERSATION_CHUNK',
      entityId: 'chunk-0',
      chatId: 'chat-1',
      profileId: 'profile-1',
    })
  })

  it('re-enqueues all chunk embeddings during a full reembed', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-1',
      title: 'Reembed conversation',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      messageCount: 1,
      participants: [],
    })
    mockGetMessages.mockResolvedValue([{ id: 'message-1' }])
    mockRenderConversationMarkdown.mockReturnValue({
      markdown: '# Conversation',
      interchanges: [
        { index: 0, content: 'Chunk 0', participantNames: [], messageIds: ['message-1'] },
        { index: 1, content: 'Chunk 1', participantNames: [], messageIds: ['message-2'] },
      ],
    })
    mockFindEmbeddingProfiles.mockResolvedValue([{ id: 'profile-1', isDefault: true }])
    mockFindChunkByInterchangeIndex
      .mockResolvedValueOnce({ id: 'chunk-0', content: 'Chunk 0', embedding: [0.1] })
      .mockResolvedValueOnce({ id: 'chunk-1', content: 'Chunk 1', embedding: [0.2] })

    await handleConversationRender({
      ...job,
      payload: {
        chatId: 'chat-1',
        fullReembed: true,
      },
    } as any)

    expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(2)
  })

  // Bug 248: in the job child the upsert is buffered, so a read after it still
  // sees the committed row. The decision must come from the row as it was.
  describe('decides re-embedding from the chunk as it was before the write (bug 248)', () => {
    const chat = {
      id: 'chat-1',
      title: 'Bug 248',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      messageCount: 2,
      participants: [],
    }

    beforeEach(() => {
      mockFindChatById.mockResolvedValue(chat)
      mockGetMessages.mockResolvedValue([{ id: 'message-1' }, { id: 'message-2' }])
      mockFindEmbeddingProfiles.mockResolvedValue([{ id: 'profile-1', isDefault: true }])
      mockRenderConversationMarkdown.mockReturnValue({
        markdown: '# Conversation',
        interchanges: [
          { index: 0, content: 'Chunk 0', participantNames: [], messageIds: ['message-1'] },
          { index: 1, content: 'Chunk 1, now longer', participantNames: [], messageIds: ['message-2'] },
        ],
      })
    })

    it('queues a chunk whose content changed even though the read still shows its old vector', async () => {
      // A buffered write leaves the committed row in place: the old content
      // with its old vector, which the upsert is about to clear.
      mockFindChunkByInterchangeIndex.mockImplementation(async (_chatId: unknown, index: unknown) =>
        index === 0
          ? { id: 'chunk-0', content: 'Chunk 0', embedding: [0.1] }
          : { id: 'chunk-1', content: 'Chunk 1', embedding: [0.2] }
      )
      mockUpsertChunk.mockImplementation(async (input: any) => ({ ...input, id: 'synthetic-id' }))

      await handleConversationRender(job as any)

      expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(1)
      // The existing row's id, never the child's synthetic one.
      expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith('user-1', {
        entityType: 'CONVERSATION_CHUNK',
        entityId: 'chunk-1',
        chatId: 'chat-1',
        profileId: 'profile-1',
      })
    })

    it('queues a brand-new chunk under the id the upsert handed back', async () => {
      // The child cannot read its own buffered create, so the new chunk is absent.
      mockFindChunkByInterchangeIndex.mockImplementation(async (_chatId: unknown, index: unknown) =>
        index === 0 ? { id: 'chunk-0', content: 'Chunk 0', embedding: [0.1] } : null
      )
      mockUpsertChunk.mockImplementation(async (input: any) => ({ ...input, id: `new-${input.interchangeIndex}` }))

      await handleConversationRender(job as any)

      expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledTimes(1)
      expect(mockEnqueueEmbeddingGenerate).toHaveBeenCalledWith('user-1', expect.objectContaining({
        entityId: 'new-1',
      }))
    })

    it('reads each chunk before upserting it', async () => {
      const order: string[] = []
      mockFindChunkByInterchangeIndex.mockImplementation(async () => { order.push('read'); return null })
      mockUpsertChunk.mockImplementation(async (input: any) => { order.push('write'); return { ...input, id: 'x' } })

      await handleConversationRender(job as any)

      expect(order).toEqual(['read', 'write', 'read', 'write'])
    })
  })
})
