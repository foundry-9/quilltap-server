/**
 * Unit tests for LLM logging service
 */

import {
  isLoggingEnabled,
  logLLMCall,
  messageHasLogs,
  getLogsForUser,
  getTotalTokenUsage,
  cleanupOldLogs,
  deleteAllLogsForUser,
} from '../../../../lib/services/llm-logging.service'
import { getRepositories } from '../../../../lib/repositories/factory'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const mockGetRepositories = jest.mocked(getRepositories)

function createMockRepos() {
  return {
    chatSettings: {
      findByUserId: jest.fn(),
    },
    llmLogs: {
      create: jest.fn(),
      findByUserId: jest.fn(),
      countByMessageId: jest.fn(),
      getTotalTokenUsage: jest.fn(),
      cleanupOldLogs: jest.fn(),
      deleteByUserId: jest.fn(),
    },
  } as any
}

describe('llm-logging.service', () => {
  let mockRepos: ReturnType<typeof createMockRepos>

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepos()
    mockGetRepositories.mockReturnValue(mockRepos)
  })

  describe('isLoggingEnabled', () => {
    it('returns settings when logging is enabled', async () => {
      mockRepos.chatSettings.findByUserId.mockResolvedValue({
        llmLoggingSettings: {
          enabled: true,
          verboseMode: true,
          retentionDays: 14,
        },
      })

      const result = await isLoggingEnabled('user-1')

      expect(result).toEqual({
        enabled: true,
        verboseMode: true,
        retentionDays: 14,
      })
    })

    it('returns null when logging is disabled', async () => {
      mockRepos.chatSettings.findByUserId.mockResolvedValue({
        llmLoggingSettings: {
          enabled: false,
          verboseMode: false,
          retentionDays: 7,
        },
      })

      const result = await isLoggingEnabled('user-1')

      expect(result).toBeNull()
    })

    it('defaults to enabled when settings missing', async () => {
      mockRepos.chatSettings.findByUserId.mockResolvedValue(null)

      const result = await isLoggingEnabled('user-1')

      expect(result).toEqual({
        enabled: true,
        verboseMode: false,
        retentionDays: 30,
      })
    })
  })

  describe('logLLMCall', () => {
    it('creates log entry when logging enabled', async () => {
      mockRepos.chatSettings.findByUserId.mockResolvedValue({
        llmLoggingSettings: {
          enabled: true,
          verboseMode: false,
          retentionDays: 30,
        },
      })

      mockRepos.llmLogs.create.mockResolvedValue({ id: 'log-1' })

      const result = await logLLMCall({
        userId: 'user-1',
        type: 'chat',
        messageId: 'msg-1',
        chatId: 'chat-1',
        characterId: 'char-1',
        provider: 'openai',
        modelName: 'gpt-4o',
        request: {
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'Hello world' },
          ],
          temperature: 0.7,
          maxTokens: 200,
          tools: [{ name: 'search_web' }],
        },
        response: {
          content: 'Hi there!',
        },
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        cacheUsage: {
          cacheCreationInputTokens: 3,
          cacheReadInputTokens: 2,
        },
        durationMs: 1234,
      })

      expect(result).toEqual({ id: 'log-1' })
      expect(mockRepos.llmLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'chat',
          messageId: 'msg-1',
          chatId: 'chat-1',
          characterId: 'char-1',
          provider: 'openai',
          modelName: 'gpt-4o',
          durationMs: 1234,
          request: expect.objectContaining({
            messageCount: 2,
            messages: [
              { role: 'system', content: 'System prompt', contentLength: 13, hasAttachments: false },
              { role: 'user', content: 'Hello world', contentLength: 11, hasAttachments: false },
            ],
            temperature: 0.7,
            maxTokens: 200,
            toolCount: 1,
          }),
          response: expect.objectContaining({
            content: 'Hi there!',
            contentLength: 9,
            error: null,
          }),
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          cacheUsage: {
            cacheCreationInputTokens: 3,
            cacheReadInputTokens: 2,
          },
        })
      )
    })

    it('returns null when logging disabled', async () => {
      mockRepos.chatSettings.findByUserId.mockResolvedValue({
        llmLoggingSettings: {
          enabled: false,
          verboseMode: false,
          retentionDays: 30,
        },
      })

      const result = await logLLMCall({
        userId: 'user-1',
        type: 'chat',
        provider: 'openai',
        modelName: 'gpt-4o',
        request: { messages: [{ role: 'user', content: 'Hello' }] },
        response: { content: 'Hi' },
      })

      expect(result).toBeNull()
      expect(mockRepos.llmLogs.create).not.toHaveBeenCalled()
    })
  })

  describe('messageHasLogs', () => {
    it('returns true when logs exist', async () => {
      mockRepos.llmLogs.countByMessageId.mockResolvedValue(2)

      const result = await messageHasLogs('msg-1')

      expect(result).toBe(true)
    })

    it('returns false on error', async () => {
      mockRepos.llmLogs.countByMessageId.mockRejectedValue(new Error('boom'))

      const result = await messageHasLogs('msg-1')

      expect(result).toBe(false)
    })
  })

  describe('getLogsForUser', () => {
    it('returns logs when repository succeeds', async () => {
      mockRepos.llmLogs.findByUserId.mockResolvedValue([{ id: 'log-1' }])

      const result = await getLogsForUser('user-1', 10, 0)

      expect(result).toEqual([{ id: 'log-1' }])
      expect(mockRepos.llmLogs.findByUserId).toHaveBeenCalledWith('user-1', 10, 0)
    })

    it('returns empty array on error', async () => {
      mockRepos.llmLogs.findByUserId.mockRejectedValue(new Error('boom'))

      const result = await getLogsForUser('user-1', 10, 0)

      expect(result).toEqual([])
    })
  })

  describe('getTotalTokenUsage', () => {
    it('returns usage summary from repository', async () => {
      mockRepos.llmLogs.getTotalTokenUsage.mockResolvedValue({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })

      const result = await getTotalTokenUsage('user-1')

      expect(result).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    })
  })

  describe('cleanupOldLogs and deleteAllLogsForUser', () => {
    it('returns counts when successful', async () => {
      mockRepos.llmLogs.cleanupOldLogs.mockResolvedValue(4)
      mockRepos.llmLogs.deleteByUserId.mockResolvedValue(12)

      const cleanupResult = await cleanupOldLogs('user-1', 30)
      const deleteResult = await deleteAllLogsForUser('user-1')

      expect(cleanupResult).toBe(4)
      expect(deleteResult).toBe(12)
    })

    it('returns 0 on cleanup error', async () => {
      mockRepos.llmLogs.cleanupOldLogs.mockRejectedValue(new Error('boom'))

      const result = await cleanupOldLogs('user-1', 30)

      expect(result).toBe(0)
    })
  })
})
