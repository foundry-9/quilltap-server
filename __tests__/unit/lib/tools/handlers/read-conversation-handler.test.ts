import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockFindChatById = jest.fn()
const mockFindAnnotationsByChatId = jest.fn()
const mockMergeAnnotations = jest.fn()
const mockStripAnnotations = jest.fn()
const mockGetRepositories = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/scriptorium', () => ({
  mergeAnnotations: (...args: unknown[]) => mockMergeAnnotations(...args),
  stripAnnotations: (...args: unknown[]) => mockStripAnnotations(...args),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))

const {
  executeReadConversationTool,
  formatReadConversationResults,
} = require('@/lib/tools/handlers/read-conversation-handler') as typeof import('@/lib/tools/handlers/read-conversation-handler')

describe('read-conversation-handler', () => {
  const context = {
    userId: 'user-1',
    chatId: 'chat-current',
    characterId: 'character-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue({
      chats: {
        findById: mockFindChatById,
      },
      conversationAnnotations: {
        findByChatId: mockFindAnnotationsByChatId,
      },
    })
  })

  it('merges annotations and counts messages from the merged markdown', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-current',
      participants: [{ id: 'participant-1', characterId: 'character-1' }],
      renderedMarkdown: '# Conversation\n\n## Interchange 1\n\n### Message 1\nOriginal',
    })
    mockFindAnnotationsByChatId.mockResolvedValue([{ id: 'annotation-1' }])
    mockMergeAnnotations.mockReturnValue(
      '# Conversation\n\n## Interchange 1\n\n### Message 1\nMerged\n\n## Interchange 2\n\n### Message 2\nMerged again'
    )

    const result = await executeReadConversationTool({}, context)

    expect(result).toEqual({
      success: true,
      markdown: '# Conversation\n\n## Interchange 1\n\n### Message 1\nMerged\n\n## Interchange 2\n\n### Message 2\nMerged again',
      messageCount: 2,
      interchangeCount: 2,
    })
    expect(mockFindAnnotationsByChatId).toHaveBeenCalledWith('chat-current')
    expect(mockMergeAnnotations).toHaveBeenCalledWith(
      '# Conversation\n\n## Interchange 1\n\n### Message 1\nOriginal',
      [{ id: 'annotation-1' }]
    )
    expect(mockStripAnnotations).not.toHaveBeenCalled()
  })

  it('strips annotations when exclude_annotations is true', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-current',
      participants: [{ id: 'participant-1', characterId: 'character-1' }],
      renderedMarkdown: '# Conversation\n\n## Interchange 1\n\n### Message 1\nOriginal [Note]',
    })
    mockStripAnnotations.mockReturnValue(
      '# Conversation\n\n## Interchange 1\n\n### Message 1\nOriginal'
    )

    const result = await executeReadConversationTool(
      { exclude_annotations: true },
      context
    )

    expect(result.success).toBe(true)
    expect(result.markdown).toContain('Original')
    expect(mockStripAnnotations).toHaveBeenCalledWith(
      '# Conversation\n\n## Interchange 1\n\n### Message 1\nOriginal [Note]'
    )
    expect(mockFindAnnotationsByChatId).not.toHaveBeenCalled()
    expect(mockMergeAnnotations).not.toHaveBeenCalled()
  })

  it('blocks cross-conversation reads when the character is not a participant', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-other',
      participants: [{ id: 'participant-2', characterId: 'character-2' }],
      renderedMarkdown: '# Conversation',
    })

    const result = await executeReadConversationTool(
      { conversationId: 'chat-other' },
      context
    )

    expect(result).toEqual({
      success: false,
      error: 'Conversation not found.',
    })
    expect(mockFindAnnotationsByChatId).not.toHaveBeenCalled()
  })

  it('returns a not-rendered error when markdown is unavailable', async () => {
    mockFindChatById.mockResolvedValue({
      id: 'chat-current',
      participants: [{ id: 'participant-1', characterId: 'character-1' }],
      renderedMarkdown: '',
    })

    const result = await executeReadConversationTool({}, context)

    expect(result).toEqual({
      success: false,
      error: 'Conversation has not been rendered yet.',
    })
  })

  it('rejects invalid input', async () => {
    const result = await executeReadConversationTool(
      { exclude_annotations: 'yes' },
      context
    )

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: exclude_annotations must be a boolean if provided.',
    })
  })

  it('returns full markdown without truncation for large results', () => {
    const markdown = 'x'.repeat(100000)

    const formatted = formatReadConversationResults({
      success: true,
      markdown,
      messageCount: 12,
      interchangeCount: 4,
    })

    expect(formatted).toBe(markdown)
  })
})
