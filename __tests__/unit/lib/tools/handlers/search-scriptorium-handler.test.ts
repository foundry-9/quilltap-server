import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockSearchMemoriesSemantic = jest.fn()
const mockGenerateEmbeddingForUser = jest.fn()
const mockSearchConversationChunks = jest.fn()
const mockFindCharacterById = jest.fn()
const mockGetRepositories = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: (...args: unknown[]) => mockSearchMemoriesSemantic(...args),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: (...args: unknown[]) => mockGenerateEmbeddingForUser(...args),
}))

jest.mock('@/lib/scriptorium/conversation-search', () => ({
  searchConversationChunks: (...args: unknown[]) => mockSearchConversationChunks(...args),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))

const {
  executeSearchScriptoriumTool,
  formatSearchScriptoriumResults,
} = require('@/lib/tools/handlers/search-scriptorium-handler') as typeof import('@/lib/tools/handlers/search-scriptorium-handler')

describe('search-scriptorium-handler', () => {
  const context = {
    userId: 'user-1',
    characterId: 'character-1',
    embeddingProfileId: 'embed-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue({
      characters: {
        findById: mockFindCharacterById,
      },
    })

    mockFindCharacterById.mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
    })
    mockGenerateEmbeddingForUser.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
    })
    mockSearchMemoriesSemantic.mockResolvedValue([])
    mockSearchConversationChunks.mockResolvedValue([])
  })

  it('merges, sorts, and truncates results across memories and conversations', async () => {
    mockSearchMemoriesSemantic.mockResolvedValue([
      {
        score: 0.72,
        effectiveWeight: 0.88,
        memory: {
          id: 'memory-1',
          content: 'Remember the blueprints in the west archive.',
          summary: 'Blueprint archive',
          importance: 0.8,
          createdAt: '2026-04-01T00:00:00.000Z',
          source: 'MANUAL',
        },
      },
    ])
    mockSearchConversationChunks.mockResolvedValue([
      {
        chatId: 'chat-2',
        score: 0.95,
        interchangeIndex: 3,
        conversationTitle: 'Archive Heist',
        participantNames: ['Ada', 'User'],
        content: 'x'.repeat(520),
      },
    ])

    const result = await executeSearchScriptoriumTool(
      { query: 'blueprints', limit: 5, minImportance: 0.4 },
      context
    )

    expect(result.success).toBe(true)
    expect(result.query).toBe('blueprints')
    expect(result.totalFound).toBe(2)
    expect(result.results?.[0]).toMatchObject({
      sourceType: 'conversation',
      relevanceScore: 0.95,
      metadata: expect.objectContaining({
        conversationId: 'chat-2',
        conversationTitle: 'Archive Heist',
      }),
    })
    expect(result.results?.[0].content).toHaveLength(503)
    expect(result.results?.[0].content.endsWith('...')).toBe(true)
    expect(result.results?.[1]).toMatchObject({
      sourceType: 'memory',
      metadata: expect.objectContaining({
        memoryId: 'memory-1',
        summary: 'Blueprint archive',
      }),
    })

    expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
      'character-1',
      'blueprints',
      expect.objectContaining({
        userId: 'user-1',
        embeddingProfileId: 'embed-1',
        limit: 5,
        minImportance: 0.4,
      })
    )
    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      'blueprints',
      'user-1',
      'embed-1'
    )
    expect(mockSearchConversationChunks).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      { characterId: 'character-1', limit: 5, minScore: 0.3 }
    )
  })

  it('skips memory search when the character does not belong to the user', async () => {
    mockFindCharacterById.mockResolvedValue({
      id: 'character-1',
      userId: 'other-user',
    })

    const result = await executeSearchScriptoriumTool(
      { query: 'blueprints', sources: ['memories'] },
      context
    )

    expect(result).toEqual({
      success: true,
      results: [],
      totalFound: 0,
      query: 'blueprints',
    })
    expect(mockSearchMemoriesSemantic).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
  })

  it('continues with conversation results when memory search fails', async () => {
    mockSearchMemoriesSemantic.mockRejectedValue(new Error('memory service unavailable'))
    mockSearchConversationChunks.mockResolvedValue([
      {
        chatId: 'chat-2',
        score: 0.61,
        interchangeIndex: 1,
        conversationTitle: 'Fallback conversation',
        participantNames: ['User'],
        content: 'Recovered from conversation search.',
      },
    ])

    const result = await executeSearchScriptoriumTool(
      { query: 'fallback' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.totalFound).toBe(1)
    expect(result.results?.[0].sourceType).toBe('conversation')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Memory search failed, continuing with other sources',
      expect.objectContaining({
        context: 'search-scriptorium-handler',
        error: 'memory service unavailable',
      })
    )
  })

  it('rejects invalid input', async () => {
    const result = await executeSearchScriptoriumTool(
      { query: '' },
      context
    )

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: query is required and must be a non-empty string',
      totalFound: 0,
      query: '',
    })
  })

  it('formats memory and conversation results for display', () => {
    const formatted = formatSearchScriptoriumResults([
      {
        content: 'Archive details',
        sourceType: 'memory',
        relevanceScore: 0.83,
        metadata: {
          summary: 'Archive note',
          importance: 0.8,
        },
      },
      {
        content: 'Conversation excerpt',
        sourceType: 'conversation',
        relevanceScore: 0.67,
        metadata: {
          conversationId: 'chat-9',
          conversationTitle: 'A Night at the Archive',
          interchangeIndex: 4,
          participantNames: ['Ada', 'User'],
        },
      },
    ])

    expect(formatted).toContain('Found 2 results:')
    expect(formatted).toContain('[Result 1 - Memory]')
    expect(formatted).toContain('Importance: High')
    expect(formatted).toContain('Conversation ID: chat-9')
    expect(formatted).toContain('Participants: Ada, User')
  })
})
