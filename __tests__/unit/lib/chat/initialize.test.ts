/**
 * Unit tests for lib/chat/initialize.ts
 * Tests buildChatContext for chat initialization and greeting generation
 */

import { buildChatContext } from '@/lib/chat/initialize'
import { createMockCharacter } from '../fixtures/test-factories'
import type { RepositoryContainer } from '@/lib/repositories/factory'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/templates/processor', () => ({
  processCharacterTemplates: jest.fn((input) => ({
    ...input.character,
    firstMessage: input.character.firstMessage || 'Default greeting',
  })),
  processTemplate: jest.fn((template) => template),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
}))

let mockRepos: any

function createMockRepositories(): RepositoryContainer {
  return {
    characters: {
      findById: jest.fn(),
    },
  } as any
}

describe('chat/initialize', () => {
  beforeEach(() => {
    mockRepos = createMockRepositories()
    jest.clearAllMocks()
  })

  describe('buildChatContext', () => {
    it('should build chat context for a character', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        description: 'A helpful assistant',
        personality: 'Friendly and knowledgeable',
        scenario: 'You are in a library',
        firstMessage: 'Hello! How can I help you today?',
        systemPrompts: [
          {
            id: 'prompt-1',
            name: 'Default',
            content: 'You are Alice, a helpful assistant.',
            isDefault: true,
          },
        ],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1')

      expect(result).toMatchObject({
        systemPrompt: expect.any(String),
        firstMessage: expect.any(String),
        character: expect.objectContaining({
          id: 'char-1',
          name: 'Alice',
        }),
        userCharacter: null,
      })
    })

    it('should throw error when character not found', async () => {
      mockRepos.characters.findById.mockResolvedValue(null)

      await expect(buildChatContext('char-999')).rejects.toThrow('Character not found')
    })

    it('should load user-controlled character when provided', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        controlledBy: 'llm',
      })

      const userCharacter = createMockCharacter({
        id: 'char-2',
        name: 'Bob',
        description: 'A brave adventurer',
        personality: 'Bold and curious',
        controlledBy: 'user',
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter) // First call for AI character
        .mockResolvedValueOnce(userCharacter) // Second call for user character

      const result = await buildChatContext('char-1', 'char-2')

      expect(result.userCharacter).toMatchObject({
        id: 'char-2',
        name: 'Bob',
        description: 'A brave adventurer',
        personality: 'Bold and curious',
      })
    })

    it('should use default partner if no user character specified', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        defaultPartnerId: 'char-2',
        controlledBy: 'llm',
      })

      const defaultPartner = createMockCharacter({
        id: 'char-2',
        name: 'Default Partner',
        controlledBy: 'user',
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter)
        .mockResolvedValueOnce(defaultPartner)

      const result = await buildChatContext('char-1')

      expect(result.userCharacter).toMatchObject({
        id: 'char-2',
        name: 'Default Partner',
      })
    })

    it('should handle custom scenario override', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        scenario: 'Default scenario',
        systemPrompts: [
          {
            id: 'prompt-1',
            name: 'Default',
            content: 'Default system prompt',
            isDefault: true,
          },
        ],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1', undefined, 'Custom scenario: In a spaceship')

      expect(result).toBeDefined()
      // The custom scenario should be passed to the system prompt builder
    })

    it('should handle character without system prompts', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        systemPrompts: [],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1')

      expect(result).toBeDefined()
      expect(result.systemPrompt).toBeDefined()
    })

    it('should handle character with multiple system prompts', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        systemPrompts: [
          {
            id: 'prompt-1',
            name: 'Prompt 1',
            content: 'First prompt',
            isDefault: false,
          },
          {
            id: 'prompt-2',
            name: 'Default Prompt',
            content: 'Default prompt content',
            isDefault: true,
          },
          {
            id: 'prompt-3',
            name: 'Prompt 3',
            content: 'Third prompt',
            isDefault: false,
          },
        ],
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1')

      expect(result).toBeDefined()
    })

    it('should handle character with null scenario', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        scenario: null,
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1')

      expect(result).toBeDefined()
    })

    it('should handle character with empty first message', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        firstMessage: '',
      })

      mockRepos.characters.findById.mockResolvedValue(character)

      const result = await buildChatContext('char-1')

      expect(result.firstMessage).toBeDefined()
    })

    it('should set both persona and userCharacter for backwards compatibility', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
      })

      const userCharacter = createMockCharacter({
        id: 'char-2',
        name: 'Bob',
        controlledBy: 'user',
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter)
        .mockResolvedValueOnce(userCharacter)

      const result = await buildChatContext('char-1', 'char-2')

      expect(result.persona).toMatchObject({
        id: 'char-2',
        name: 'Bob',
      })
      expect(result.userCharacter).toMatchObject({
        id: 'char-2',
        name: 'Bob',
      })
    })

    it('should not use default partner if user character explicitly specified', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        defaultPartnerId: 'char-default',
      })

      const userCharacter = createMockCharacter({
        id: 'char-2',
        name: 'Bob',
        controlledBy: 'user',
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter)
        .mockResolvedValueOnce(userCharacter)

      const result = await buildChatContext('char-1', 'char-2')

      expect(result.userCharacter?.id).toBe('char-2')
      expect(mockRepos.characters.findById).toHaveBeenCalledTimes(2)
    })

    it('should handle user character that is not user-controlled', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
      })

      const nonUserControlledChar = createMockCharacter({
        id: 'char-2',
        name: 'Bob',
        controlledBy: 'llm', // Not user-controlled!
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter)
        .mockResolvedValueOnce(nonUserControlledChar)

      const result = await buildChatContext('char-1', 'char-2')

      expect(result.userCharacter).toBeNull()
    })

    it('should handle missing default partner', async () => {
      const aiCharacter = createMockCharacter({
        id: 'char-1',
        name: 'Alice',
        defaultPartnerId: 'char-missing',
      })

      mockRepos.characters.findById
        .mockResolvedValueOnce(aiCharacter)
        .mockResolvedValueOnce(null) // Default partner not found

      const result = await buildChatContext('char-1')

      expect(result.userCharacter).toBeNull()
    })
  })
})
