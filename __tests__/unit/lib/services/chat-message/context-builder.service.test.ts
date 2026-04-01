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

    it('should include targetParticipantIds in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Secret whisper',
          id: 'msg-1',
          participantId: 'char-1',
          targetParticipantIds: ['char-2'],
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].targetParticipantIds).toEqual(['char-2'])
    })

    it('should handle multiple consecutive USER messages', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'First', id: 'msg-1' },
        { type: 'message', role: 'USER', content: 'Second', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('First')
      expect(result.conversationMessages[1].content).toBe('Second')
    })

    it('should handle multiple consecutive ASSISTANT messages', () => {
      const existingMessages = [
        { type: 'message', role: 'ASSISTANT', content: 'Reply 1', id: 'msg-1' },
        { type: 'message', role: 'ASSISTANT', content: 'Reply 2', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('Reply 1')
      expect(result.conversationMessages[1].content).toBe('Reply 2')
    })

    it('should filter out system_event type entries', () => {
      const existingMessages = [
        { type: 'system_event', content: 'System event' },
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toBe('Hello')
    })

    it('should handle TOOL message with nested JSON result', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search',
            result: JSON.stringify({ items: [{ name: 'test' }] }),
          }),
          id: 'msg-1',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: search]')
    })

    it('should handle large message arrays without errors', () => {
      const existingMessages = Array.from({ length: 100 }, (_, i) => ({
        type: 'message',
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        content: `Message ${i}`,
        id: `msg-${i}`,
      }))
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(100)
    })

    it('should handle messages with empty content', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: '', id: 'msg-1' },
        { type: 'message', role: 'ASSISTANT', content: '', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('')
      expect(result.conversationMessages[1].content).toBe('')
    })

    it('should track participant IDs across multiple characters in multi-character mode', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1', participantId: 'user-p', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hi from char1', id: 'msg-2', participantId: 'char-1-p', createdAt: '2024-01-01T00:00:01Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hello from char2', id: 'msg-3', participantId: 'char-2-p', createdAt: '2024-01-01T00:00:02Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(3)
      expect(result.messagesWithParticipants![0].participantId).toBe('user-p')
      expect(result.messagesWithParticipants![1].participantId).toBe('char-1-p')
      expect(result.messagesWithParticipants![2].participantId).toBe('char-2-p')
    })

    it('should preserve message ordering in multi-character mode with different participant IDs', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Q1', id: 'msg-1', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A1', id: 'msg-2', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A2', id: 'msg-3', participantId: 'char-2', createdAt: '2024-01-01T00:00:02Z' },
        { type: 'message', role: 'USER', content: 'Q2', id: 'msg-4', participantId: 'user', createdAt: '2024-01-01T00:00:03Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(4)
      expect(result.messagesWithParticipants![0].content).toBe('Q1')
      expect(result.messagesWithParticipants![1].content).toBe('A1')
      expect(result.messagesWithParticipants![2].content).toBe('A2')
      expect(result.messagesWithParticipants![3].content).toBe('Q2')
    })

    it('should handle TOOL messages in multi-character mode with null participantId', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'test_tool',
            result: 'Tool output',
          }),
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].participantId).toBeNull()
      expect(result.messagesWithParticipants![0].role).toBe('USER')
      expect(result.messagesWithParticipants![0].content).toContain('[Tool Result: test_tool]')
    })

    it('should preserve null targetParticipantIds when present', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Public message',
          id: 'msg-1',
          participantId: 'char-1',
          targetParticipantIds: null,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].targetParticipantIds).toBeNull()
    })

    it('should handle messages with very long content', () => {
      const longContent = 'x'.repeat(10000)
      const existingMessages = [
        { type: 'message', role: 'USER', content: longContent, id: 'msg-1' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content.length).toBe(10000)
    })

    it('should handle mixed TOOL messages with valid and empty results', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'tool1',
            result: 'Valid result',
          }),
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'tool2',
            result: '',
          }),
          id: 'msg-2',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: tool1]')
      expect(result.conversationMessages[1].content).toContain('[Tool Result: tool2]')
    })

    it('should preserve participant timestamps in multi-character mode', () => {
      const time1 = '2024-01-01T10:00:00Z'
      const time2 = '2024-01-01T10:01:00Z'
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1', participantId: 'user', createdAt: time1 },
        { type: 'message', role: 'ASSISTANT', content: 'Hi', id: 'msg-2', participantId: 'char-1', createdAt: time2 },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants![0].createdAt).toBe(time1)
      expect(result.messagesWithParticipants![1].createdAt).toBe(time2)
    })

    it('should handle TOOL message with array result', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'list_search',
            result: JSON.stringify([
              { id: 1, name: 'item1' },
              { id: 2, name: 'item2' },
            ]),
          }),
          id: 'msg-1',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: list_search]')
    })

    it('should handle alternating multi-character and single messages', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Q1', id: 'msg-1', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A1', id: 'msg-2', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.messagesWithParticipants![0].participantId).toBe('user')
      expect(result.messagesWithParticipants![1].participantId).toBe('char-1')
    })

    it('should handle messageIds with special characters', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1:special_id-123', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hi', id: 'msg-2/alternative.id', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.messagesWithParticipants![0].id).toBe('msg-1:special_id-123')
      expect(result.messagesWithParticipants![1].id).toBe('msg-2/alternative.id')
    })
  })
})
