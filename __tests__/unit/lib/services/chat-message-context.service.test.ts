/**
 * Unit tests for chat-message context-builder.service.ts
 * Tests buildMessageContext and loadAndProcessFiles functions
 */

import {
  buildMessageContext,
  loadAndProcessFiles,
} from '@/lib/services/chat-message/context-builder.service'
import { createMockChat, createMockCharacter, createMockChatParticipant } from '../fixtures/test-factories'
import type { RepositoryContainer } from '@/lib/repositories/factory'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/chat/context-manager', () => ({
  buildContext: jest.fn(async (options) => ({
    systemPrompt: 'System prompt',
    messages: [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: options.newUserMessage || 'Hello' },
    ],
    warnings: [],
    includedMemoryCount: 0,
    trimmedMessages: 0,
  })),
}))

jest.mock('@/lib/llm/message-formatter', () => ({
  formatMessagesForProvider: jest.fn((messages) => messages),
}))

jest.mock('@/lib/chat-files-v2', () => ({
  loadChatFilesForLLM: jest.fn(async () => []),
}))

jest.mock('@/lib/chat/file-attachment-fallback', () => ({
  processFileAttachmentFallback: jest.fn(async () => ({ type: 'none' })),
  formatFallbackAsMessagePrefix: jest.fn(() => ''),
}))

function createMockRepositories(): RepositoryContainer {
  return {
    files: {
      findById: jest.fn(),
      findByLinkedTo: jest.fn(),
    },
  } as any
}

describe('chat-message-context.service', () => {
  let mockRepos: ReturnType<typeof createMockRepositories>

  beforeEach(() => {
    mockRepos = createMockRepositories()
    jest.clearAllMocks()
  })

  describe('loadAndProcessFiles', () => {
    it('should load and process file attachments', async () => {
      const chatFiles = [
        {
          id: 'file-1',
          originalFilename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
        {
          id: 'file-2',
          originalFilename: 'image.png',
          mimeType: 'image/png',
          size: 2048,
        },
      ]

      mockRepos.files.findByLinkedTo.mockResolvedValue(chatFiles)

      const result = await loadAndProcessFiles(
        mockRepos,
        'chat-1',
        'user-1',
        { provider: 'openai' } as any,
        ['file-1', 'file-2']
      )

      expect(result.attachedFiles).toHaveLength(2)
      expect(result.attachedFiles[0]).toMatchObject({
        id: 'file-1',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
      })
      expect(mockRepos.files.findByLinkedTo).toHaveBeenCalledWith('chat-1')
    })

    it('should return empty result when no file IDs provided', async () => {
      const result = await loadAndProcessFiles(
        mockRepos,
        'chat-1',
        'user-1',
        { provider: 'openai' } as any,
        []
      )

      expect(result).toEqual({
        attachedFiles: [],
        fileAttachments: [],
        fallbackResults: [],
        messageContentPrefix: '',
        attachmentsToSend: [],
      })
      expect(mockRepos.files.findByLinkedTo).not.toHaveBeenCalled()
    })

    it('should handle undefined file IDs', async () => {
      const result = await loadAndProcessFiles(
        mockRepos,
        'chat-1',
        'user-1',
        { provider: 'openai' } as any,
        undefined
      )

      expect(result.attachedFiles).toEqual([])
    })

    it('should filter files not in the provided IDs list', async () => {
      const chatFiles = [
        {
          id: 'file-1',
          originalFilename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        },
        {
          id: 'file-2',
          originalFilename: 'image.png',
          mimeType: 'image/png',
          size: 2048,
        },
      ]

      mockRepos.files.findByLinkedTo.mockResolvedValue(chatFiles)

      const result = await loadAndProcessFiles(
        mockRepos,
        'chat-1',
        'user-1',
        { provider: 'openai' } as any,
        ['file-1']
      )

      expect(result.attachedFiles).toHaveLength(1)
      expect(result.attachedFiles[0].id).toBe('file-1')
    })
  })

  describe('buildMessageContext', () => {
    it('should build message context for single-character chat', async () => {
      const chat = createMockChat({ id: 'chat-1' })
      const character = createMockCharacter({ id: 'char-1', name: 'Alice' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: false,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'Hello Alice',
        isContinueMode: false,
      }

      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hi',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hello!',
          id: 'msg-2',
        },
      ]

      const result = await buildMessageContext(options, existingMessages, [])

      expect(result.builtContext).toBeDefined()
      expect(result.formattedMessages).toBeDefined()
      expect(result.isInitialMessage).toBe(false)
      expect(result.formattedMessages).toHaveLength(2)
    })

    it('should detect initial message when no user messages exist', async () => {
      const chat = createMockChat({ id: 'chat-1' })
      const character = createMockCharacter({ id: 'char-1', name: 'Alice' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: false,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'First message',
        isContinueMode: false,
      }

      const existingMessages = [
        {
          type: 'message',
          role: 'SYSTEM',
          content: 'System prompt',
          id: 'msg-1',
        },
      ]

      const result = await buildMessageContext(options, existingMessages, [])

      expect(result.isInitialMessage).toBe(true)
    })

    it('should attach files to the last user message', async () => {
      const chat = createMockChat({ id: 'chat-1' })
      const character = createMockCharacter({ id: 'char-1' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: false,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'Check this file',
        isContinueMode: false,
      }

      const attachments = [{ id: 'file-1', type: 'image' }]

      const result = await buildMessageContext(options, [], attachments)

      const lastMessage = result.formattedMessages[result.formattedMessages.length - 1]
      expect(lastMessage.attachments).toBeDefined()
      expect(lastMessage.attachments).toEqual(attachments)
    })

    it('should use timestamp config from chat settings', async () => {
      const chat = createMockChat({
        id: 'chat-1',
        timestampConfig: {
          enabled: true,
          mode: 'START_ONLY',
          format: 'iso',
        },
      })
      const character = createMockCharacter({ id: 'char-1' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: false,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'Hello',
        isContinueMode: false,
      }

      const result = await buildMessageContext(options, [], [])

      expect(result).toBeDefined()
    })

    it('should handle multi-character chat context', async () => {
      const chat = createMockChat({
        id: 'chat-1',
        participants: [
          createMockChatParticipant({
            type: 'CHARACTER',
            characterId: 'char-1',
          }),
          createMockChatParticipant({
            type: 'CHARACTER',
            characterId: 'char-2',
          }),
        ],
      })
      const character = createMockCharacter({ id: 'char-1', name: 'Alice' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const participantCharacters = new Map([
        ['char-1', createMockCharacter({ id: 'char-1', name: 'Alice' })],
        ['char-2', createMockCharacter({ id: 'char-2', name: 'Bob' })],
      ])

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: true,
        participantCharacters,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'Hello everyone',
        isContinueMode: false,
      }

      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hi',
          id: 'msg-1',
          participantId: null,
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hello from Alice!',
          id: 'msg-2',
          participantId: 'char-1',
        },
      ]

      const result = await buildMessageContext(options, existingMessages, [])

      expect(result).toBeDefined()
      expect(result.formattedMessages).toBeDefined()
    })

    // Phase E + Phase I: project context no longer passes through the
    // context-builder pipeline — it now ships exclusively as Prospero whispers
    // (chat-start emit + cadence-based refresh in the orchestrator), so the
    // `projectContext` option has been removed from buildMessageContext /
    // buildContext.

    it('should pass compression settings to buildContext', async () => {
      const buildContextMock = require('@/lib/chat/context-manager').buildContext

      const chat = createMockChat({ id: 'chat-1' })
      const character = createMockCharacter({ id: 'char-1' })
      const characterParticipant = createMockChatParticipant({
        type: 'CHARACTER',
        characterId: 'char-1',
      })

      const compressionSettings = {
        enabled: true,
        mode: 'auto' as const,
        targetTokens: 1000,
      }

      const cheapLLMSelection = {
        provider: 'openai' as const,
        modelName: 'gpt-3.5-turbo',
        apiKey: 'test-key',
        baseUrl: null,
      }

      const options = {
        repos: mockRepos,
        userId: 'user-1',
        chat,
        character,
        characterParticipant,
        connectionProfile: {
          provider: 'openai',
          modelName: 'gpt-4',
        } as any,
        persona: null,
        isMultiCharacter: false,
        roleplayTemplate: null,
        chatSettings: null,
        newUserMessage: 'Hello',
        isContinueMode: false,
        contextCompressionSettings: compressionSettings,
        cheapLLMSelection,
      }

      await buildMessageContext(options, [], [])

      expect(buildContextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contextCompressionSettings: compressionSettings,
          cheapLLMSelection,
        })
      )
    })
  })
})
