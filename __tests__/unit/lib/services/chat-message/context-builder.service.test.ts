/**
 * Unit tests for context-builder.service.ts
 * Tests message building and conversation assembly
 */

import {
  buildConversationMessages,
} from '@/lib/services/chat-message/context-builder.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

describe('context-builder.service', () => {
  describe('buildConversationMessages', () => {
    it('should build conversation from USER and ASSISTANT messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hi there!',
          id: 'msg-2',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0]).toEqual({
        role: 'USER',
        content: 'Hello',
        id: 'msg-1',
      })
      expect(result.conversationMessages[1]).toEqual({
        role: 'ASSISTANT',
        content: 'Hi there!',
        id: 'msg-2',
      })
    })

    it('should filter out SYSTEM messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'SYSTEM',
          content: 'System message',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'User message',
          id: 'msg-2',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].role).toBe('USER')
    })

    it('should convert TOOL messages to USER messages with formatted content', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
            result: 'Search results here',
          }),
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].role).toBe('USER')
      expect(result.conversationMessages[0].content).toContain('[Tool Result: search_web]')
      expect(result.conversationMessages[0].content).toContain('Search results here')
    })

    it('should preserve thought signatures on ASSISTANT messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Response',
          id: 'msg-1',
          thoughtSignature: 'thought-123',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].thoughtSignature).toBe('thought-123')
    })

    it('should not include thought signatures on USER messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Question',
          id: 'msg-1',
          thoughtSignature: 'should-not-appear',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].thoughtSignature).toBeUndefined()
    })

    it('should handle malformed TOOL message content', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: 'not valid json',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      // Malformed TOOL messages should be filtered out
      expect(result.conversationMessages).toHaveLength(0)
    })

    it('should handle TOOL message with missing result field', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
          }),
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('No result')
    })

    it('should filter out non-message type events', () => {
      const existingMessages = [
        {
          type: 'event',
          content: 'Some event',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'User message',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toBe('User message')
    })

    it('should build messages with participant info for multi-character chats', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
          participantId: 'user-participant',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hi!',
          id: 'msg-2',
          participantId: 'char-participant-1',
          createdAt: '2024-01-01T00:00:01Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toBeDefined()
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.messagesWithParticipants![0]).toMatchObject({
        role: 'USER',
        content: 'Hello',
        participantId: 'user-participant',
        createdAt: '2024-01-01T00:00:00Z',
      })
    })

    it('should not build participant messages for single-character chats', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.messagesWithParticipants).toBeUndefined()
    })

    it('should handle empty message array', () => {
      const result = buildConversationMessages([], false)

      expect(result.conversationMessages).toEqual([])
      expect(result.messagesWithParticipants).toBeUndefined()
    })

    it('should preserve message order', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'First',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Second',
          id: 'msg-2',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'Third',
          id: 'msg-3',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].content).toBe('First')
      expect(result.conversationMessages[1].content).toBe('Second')
      expect(result.conversationMessages[2].content).toBe('Third')
    })

    it('should handle mixed message types and roles', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Question',
          id: 'msg-1',
        },
        {
          type: 'event',
          content: 'Event happened',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Answer',
          id: 'msg-2',
        },
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'test',
            result: 'Result',
          }),
          id: 'msg-3',
        },
        {
          type: 'message',
          role: 'SYSTEM',
          content: 'System',
          id: 'msg-4',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(3) // USER, ASSISTANT, TOOL
      expect(result.conversationMessages[0].role).toBe('USER')
      expect(result.conversationMessages[1].role).toBe('ASSISTANT')
      expect(result.conversationMessages[2].role).toBe('USER') // Converted TOOL
    })

    it('should handle TOOL messages in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
            result: 'Found data',
          }),
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0]).toMatchObject({
        role: 'USER',
        content: expect.stringContaining('[Tool Result: search_web]'),
        participantId: null,
      })
    })

    it('should handle malformed TOOL messages in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: 'invalid json',
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toHaveLength(0)
    })

    it('should handle messages with null thought signatures', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Response',
          id: 'msg-1',
          thoughtSignature: null,
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      // thoughtSignature is preserved as null, not converted to undefined
      expect(result.conversationMessages[0].thoughtSignature).toBeNull()
    })
  })
})
