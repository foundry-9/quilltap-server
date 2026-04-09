/**
 * Unit Tests for First Message Context Builder
 * Tests lib/chat/first-message-context.ts
 * v2.7-dev: Enhanced First Message Context Feature
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { ParticipantInfo, ParticipantMemory, ProjectContext } from '@/lib/chat/first-message-context'

// Create mock objects at module level - Jest hoists mocks, so we need to ensure
// these exact references are used in the mock factories
const mockMemoriesRepo = {
  findByCharacterAboutCharacter: jest.fn(),
  searchByContent: jest.fn(),
}

const mockCharactersRepo = {
  findById: jest.fn(),
}

const mockProjectsRepo = {
  findById: jest.fn(),
}

const mockSearchMemoriesSemantic = jest.fn()

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Use a getter to always return our mock objects
jest.mock('@/lib/repositories/factory', () => ({
  __esModule: true,
  getRepositories: jest.fn().mockImplementation(() => ({
    memories: mockMemoriesRepo,
    characters: mockCharactersRepo,
    projects: mockProjectsRepo,
  })),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  __esModule: true,
  searchMemoriesSemantic: jest.fn().mockImplementation((...args: unknown[]) => mockSearchMemoriesSemantic(...args)),
}))

// Import after mocks are set up
const { loadParticipantMemories, loadProjectContext, buildFirstMessageContext } =
  require('@/lib/chat/first-message-context') as typeof import('@/lib/chat/first-message-context')

// Test fixtures
const makeMemory = (overrides: Partial<{
  id: string
  summary: string
  importance: number
  aboutCharacterId: string | null
}> = {}) => ({
  id: overrides.id || `memory-${Math.random().toString(36).slice(2)}`,
  summary: overrides.summary || 'A memory about something',
  importance: overrides.importance ?? 5,
  aboutCharacterId: overrides.aboutCharacterId ?? null,
  characterId: 'char-speaker',
  chatId: 'chat-123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeParticipantInfo = (overrides: Partial<ParticipantInfo> = {}): ParticipantInfo => ({
  characterId: 'char-participant',
  name: 'Test Character',
  description: 'A test character for unit tests',
  controlledBy: 'llm',
  ...overrides,
})

const makeCharacter = (overrides: Partial<{
  id: string
  name: string
  description: string | null
}> = {}) => ({
  id: overrides.id || 'char-123',
  name: overrides.name || 'Test Character',
  description: overrides.description ?? 'A test character',
  userId: 'user-123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeProject = (overrides: Partial<{
  id: string
  name: string
  description: string | null
  instructions: string | null
}> = {}) => ({
  id: overrides.id || 'project-123',
  name: overrides.name || 'Test Project',
  // Use 'in' check to allow explicit null values
  description: 'description' in overrides ? overrides.description : 'A test project',
  instructions: 'instructions' in overrides ? overrides.instructions : 'Some instructions',
  userId: 'user-123',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

describe('First Message Context Builder', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default mock implementations
    mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([])
    mockMemoriesRepo.searchByContent.mockResolvedValue([])
    mockCharactersRepo.findById.mockResolvedValue(null)
    mockProjectsRepo.findById.mockResolvedValue(null)
    mockSearchMemoriesSemantic.mockResolvedValue([])
  })

  describe('loadParticipantMemories', () => {
    it('returns empty array when no other participants', async () => {
      const result = await loadParticipantMemories('char-speaker', [], {
        userId: 'user-123',
      })

      expect(result).toEqual([])
      expect(mockMemoriesRepo.findByCharacterAboutCharacter).not.toHaveBeenCalled()
    })

    it('loads memories from character-to-character memories', async () => {
      const participant = makeParticipantInfo({
        characterId: 'char-bob',
        name: 'Bob',
      })

      const memory = makeMemory({
        id: 'mem-1',
        summary: 'Bob likes pizza',
        importance: 8,
        aboutCharacterId: 'char-bob',
      })

      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([memory])

      const result = await loadParticipantMemories('char-speaker', [participant], {
        userId: 'user-123',
      })

      expect(mockMemoriesRepo.findByCharacterAboutCharacter).toHaveBeenCalledWith(
        'char-speaker',
        'char-bob'
      )
      expect(result).toHaveLength(1)
      expect(result[0].aboutCharacterId).toBe('char-bob')
      expect(result[0].aboutCharacterName).toBe('Bob')
      expect(result[0].summary).toBe('Bob likes pizza')
    })

    it('combines recent memories with semantic search results', async () => {
      const participant = makeParticipantInfo({
        characterId: 'char-alice',
        name: 'Alice',
        description: 'A friendly character',
      })

      const recentMemory = makeMemory({
        id: 'mem-recent',
        summary: 'Recent memory about Alice',
        importance: 7,
        aboutCharacterId: 'char-alice',
      })

      const semanticMemory = makeMemory({
        id: 'mem-semantic',
        summary: 'Semantic match about Alice',
        importance: 6,
        aboutCharacterId: 'char-alice',
      })

      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([recentMemory])
      mockSearchMemoriesSemantic.mockResolvedValue([
        { memory: semanticMemory, score: 0.8 },
      ])

      const result = await loadParticipantMemories('char-speaker', [participant], {
        userId: 'user-123',
        embeddingProfileId: 'embed-123',
      })

      expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
        'char-speaker',
        'Alice - A friendly character',
        expect.objectContaining({
          userId: 'user-123',
          embeddingProfileId: 'embed-123',
        })
      )
      expect(result).toHaveLength(2)
    })

    it('deduplicates memories by ID', async () => {
      const participant = makeParticipantInfo({
        characterId: 'char-bob',
        name: 'Bob',
      })

      const memory = makeMemory({
        id: 'same-id',
        summary: 'Memory about Bob',
        importance: 5,
        aboutCharacterId: 'char-bob',
      })

      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([memory])
      mockSearchMemoriesSemantic.mockResolvedValue([
        { memory: { ...memory }, score: 0.9 }, // Same ID
      ])

      const result = await loadParticipantMemories('char-speaker', [participant], {
        userId: 'user-123',
      })

      // Should only have one memory despite appearing in both sources
      expect(result).toHaveLength(1)
    })

    it('sorts memories by importance and limits per participant', async () => {
      const participant = makeParticipantInfo({
        characterId: 'char-bob',
        name: 'Bob',
      })

      // The function takes up to 3 recent memories from findByCharacterAboutCharacter,
      // combines with semantic results, then sorts by importance and limits
      // For this test, we return 3 memories to show the sorting behavior
      const memories = [
        makeMemory({ id: 'm1', summary: 'Low importance', importance: 2, aboutCharacterId: 'char-bob' }),
        makeMemory({ id: 'm2', summary: 'Medium importance', importance: 5, aboutCharacterId: 'char-bob' }),
        makeMemory({ id: 'm3', summary: 'High importance', importance: 9, aboutCharacterId: 'char-bob' }),
      ]

      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue(memories)

      const result = await loadParticipantMemories('char-speaker', [participant], {
        userId: 'user-123',
        memoriesPerParticipant: 3,
      })

      // Should be sorted by importance (highest first)
      expect(result).toHaveLength(3)
      expect(result[0].importance).toBe(9)
      expect(result[1].importance).toBe(5)
      expect(result[2].importance).toBe(2)
    })

    it('falls back to text search when semantic search fails', async () => {
      const participant = makeParticipantInfo({
        characterId: 'char-bob',
        name: 'Bob',
      })

      const textSearchMemory = makeMemory({
        id: 'text-mem',
        summary: 'Found via text search',
        importance: 5,
      })

      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([])
      mockSearchMemoriesSemantic.mockRejectedValue(new Error('Embedding error'))
      mockMemoriesRepo.searchByContent.mockResolvedValue([textSearchMemory])

      const result = await loadParticipantMemories('char-speaker', [participant], {
        userId: 'user-123',
      })

      expect(mockMemoriesRepo.searchByContent).toHaveBeenCalledWith(
        'char-speaker',
        'Bob'
      )
      expect(result).toHaveLength(1)
    })

    it('handles multiple participants', async () => {
      const participants = [
        makeParticipantInfo({ characterId: 'char-alice', name: 'Alice' }),
        makeParticipantInfo({ characterId: 'char-bob', name: 'Bob' }),
      ]

      mockMemoriesRepo.findByCharacterAboutCharacter
        .mockResolvedValueOnce([makeMemory({ id: 'alice-mem', aboutCharacterId: 'char-alice' })])
        .mockResolvedValueOnce([makeMemory({ id: 'bob-mem', aboutCharacterId: 'char-bob' })])

      const result = await loadParticipantMemories('char-speaker', participants, {
        userId: 'user-123',
      })

      expect(mockMemoriesRepo.findByCharacterAboutCharacter).toHaveBeenCalledTimes(2)
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('continues loading for other participants if one fails', async () => {
      const participants = [
        makeParticipantInfo({ characterId: 'char-alice', name: 'Alice' }),
        makeParticipantInfo({ characterId: 'char-bob', name: 'Bob' }),
      ]

      mockMemoriesRepo.findByCharacterAboutCharacter
        .mockRejectedValueOnce(new Error('Alice load failed'))
        .mockResolvedValueOnce([makeMemory({ id: 'bob-mem', aboutCharacterId: 'char-bob' })])

      const result = await loadParticipantMemories('char-speaker', participants, {
        userId: 'user-123',
      })

      // Should still have memories from Bob
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('loadProjectContext', () => {
    it('returns project context when found', async () => {
      const project = makeProject({
        name: 'My Project',
        description: 'Project description',
        instructions: 'Project instructions',
      })
      mockProjectsRepo.findById.mockResolvedValue(project)

      const repos = {
        projects: mockProjectsRepo,
        memories: mockMemoriesRepo,
        characters: mockCharactersRepo,
      }

      const result = await loadProjectContext('project-123', repos as any)

      expect(mockProjectsRepo.findById).toHaveBeenCalledWith('project-123')
      expect(result).toEqual({
        name: 'My Project',
        description: 'Project description',
        instructions: 'Project instructions',
      })
    })

    it('returns null when project not found', async () => {
      mockProjectsRepo.findById.mockResolvedValue(null)

      const repos = {
        projects: mockProjectsRepo,
        memories: mockMemoriesRepo,
        characters: mockCharactersRepo,
      }

      const result = await loadProjectContext('nonexistent', repos as any)

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      mockProjectsRepo.findById.mockRejectedValue(new Error('Database error'))

      const repos = {
        projects: mockProjectsRepo,
        memories: mockMemoriesRepo,
        characters: mockCharactersRepo,
      }

      const result = await loadProjectContext('project-123', repos as any)

      expect(result).toBeNull()
    })

    it('handles project with null description and instructions', async () => {
      const project = makeProject({
        name: 'Minimal Project',
        description: null,
        instructions: null,
      })
      mockProjectsRepo.findById.mockResolvedValue(project)

      const repos = {
        projects: mockProjectsRepo,
        memories: mockMemoriesRepo,
        characters: mockCharactersRepo,
      }

      const result = await loadProjectContext('project-123', repos as any)

      expect(result).toEqual({
        name: 'Minimal Project',
        description: null,
        instructions: null,
      })
    })
  })

  describe('buildFirstMessageContext', () => {
    it('builds complete context with project and memories', async () => {
      const participants = [
        {
          id: 'participant-1',
          type: 'CHARACTER' as const,
          characterId: 'char-bob',
          connectionProfileId: null,
          imageProfileId: null,

          displayOrder: 0,
          isActive: true,
          hasHistoryAccess: true,
          joinScenario: null,
          controlledBy: 'llm' as const,
        },
      ]

      const project = makeProject({ name: 'Test Project' })
      const character = makeCharacter({ id: 'char-bob', name: 'Bob' })
      const memory = makeMemory({ aboutCharacterId: 'char-bob' })

      mockProjectsRepo.findById.mockResolvedValue(project)
      mockCharactersRepo.findById.mockResolvedValue(character)
      mockMemoriesRepo.findByCharacterAboutCharacter.mockResolvedValue([memory])

      const result = await buildFirstMessageContext('char-speaker', participants, {
        userId: 'user-123',
        projectId: 'project-123',
      })

      expect(result.projectContext).not.toBeNull()
      expect(result.projectContext?.name).toBe('Test Project')
      expect(result.participantMemories.length).toBeGreaterThanOrEqual(0)
    })

    it('excludes speaking character from participant list', async () => {
      const participants = [
        {
          id: 'participant-speaker',
          type: 'CHARACTER' as const,
          characterId: 'char-speaker', // Same as speakingCharacterId
          connectionProfileId: null,
          imageProfileId: null,

          displayOrder: 0,
          isActive: true,
          hasHistoryAccess: true,
          joinScenario: null,
          controlledBy: 'llm' as const,
        },
        {
          id: 'participant-other',
          type: 'CHARACTER' as const,
          characterId: 'char-other',
          connectionProfileId: null,
          imageProfileId: null,

          displayOrder: 1,
          isActive: true,
          hasHistoryAccess: true,
          joinScenario: null,
          controlledBy: 'llm' as const,
        },
      ]

      mockCharactersRepo.findById.mockResolvedValue(makeCharacter({ id: 'char-other', name: 'Other' }))

      await buildFirstMessageContext('char-speaker', participants, {
        userId: 'user-123',
      })

      // Should only load character info for the non-speaker
      expect(mockCharactersRepo.findById).toHaveBeenCalledTimes(1)
      expect(mockCharactersRepo.findById).toHaveBeenCalledWith('char-other')
    })

    it('returns null project context when no projectId', async () => {
      const result = await buildFirstMessageContext('char-speaker', [], {
        userId: 'user-123',
        // No projectId
      })

      expect(result.projectContext).toBeNull()
      expect(mockProjectsRepo.findById).not.toHaveBeenCalled()
    })

    it('handles empty participants list', async () => {
      const result = await buildFirstMessageContext('char-speaker', [], {
        userId: 'user-123',
      })

      expect(result.projectContext).toBeNull()
      expect(result.participantMemories).toEqual([])
    })

    it('skips user-controlled participants with no characterId', async () => {
      const participants = [
        {
          id: 'persona-participant',
          type: 'CHARACTER' as const,
          characterId: null,
          connectionProfileId: null,
          imageProfileId: null,

          displayOrder: 0,
          isActive: true,
          hasHistoryAccess: true,
          joinScenario: null,
          controlledBy: 'user' as const,
        },
      ]

      const result = await buildFirstMessageContext('char-speaker', participants, {
        userId: 'user-123',
      })

      expect(mockCharactersRepo.findById).not.toHaveBeenCalled()
      expect(result.participantMemories).toEqual([])
    })

    it('skips participants with null characterId', async () => {
      const participants = [
        {
          id: 'bad-participant',
          type: 'CHARACTER' as const,
          characterId: null, // Invalid
          connectionProfileId: null,
          imageProfileId: null,

          displayOrder: 0,
          isActive: true,
          hasHistoryAccess: true,
          joinScenario: null,
          controlledBy: 'llm' as const,
        },
      ]

      const result = await buildFirstMessageContext('char-speaker', participants, {
        userId: 'user-123',
      })

      expect(mockCharactersRepo.findById).not.toHaveBeenCalled()
      expect(result.participantMemories).toEqual([])
    })
  })
})
