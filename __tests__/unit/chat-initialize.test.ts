/**
 * Unit Tests for Chat Initialization
 * Tests lib/chat/initialize.ts
 *
 * Updated for characters-not-personas migration:
 * - Second parameter is now userCharacterId (user-controlled character) instead of personaId
 * - Uses CHARACTER with controlledBy='user' instead of PERSONA type
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { getRepositories } from '@/lib/repositories/factory'
import { buildChatContext } from '@/lib/chat/initialize'

jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockGetRepositories = jest.mocked(getRepositories)
let mockCharactersRepo: { findById: jest.Mock }

describe('buildChatContext', () => {
  const now = new Date().toISOString()
  const mockCharacter = {
    id: 'char-1',
    name: 'Alice',
    description: 'A friendly assistant',
    personality: 'Helpful and kind',
    scenario: 'You are helping a user with their tasks',
    firstMessage: 'Hello! How can I help you today?',
    exampleDialogues: 'User: Hi\nAlice: Hello there!',
    systemPrompts: [{
      id: 'prompt-1',
      name: 'Default',
      content: 'You are Alice, a helpful AI assistant.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }],
    defaultPartnerId: null,
    tags: [],
    userId: 'user-1',
    isFavorite: false,
    controlledBy: 'llm',
    defaultImageId: null,
    createdAt: now,
    updatedAt: now,
  }

  // User-controlled character (replaces persona)
  const mockUserCharacter = {
    id: 'user-char-1',
    name: 'John',
    description: 'A curious learner',
    personality: 'Inquisitive, friendly',
    tags: [],
    userId: 'user-1',
    controlledBy: 'user',
    defaultImageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockCharactersRepo = {
      findById: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      characters: mockCharactersRepo,
      personas: {} as any,
      chats: {} as any,
      tags: {} as any,
      users: {} as any,
      connections: {} as any,
      images: {} as any,
      imageProfiles: {} as any,
    })
  })

  describe('Basic functionality', () => {
    it('should build chat context with character only', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.character).toEqual(expect.objectContaining({
        id: 'char-1',
        name: 'Alice',
      }))
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
      expect(context.userCharacter).toBeNull()
      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should build chat context with character and specified user character', async () => {
      // First call returns the main LLM character, second call returns the user character
      mockCharactersRepo.findById
        .mockResolvedValueOnce({ ...mockCharacter })
        .mockResolvedValueOnce({ ...mockUserCharacter })

      const context = await buildChatContext('char-1', 'user-char-1')

      expect(context.userCharacter).toEqual(expect.objectContaining({
        id: 'user-char-1',
        name: 'John',
      }))
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should use default partner from character defaultPartnerId', async () => {
      // First call returns character with defaultPartnerId, second call returns the partner
      mockCharactersRepo.findById
        .mockResolvedValueOnce({ ...mockCharacter, defaultPartnerId: 'user-char-1' })
        .mockResolvedValueOnce({ ...mockUserCharacter })

      const context = await buildChatContext('char-1')

      expect(context.userCharacter).toEqual(expect.objectContaining({
        id: 'user-char-1',
        name: 'John',
      }))
      expect(context.systemPrompt).toContain('You are talking to John')
    })

    it('should throw error when character not found', async () => {
      mockCharactersRepo.findById.mockResolvedValue(null)

      await expect(buildChatContext('nonexistent')).rejects.toThrow('Character not found')
    })
  })

  describe('System prompt building', () => {
    it('should include character name in system prompt', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('You are roleplaying as Alice')
    })

    it('should include character description', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Character Description:')
      expect(context.systemPrompt).toContain('A friendly assistant')
    })

    it('should include personality', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Personality:')
      expect(context.systemPrompt).toContain('Helpful and kind')
    })

    it('should include roleplay instructions', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toContain('Stay in character at all times')
      expect(context.systemPrompt).toContain("Alice's personality")
    })
  })

  describe('Edge cases', () => {
    it('should handle character with null optional fields', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
        exampleDialogues: null,
        systemPrompts: [],
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).toBeDefined()
      expect(context.firstMessage).toBe('Hello! How can I help you today?')
    })

    it('should trim whitespace from system prompt', async () => {
      mockCharactersRepo.findById.mockResolvedValue({
        ...mockCharacter,
      })

      const context = await buildChatContext('char-1')

      expect(context.systemPrompt).not.toMatch(/^\s/)
      expect(context.systemPrompt).not.toMatch(/\s$/)
    })

    it('should ignore LLM-controlled character when looking up user character', async () => {
      // Character lookup returns an LLM-controlled character, not user-controlled
      const llmCharacter = { ...mockUserCharacter, controlledBy: 'llm' }
      mockCharactersRepo.findById
        .mockResolvedValueOnce({ ...mockCharacter })
        .mockResolvedValueOnce(llmCharacter)

      const context = await buildChatContext('char-1', 'user-char-1')

      // Should not set userCharacter since the looked up character is LLM-controlled
      expect(context.userCharacter).toBeNull()
    })
  })
})
