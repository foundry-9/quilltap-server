/**
 * Unit Tests for Memory Recap Service
 * Tests lib/memory/memory-recap.ts
 * Covers memory recap generation including tiered fetching, formatting,
 * LLM summarization, and error handling.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { Memory } from '@/lib/schemas/types'

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  summarizeMemoryRecap: jest.fn(),
}))

jest.mock('@/lib/memory/memory-weighting', () => ({
  formatRelativeAge: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

// Get mocked modules via requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const cheapLlmMock = jest.requireMock('@/lib/memory/cheap-llm-tasks') as {
  summarizeMemoryRecap: jest.Mock
}
const weightingMock = jest.requireMock('@/lib/memory/memory-weighting') as {
  formatRelativeAge: jest.Mock
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockSummarizeMemoryRecap = cheapLlmMock.summarizeMemoryRecap
const mockFormatRelativeAge = weightingMock.formatRelativeAge

// Mock repository
const mockFindRecentByImportanceTier = jest.fn()
const mockRepos = {
  memories: {
    findRecentByImportanceTier: mockFindRecentByImportanceTier,
  },
}

// Test fixtures
const testSelection: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
  connectionProfileId: 'test-profile-id',
  isLocal: false,
}

const testUserId = 'test-user-id'
const testCharacterId = 'char-123'
const testCharacterName = 'Luna'
const testChatId = 'chat-456'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    characterId: testCharacterId,
    content: 'Test memory content',
    summary: 'Test memory summary',
    importance: 0.8,
    keywords: ['test'],
    sourceMessageId: 'msg-1',
    sourceChatId: 'chat-1',
    createdAt: new Date('2026-03-01T00:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
    accessCount: 1,
    lastAccessedAt: new Date('2026-03-15T00:00:00Z'),
    ...overrides,
  } as Memory
}

describe('Memory Recap Service', () => {
  // Fresh import for each test to ensure mocks are picked up
  let generateMemoryRecap: typeof import('@/lib/memory/memory-recap').generateMemoryRecap

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos)
    mockFormatRelativeAge.mockReturnValue('2 days ago')

    // Re-import the module under test so it picks up mocked dependencies
    jest.isolateModules(() => {
      const mod = require('@/lib/memory/memory-recap')
      generateMemoryRecap = mod.generateMemoryRecap
    })
  })

  describe('generateMemoryRecap', () => {
    it('should return empty result when no memories exist', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [],
        medium: [],
        low: [],
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
      expect(mockSummarizeMemoryRecap).not.toHaveBeenCalled()
    })

    it('should fetch memories by importance tier', async () => {
      const highMemory = makeMemory({ id: 'high-1', summary: 'Important event', importance: 0.9 })
      const medMemory = makeMemory({ id: 'med-1', summary: 'Medium event', importance: 0.5 })
      const lowMemory = makeMemory({ id: 'low-1', summary: 'Minor event', importance: 0.2 })

      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [highMemory],
        medium: [medMemory],
        low: [lowMemory],
      })

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'Luna recalls important and minor events.',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      })

      await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(mockFindRecentByImportanceTier).toHaveBeenCalledWith(testCharacterId)
    })

    it('should format memories with relative age', async () => {
      const mem1 = makeMemory({ id: 'mem-1', summary: 'First memory' })
      const mem2 = makeMemory({ id: 'mem-2', summary: 'Second memory' })

      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [mem1],
        medium: [mem2],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValueOnce('5 minutes ago').mockReturnValueOnce('1 week ago')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'Summary text.',
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      })

      await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      // Verify formatRelativeAge was called for each memory
      expect(mockFormatRelativeAge).toHaveBeenCalledTimes(2)
      expect(mockFormatRelativeAge).toHaveBeenCalledWith(mem1, expect.any(Date))
      expect(mockFormatRelativeAge).toHaveBeenCalledWith(mem2, expect.any(Date))

      // Verify summarizeMemoryRecap received formatted memories with age labels
      expect(mockSummarizeMemoryRecap).toHaveBeenCalledWith(
        testCharacterName,
        {
          high: [{ summary: 'First memory', age: '5 minutes ago' }],
          medium: [{ summary: 'Second memory', age: '1 week ago' }],
          low: [],
        },
        testSelection,
        testUserId,
        undefined, // no chatId passed
        undefined  // no uncensored fallback
      )
    })

    it('should call LLM summarization with formatted memories', async () => {
      const highMem = makeMemory({ id: 'h1', summary: 'User loves cats', importance: 0.9 })
      const medMem = makeMemory({ id: 'm1', summary: 'User visited Paris', importance: 0.5 })

      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [highMem],
        medium: [medMem],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('recently')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'Luna remembers that the user loves cats and visited Paris.',
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
      })

      await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(mockSummarizeMemoryRecap).toHaveBeenCalledWith(
        testCharacterName,
        {
          high: [{ summary: 'User loves cats', age: 'recently' }],
          medium: [{ summary: 'User visited Paris', age: 'recently' }],
          low: [],
        },
        testSelection,
        testUserId,
        testChatId,
        undefined
      )
    })

    it('should return formatted content and memoriesUsed count', async () => {
      const memories = [
        makeMemory({ id: 'h1', importance: 0.9 }),
        makeMemory({ id: 'h2', importance: 0.8 }),
      ]

      mockFindRecentByImportanceTier.mockResolvedValue({
        high: memories,
        medium: [makeMemory({ id: 'm1', importance: 0.5 })],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('just now')

      const recapText = 'Luna vividly remembers several important events.'
      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: recapText,
        usage: { promptTokens: 200, completionTokens: 50, totalTokens: 250 },
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(result.memoriesUsed).toBe(3) // 2 high + 1 medium + 0 low
      expect(result.content).toContain('## What You Remember')
      expect(result.content).toContain(`As ${testCharacterName}`)
      expect(result.content).toContain(recapText)
    })

    it('should include usage stats from LLM response', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      const expectedUsage = { promptTokens: 300, completionTokens: 80, totalTokens: 380 }
      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'A recap of memories.',
        usage: expectedUsage,
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      expect(result.usage).toEqual(expectedUsage)
    })

    it('should handle LLM failure gracefully and return empty result', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: false,
        error: 'API rate limit exceeded',
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
    })

    it('should return empty result when LLM returns empty string', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: '',
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
    })

    it('should return empty result when LLM returns null result', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: undefined,
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
    })

    it('should pass uncensored fallback options when provided', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'Recap with uncensored fallback.',
        usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
      })

      const uncensoredFallback = {
        dangerSettings: {
          mode: 'AUTO_ROUTE' as const,
          uncensoredTextProfileId: 'uncensored-profile-id',
        },
        availableProfiles: [
          { id: 'uncensored-profile-id', name: 'Uncensored Provider' },
        ],
        isDangerousChat: true,
      }

      await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId,
        uncensoredFallback as any
      )

      expect(mockSummarizeMemoryRecap).toHaveBeenCalledWith(
        testCharacterName,
        expect.any(Object),
        testSelection,
        testUserId,
        testChatId,
        uncensoredFallback
      )
    })

    it('should handle repository errors gracefully', async () => {
      mockFindRecentByImportanceTier.mockRejectedValue(
        new Error('Database connection failed')
      )

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId,
        testChatId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
    })

    it('should handle summarization throwing an exception', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory()],
        medium: [],
        low: [],
      })

      mockFormatRelativeAge.mockReturnValue('1 day ago')

      mockSummarizeMemoryRecap.mockRejectedValue(
        new Error('Network timeout')
      )

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      expect(result).toEqual({ content: '', memoriesUsed: 0 })
    })

    it('should count memories across all tiers correctly', async () => {
      mockFindRecentByImportanceTier.mockResolvedValue({
        high: [makeMemory({ id: 'h1' }), makeMemory({ id: 'h2' }), makeMemory({ id: 'h3' })],
        medium: [makeMemory({ id: 'm1' }), makeMemory({ id: 'm2' })],
        low: [makeMemory({ id: 'l1' })],
      })

      mockFormatRelativeAge.mockReturnValue('recently')

      mockSummarizeMemoryRecap.mockResolvedValue({
        success: true,
        result: 'A rich recap of many memories.',
        usage: { promptTokens: 400, completionTokens: 100, totalTokens: 500 },
      })

      const result = await generateMemoryRecap(
        testCharacterId,
        testCharacterName,
        testSelection,
        testUserId
      )

      expect(result.memoriesUsed).toBe(6) // 3 + 2 + 1
      expect(mockFormatRelativeAge).toHaveBeenCalledTimes(6)
    })
  })
})
