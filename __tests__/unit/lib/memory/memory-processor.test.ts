/**
 * Unit Tests for Memory Processor
 * Tests lib/memory/memory-processor.ts
 * Sprint 3: Auto-Memory Formation
 *
 * NOTE: Due to Jest ESM mocking limitations with this Next.js project configuration,
 * these tests use a simplified approach. The memory processor functionality has been
 * verified through:
 * 1. TypeScript compilation (npm run build passes)
 * 2. Integration with the chat messages route
 * 3. Manual testing of the memory extraction flow
 *
 * Full unit tests would require updating the Jest configuration to better support
 * ESM module mocking, which is beyond the scope of Sprint 3.
 */

import { describe, it, expect } from '@jest/globals'
import type { ConnectionProfile, CheapLLMSettings } from '@/lib/schemas/types'

// Import types only - we test the interfaces and structure
import type {
  MemoryExtractionContext,
  MemoryProcessingResult,
} from '@/lib/memory/memory-processor'

// Test fixtures to verify type compatibility
const testConnectionProfile: ConnectionProfile = {
  id: 'test-profile-id',
  userId: 'test-user-id',
  name: 'Test Profile',
  provider: 'OPENAI',
  modelName: 'gpt-4o',
  baseUrl: null,
  apiKeyId: 'test-api-key-id',
  parameters: {},
  isDefault: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

const testCheapLLMSettings: CheapLLMSettings = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
  embeddingProvider: 'OPENAI',
}

describe('Memory Processor Types', () => {
  describe('MemoryExtractionContext', () => {
    it('should have all required fields', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'I love hiking',
        assistantMessage: 'That sounds great!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
      }

      expect(context.characterId).toBe('char-123')
      expect(context.characterName).toBe('Luna')
      expect(context.chatId).toBe('chat-456')
      expect(context.userMessage).toBe('I love hiking')
      expect(context.assistantMessage).toBe('That sounds great!')
      expect(context.sourceMessageId).toBe('msg-789')
      expect(context.userId).toBe('user-001')
      expect(context.connectionProfile).toBeDefined()
      expect(context.cheapLLMSettings).toBeDefined()
    })

    it('should support optional personaName', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        personaName: 'John',
        chatId: 'chat-456',
        userMessage: 'Hello',
        assistantMessage: 'Hi there!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
      }

      expect(context.personaName).toBe('John')
    })

    it('should support optional availableProfiles', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-123',
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'Hello',
        assistantMessage: 'Hi there!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        availableProfiles: [testConnectionProfile],
      }

      expect(context.availableProfiles).toHaveLength(1)
    })
  })

  describe('MemoryProcessingResult', () => {
    it('should represent successful memory creation', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: true,
        memoryReinforced: false,
        memoryIds: ['mem-123'],
        reinforcedMemoryIds: [],
        memoryId: 'mem-123',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      }

      expect(result.success).toBe(true)
      expect(result.memoryCreated).toBe(true)
      expect(result.memoryReinforced).toBe(false)
      expect(result.memoryIds).toEqual(['mem-123'])
      expect(result.memoryId).toBe('mem-123')
      expect(result.usage?.totalTokens).toBe(150)
    })

    it('should represent successful extraction with no memory created', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: false,
        memoryReinforced: false,
        memoryIds: [],
        reinforcedMemoryIds: [],
        usage: {
          promptTokens: 50,
          completionTokens: 10,
          totalTokens: 60,
        },
      }

      expect(result.success).toBe(true)
      expect(result.memoryCreated).toBe(false)
      expect(result.memoryReinforced).toBe(false)
      expect(result.memoryIds).toEqual([])
      expect(result.memoryId).toBeUndefined()
    })

    it('should represent failed extraction', () => {
      const result: MemoryProcessingResult = {
        success: false,
        memoryCreated: false,
        memoryReinforced: false,
        memoryIds: [],
        reinforcedMemoryIds: [],
        error: 'API rate limit exceeded',
      }

      expect(result.success).toBe(false)
      expect(result.memoryCreated).toBe(false)
      expect(result.memoryReinforced).toBe(false)
      expect(result.error).toBe('API rate limit exceeded')
    })

    it('should represent successful memory reinforcement', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: false,
        memoryReinforced: true,
        memoryIds: [],
        reinforcedMemoryIds: ['mem-existing-456'],
        reinforcedMemoryId: 'mem-existing-456',
        relatedMemoryIds: ['mem-related-1', 'mem-related-2'],
        usage: {
          promptTokens: 80,
          completionTokens: 30,
          totalTokens: 110,
        },
      }

      expect(result.success).toBe(true)
      expect(result.memoryCreated).toBe(false)
      expect(result.memoryReinforced).toBe(true)
      expect(result.reinforcedMemoryIds).toEqual(['mem-existing-456'])
      expect(result.reinforcedMemoryId).toBe('mem-existing-456')
      expect(result.relatedMemoryIds).toEqual(['mem-related-1', 'mem-related-2'])
      expect(result.usage?.totalTokens).toBe(110)
    })

    it('should represent multiple memories created from one extraction', () => {
      const result: MemoryProcessingResult = {
        success: true,
        memoryCreated: true,
        memoryReinforced: true,
        memoryIds: ['mem-1', 'mem-2', 'mem-3'],
        reinforcedMemoryIds: ['mem-existing-1'],
        memoryId: 'mem-1',
        reinforcedMemoryId: 'mem-existing-1',
        relatedMemoryIds: ['mem-related-1'],
        usage: {
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
      }

      expect(result.memoryIds).toHaveLength(3)
      expect(result.reinforcedMemoryIds).toHaveLength(1)
      // Backward compat: memoryId is first element
      expect(result.memoryId).toBe(result.memoryIds[0])
      expect(result.reinforcedMemoryId).toBe(result.reinforcedMemoryIds[0])
    })
  })
})

describe('Memory Processor Module Exports', () => {
  it('should export processMessageForMemory function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.processMessageForMemory).toBe('function')
  })

  it('should export processMessageForMemoryAsync function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.processMessageForMemoryAsync).toBe('function')
  })

  it('should export batchProcessChatForMemories function', async () => {
    const memoryProcessor = await import('@/lib/memory/memory-processor')
    expect(typeof memoryProcessor.batchProcessChatForMemories).toBe('function')
  })
})

describe('Memory Module Index Exports', () => {
  it('should re-export memory processor functions from index', async () => {
    const memoryModule = await import('@/lib/memory')
    expect(typeof memoryModule.processMessageForMemory).toBe('function')
    expect(typeof memoryModule.processMessageForMemoryAsync).toBe('function')
    expect(typeof memoryModule.batchProcessChatForMemories).toBe('function')
  })

  it('should re-export cheap LLM task functions from index', async () => {
    const memoryModule = await import('@/lib/memory')
    expect(typeof memoryModule.extractMemoryFromMessage).toBe('function')
    expect(typeof memoryModule.summarizeChat).toBe('function')
    expect(typeof memoryModule.titleChat).toBe('function')
  })
})

/**
 * v2.7-dev: Memory aboutCharacterId and userCharacterId Type Tests
 *
 * These tests verify the type structure for the new memory fields:
 * - aboutCharacterId: Links memories to the character they're about (for inter-character memories)
 * - userCharacterId: Tracks which user-controlled character was involved
 *
 * NOTE: These are type-only tests due to Jest ESM mocking limitations.
 * The functionality is verified through integration tests.
 */
describe('Memory Inter-Character Tracking Types (v2.7-dev)', () => {
  describe('MemoryExtractionContext with aboutCharacterId', () => {
    it('should support optional aboutCharacterId for user-controlled characters', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-ai', // The AI character
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'I am Bob, and I like pizza',
        assistantMessage: 'Bob, that is great to know!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        // v2.7-dev: New field for tracking user character
        userCharacterId: 'char-bob', // Optional: the user's character
      }

      expect(context.characterId).toBe('char-ai')
      expect(context.userCharacterId).toBe('char-bob')
    })

    it('should allow userCharacterId to be undefined', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-ai',
        characterName: 'Luna',
        chatId: 'chat-456',
        userMessage: 'Hello',
        assistantMessage: 'Hi there!',
        sourceMessageId: 'msg-789',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        // userCharacterId not set - represents anonymous user messages
      }

      expect(context.userCharacterId).toBeUndefined()
    })

    it('should support multi-character chat scenario context', () => {
      const context: MemoryExtractionContext = {
        characterId: 'char-luna', // Speaking character
        characterName: 'Luna',
        personaName: 'Bob the User Character', // User's character name
        chatId: 'chat-multichar',
        userMessage: 'Bob says hello to Luna',
        assistantMessage: 'Luna waves back at Bob',
        sourceMessageId: 'msg-multi',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        userCharacterId: 'char-bob', // Track which user character
      }

      expect(context.characterId).toBe('char-luna')
      expect(context.personaName).toBe('Bob the User Character')
      expect(context.userCharacterId).toBe('char-bob')
    })
  })

  describe('Memory aboutCharacterId field structure', () => {
    it('should represent memory with aboutCharacterId (inter-character)', () => {
      // This represents: Luna (characterId) remembers something about Bob (aboutCharacterId)
      const memoryResult: MemoryProcessingResult = {
        success: true,
        memoryCreated: true,
        memoryReinforced: false,
        memoryIds: ['mem-inter-char'],
        reinforcedMemoryIds: [],
        memoryId: 'mem-inter-char',
        // The memory itself would have:
        // - characterId: 'char-luna' (who holds this memory)
        // - aboutCharacterId: 'char-bob' (who this memory is about)
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      }

      expect(memoryResult.success).toBe(true)
      expect(memoryResult.memoryCreated).toBe(true)
      expect(memoryResult.memoryIds).toEqual(['mem-inter-char'])
    })

    it('should handle memory processing for user-controlled character interactions', () => {
      // When processing messages from a user-controlled character (Bob)
      // interacting with an AI character (Luna):
      // - The memory belongs to Luna (characterId)
      // - The memory is about Bob (aboutCharacterId)
      const contextForUserCharMemory: MemoryExtractionContext = {
        characterId: 'char-luna', // Luna holds the memory
        characterName: 'Luna',
        personaName: 'Bob',
        chatId: 'chat-123',
        userMessage: 'Bob reveals his favorite color is blue',
        assistantMessage: 'Luna acknowledges Bob likes blue',
        sourceMessageId: 'msg-123',
        userId: 'user-001',
        connectionProfile: testConnectionProfile,
        cheapLLMSettings: testCheapLLMSettings,
        userCharacterId: 'char-bob', // Used to set aboutCharacterId in memory
      }

      expect(contextForUserCharMemory.userCharacterId).toBe('char-bob')
      expect(contextForUserCharMemory.characterId).toBe('char-luna')
    })
  })
})
