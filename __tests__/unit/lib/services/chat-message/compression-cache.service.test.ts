/**
 * Unit Tests for Compression Cache Service
 * Tests lib/services/chat-message/compression-cache.service.ts
 * v2.7-dev: Async Pre-Compression Feature
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// Define the result type inline to avoid module resolution issues in IDE
interface ContextCompressionResult {
  compressionApplied: boolean
  compressedHistory?: string
  compressedSystemPrompt?: string
  compressionDetails?: {
    originalMessageCount: number
    compressedMessageCount: number
    windowMessageCount: number
    originalHistoryTokens?: number
    compressedHistoryTokens?: number
    originalSystemPromptTokens?: number
    compressedSystemPromptTokens?: number
    totalSavings: number
  }
  warnings: string[]
}

// Define mock at module level with explicit typing
const mockApplyContextCompression = jest.fn<
  (messages: unknown[], systemPrompt: string, options: unknown) => Promise<ContextCompressionResult>
>()

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/chat/context/compression', () => ({
  __esModule: true,
  applyContextCompression: (messages: unknown[], systemPrompt: string, options: unknown) => 
    mockApplyContextCompression(messages, systemPrompt, options),
}))

// Define AsyncCompressionOptions type inline
interface AsyncCompressionOptions {
  chatId: string
  messages: Array<{ role: string; content: string }>
  systemPrompt: string
  compressionOptions: {
    enabled: boolean
    windowSize: number
    compressionTargetTokens: number
    systemPromptTargetTokens: number
    selection: { strategy: string; fallbackToLocal: boolean }
    userId: string
    characterName: string
    userName: string
  }
}

// Import after mocks using require
const {
  triggerAsyncCompression,
  getCachedCompression,
  invalidateCompressionCache,
  clearCompressionCache,
  getCompressionCacheStats,
} = require('@/lib/services/chat-message/compression-cache.service') as {
  triggerAsyncCompression: (options: AsyncCompressionOptions) => void
  getCachedCompression: (chatId: string, messageCount: number) => Promise<ContextCompressionResult | undefined>
  invalidateCompressionCache: (chatId: string) => void
  clearCompressionCache: () => void
  getCompressionCacheStats: () => {
    size: number
    entries: Array<{
      chatId: string
      messageCount: number
      hasResult: boolean
      hasPromise: boolean
      ageMs: number
    }>
  }
}

// Test fixtures
const makeAsyncOptions = (overrides: Partial<AsyncCompressionOptions> = {}): AsyncCompressionOptions => ({
  chatId: 'chat-123',
  messages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
    { role: 'assistant', content: 'I am doing well!' },
    { role: 'user', content: 'Great to hear' },
    { role: 'assistant', content: 'Thanks!' },
  ],
  systemPrompt: 'You are a helpful assistant.',
  compressionOptions: {
    enabled: true,
    windowSize: 2,
    compressionTargetTokens: 2000,
    systemPromptTargetTokens: 1000,
    selection: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
    userId: 'user-123',
    characterName: 'Assistant',
    userName: 'User',
  },
  ...overrides,
})

const makeCompressionResult = (overrides: Partial<ContextCompressionResult> = {}): ContextCompressionResult => ({
  compressionApplied: true,
  compressedHistory: 'Compressed history content.',
  compressedSystemPrompt: 'Compressed system prompt.',
  compressionDetails: {
    originalMessageCount: 6,
    compressedMessageCount: 4,
    windowMessageCount: 2,
    originalHistoryTokens: 500,
    compressedHistoryTokens: 50,
    originalSystemPromptTokens: 100,
    compressedSystemPromptTokens: 20,
    totalSavings: 530,
  },
  warnings: [],
  ...overrides,
})

describe('Compression Cache Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCompressionCache()
  })

  afterEach(() => {
    clearCompressionCache()
  })

  describe('triggerAsyncCompression', () => {
    it('skips compression when not enough messages', () => {
      const options = makeAsyncOptions({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        compressionOptions: {
          ...makeAsyncOptions().compressionOptions,
          windowSize: 5, // Larger than message count
        },
      })

      triggerAsyncCompression(options)

      expect(mockApplyContextCompression).not.toHaveBeenCalled()
      expect(getCompressionCacheStats().size).toBe(0)
    })

    it('triggers compression when messages exceed window size', () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      expect(mockApplyContextCompression).toHaveBeenCalledWith(
        options.messages,
        options.systemPrompt,
        options.compressionOptions
      )
      expect(getCompressionCacheStats().size).toBe(1)
    })

    it('does not re-trigger compression if valid cache entry exists', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()

      // First trigger
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Reset mock
      mockApplyContextCompression.mockClear()

      // Second trigger with same options
      triggerAsyncCompression(options)

      // Should not trigger again because cache is valid
      expect(mockApplyContextCompression).not.toHaveBeenCalled()
    })

    it('stores cache entry with promise while in-flight', () => {
      // Create a promise that we control
      let resolveCompression: (result: ContextCompressionResult) => void
      const compressionPromise = new Promise<ContextCompressionResult>(resolve => {
        resolveCompression = resolve
      })
      mockApplyContextCompression.mockReturnValue(compressionPromise)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasPromise).toBe(true)
      expect(stats.entries[0].hasResult).toBe(false)

      // Resolve to clean up
      resolveCompression!(makeCompressionResult())
    })

    it('updates cache entry with result when compression completes', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for the async operation to complete
      await new Promise(resolve => setTimeout(resolve, 10))

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasResult).toBe(true)
      expect(stats.entries[0].hasPromise).toBe(false)
    })

    it('stores error result when compression fails', async () => {
      mockApplyContextCompression.mockRejectedValue(new Error('Compression failed'))

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for the async operation to complete (including error handling)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Cache entry should still exist with a "not applied" result
      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].hasResult).toBe(true)
      
      // Verify the result indicates failure
      const result = await getCachedCompression('chat-123', 6)
      expect(result).toBeDefined()
      expect(result?.compressionApplied).toBe(false)
      expect(result?.warnings?.[0]).toContain('Compression failed')
    })
  })

  describe('getCachedCompression', () => {
    it('returns undefined when no cache entry exists', async () => {
      const result = await getCachedCompression('nonexistent-chat', 10)
      expect(result).toBeUndefined()
    })

    it('returns cached result when available', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      const result = await getCachedCompression('chat-123', 6)
      expect(result).toBeDefined()
      expect(result?.compressionApplied).toBe(true)
      expect(result?.compressedHistory).toBe('Compressed history content.')
    })

    it('waits for in-flight compression and returns result', async () => {
      let resolveCompression: (result: ContextCompressionResult) => void
      const compressionPromise = new Promise<ContextCompressionResult>(resolve => {
        resolveCompression = resolve
      })
      mockApplyContextCompression.mockReturnValue(compressionPromise)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Start getting cached result (should wait)
      const getPromise = getCachedCompression('chat-123', 6)

      // Resolve the compression
      const compressionResult = makeCompressionResult()
      resolveCompression!(compressionResult)

      const result = await getPromise
      expect(result).toBeDefined()
      expect(result?.compressionApplied).toBe(true)
    })

    it('returns undefined when cache is too stale (>50 messages behind)', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Request with message count more than 50 ahead of cached (6 + 51 = 57)
      const result = await getCachedCompression('chat-123', 57)
      expect(result).toBeUndefined()
    })

    it('accepts cache when message count is up to 50 messages ahead', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      // Trigger with 6 messages
      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should be valid for count 6 (exact match)
      const result1 = await getCachedCompression('chat-123', 6)
      expect(result1).toBeDefined()

      // Should be valid for count 56 (50 messages ahead, at the limit)
      const result2 = await getCachedCompression('chat-123', 56)
      expect(result2).toBeDefined()

      // Should be valid for count 20 (14 messages ahead, well within tolerance)
      const result3 = await getCachedCompression('chat-123', 20)
      expect(result3).toBeDefined()
    })

    it('returns failure result when in-flight compression fails', async () => {
      mockApplyContextCompression.mockRejectedValue(new Error('API Error'))

      const options = makeAsyncOptions()
      triggerAsyncCompression(options)

      // Get should wait and then return the failure result
      const result = await getCachedCompression('chat-123', 6)
      expect(result).toBeDefined()
      expect(result?.compressionApplied).toBe(false)
      expect(result?.warnings?.[0]).toContain('API Error')
    })
  })

  describe('invalidateCompressionCache', () => {
    it('removes cache entry for specified chat', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-2' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(getCompressionCacheStats().size).toBe(2)

      invalidateCompressionCache('chat-1')

      expect(getCompressionCacheStats().size).toBe(1)
      expect(getCompressionCacheStats().entries[0].chatId).toBe('chat-2')
    })

    it('does nothing when chat not in cache', () => {
      expect(() => invalidateCompressionCache('nonexistent')).not.toThrow()
      expect(getCompressionCacheStats().size).toBe(0)
    })
  })

  describe('clearCompressionCache', () => {
    it('removes all cache entries', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-2' }))
      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-3' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(getCompressionCacheStats().size).toBe(3)

      clearCompressionCache()

      expect(getCompressionCacheStats().size).toBe(0)
    })
  })

  describe('getCompressionCacheStats', () => {
    it('returns empty stats when cache is empty', () => {
      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.entries).toHaveLength(0)
    })

    it('returns accurate stats for cache entries', async () => {
      const compressionResult = makeCompressionResult()
      mockApplyContextCompression.mockResolvedValue(compressionResult)

      triggerAsyncCompression(makeAsyncOptions({ chatId: 'chat-1' }))

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 10))

      const stats = getCompressionCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.entries[0].chatId).toBe('chat-1')
      expect(stats.entries[0].messageCount).toBe(6)
      expect(stats.entries[0].hasResult).toBe(true)
      expect(stats.entries[0].hasPromise).toBe(false)
      expect(stats.entries[0].ageMs).toBeGreaterThanOrEqual(0)
    })
  })
})
