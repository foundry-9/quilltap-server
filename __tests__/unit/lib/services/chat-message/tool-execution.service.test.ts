/**
 * Unit tests for tool-execution.service.ts
 * Tests tool detection and context creation
 */

import {
  detectToolCallsInResponse,
  createToolContext,
} from '@/lib/services/chat-message/tool-execution.service'
import * as toolExecutor from '@/lib/chat/tool-executor'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))
jest.mock('@/lib/chat/tool-executor')

const mockedDetectToolCalls = toolExecutor.detectToolCalls as jest.MockedFunction<typeof toolExecutor.detectToolCalls>

describe('tool-execution.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('detectToolCallsInResponse', () => {
    it('should detect tool calls from OpenAI response', () => {
      const response = {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search_web',
              arguments: JSON.stringify({ query: 'test' }),
            },
          },
        ],
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'search_web', arguments: { query: 'test' } },
      ])

      const result = detectToolCallsInResponse(response, 'OPENAI')

      expect(mockedDetectToolCalls).toHaveBeenCalledWith(response, 'OPENAI')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'search_web',
        arguments: { query: 'test' },
      })
    })

    it('should detect multiple tool calls', () => {
      const response = {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search',
              arguments: JSON.stringify({ query: 'memory' }),
            },
          },
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'generate_image',
              arguments: JSON.stringify({ prompt: 'a cat' }),
            },
          },
        ],
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'search', arguments: { query: 'memory' } },
        { name: 'generate_image', arguments: { prompt: 'a cat' } },
      ])

      const result = detectToolCallsInResponse(response, 'OPENAI')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('search')
      expect(result[1].name).toBe('generate_image')
    })

    it('should return empty array when no tool calls detected', () => {
      const response = { content: 'Just a regular response' }

      mockedDetectToolCalls.mockReturnValue([])

      const result = detectToolCallsInResponse(response, 'OPENAI')

      expect(result).toEqual([])
    })

    it('should detect tool calls from Anthropic response', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'search_web',
            input: { query: 'anthropic' },
          },
        ],
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'search_web', arguments: { query: 'anthropic' } },
      ])

      const result = detectToolCallsInResponse(response, 'ANTHROPIC')

      expect(mockedDetectToolCalls).toHaveBeenCalledWith(response, 'ANTHROPIC')
      expect(result).toHaveLength(1)
      expect(result[0].arguments).toEqual({ query: 'anthropic' })
    })

    it('should handle tool calls with complex arguments', () => {
      const complexArgs = {
        query: 'test',
        filters: { category: 'tech', date: '2024-01-01' },
        limit: 10,
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'search', arguments: complexArgs },
      ])

      const result = detectToolCallsInResponse({}, 'OPENAI')

      expect(result[0].arguments).toEqual(complexArgs)
    })

    it('should handle tool calls with empty arguments', () => {
      mockedDetectToolCalls.mockReturnValue([
        { name: 'get_time', arguments: {} },
      ])

      const result = detectToolCallsInResponse({}, 'OPENAI')

      expect(result[0].arguments).toEqual({})
    })

    it('should detect tool calls from Google response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'search_web',
                    args: { query: 'google' },
                  },
                },
              ],
            },
          },
        ],
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'search_web', arguments: { query: 'google' } },
      ])

      const result = detectToolCallsInResponse(response, 'GOOGLE')

      expect(result).toHaveLength(1)
    })

    it('should handle malformed tool call responses gracefully', () => {
      mockedDetectToolCalls.mockReturnValue([])

      const result = detectToolCallsInResponse(null, 'OPENAI')

      expect(result).toEqual([])
    })

    it('should detect tool calls with special characters in arguments', () => {
      mockedDetectToolCalls.mockReturnValue([
        {
          name: 'search_web',
          arguments: { query: 'test "quoted" & <special>' },
        },
      ])

      const result = detectToolCallsInResponse({}, 'OPENAI')

      expect(result[0].arguments.query).toContain('"quoted"')
      expect(result[0].arguments.query).toContain('<special>')
    })

    it('should detect tool calls from OpenRouter response', () => {
      const response = {
        tool_calls: [
          {
            id: 'call_or_1',
            type: 'function',
            function: {
              name: 'generate_image',
              arguments: JSON.stringify({ prompt: 'test' }),
            },
          },
        ],
      }

      mockedDetectToolCalls.mockReturnValue([
        { name: 'generate_image', arguments: { prompt: 'test' } },
      ])

      const result = detectToolCallsInResponse(response, 'OPENROUTER')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('generate_image')
    })
  })

  describe('createToolContext', () => {
    it('should create basic tool execution context', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101'
      )

      expect(context).toEqual({
        chatId: 'chat-123',
        userId: 'user-456',
        characterId: 'char-789',
        embeddingProfileId: undefined,
        callingParticipantId: 'participant-101',
        imageProfileId: undefined,
        projectId: undefined,
      })
    })

    it('should include image profile ID when provided', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        'image-profile-1'
      )

      expect(context.imageProfileId).toBe('image-profile-1')
    })

    it('should handle null image profile ID', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        null
      )

      expect(context.imageProfileId).toBeUndefined()
    })

    it('should include embedding profile ID when provided', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        'image-profile-1',
        'embedding-profile-1'
      )

      expect(context.embeddingProfileId).toBe('embedding-profile-1')
    })

    it('should include project ID when provided', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        'image-profile-1',
        'embedding-profile-1',
        'project-123'
      )

      expect(context.projectId).toBe('project-123')
    })

    it('should handle null project ID', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        'image-profile-1',
        'embedding-profile-1',
        null
      )

      expect(context.projectId).toBeUndefined()
    })

    it('should create context with all optional parameters', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101',
        'image-profile-1',
        'embedding-profile-1',
        'project-123'
      )

      expect(context).toEqual({
        chatId: 'chat-123',
        userId: 'user-456',
        characterId: 'char-789',
        embeddingProfileId: 'embedding-profile-1',
        callingParticipantId: 'participant-101',
        imageProfileId: 'image-profile-1',
        projectId: 'project-123',
      })
    })

    it('should create context without any optional parameters', () => {
      const context = createToolContext(
        'chat-123',
        'user-456',
        'char-789',
        'participant-101'
      )

      expect(context.imageProfileId).toBeUndefined()
      expect(context.embeddingProfileId).toBeUndefined()
      expect(context.projectId).toBeUndefined()
    })

    it('should preserve all IDs as strings', () => {
      const context = createToolContext(
        'chat-abc-123',
        'user-xyz-456',
        'char-def-789',
        'participant-ghi-101',
        'img-prof-001',
        'emb-prof-002',
        'proj-003'
      )

      expect(typeof context.chatId).toBe('string')
      expect(typeof context.userId).toBe('string')
      expect(typeof context.characterId).toBe('string')
      expect(typeof context.callingParticipantId).toBe('string')
      expect(typeof context.imageProfileId).toBe('string')
      expect(typeof context.embeddingProfileId).toBe('string')
      expect(typeof context.projectId).toBe('string')
    })
  })
})
