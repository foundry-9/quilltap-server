/**
 * Unit Tests for Context Compression Module
 * Tests lib/chat/context/compression.ts
 * v2.7-dev: Sliding Window Context Compression Feature
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'

// Define mock functions at the module level
const mockCompressConversationHistory = jest.fn()
const mockCompressSystemPrompt = jest.fn()

// Mock the cheap LLM tasks module
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  __esModule: true,
  compressConversationHistory: (...args: unknown[]) => mockCompressConversationHistory(...args),
  compressSystemPrompt: (...args: unknown[]) => mockCompressSystemPrompt(...args),
}))

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Import after mocks are set up
const { 
  shouldApplyCompression, 
  splitMessagesForCompression, 
  applyContextCompression, 
  buildCompressedSystemMessage 
} = require('@/lib/chat/context/compression') as typeof import('@/lib/chat/context/compression')

import type { CompressibleMessage, ContextCompressionOptions } from '@/lib/chat/context/compression'

// Test fixtures
const makeMessage = (role: 'user' | 'assistant' | 'system', content: string): CompressibleMessage => ({
  role,
  content,
})

const makeSettings = (overrides: Partial<ContextCompressionSettings> = {}): ContextCompressionSettings => ({
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 2000,
  systemPromptTargetTokens: 1000,
  ...overrides,
})

const makeOptions = (overrides: Partial<ContextCompressionOptions> = {}): ContextCompressionOptions => ({
  enabled: true,
  windowSize: 5,
  compressionTargetTokens: 2000,
  systemPromptTargetTokens: 1000,
  selection: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
  userId: 'user-123',
  characterName: 'Luna',
  userName: 'John',
  ...overrides,
})

describe('Context Compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('shouldApplyCompression', () => {
    it('returns false when compression is disabled', () => {
      const settings = makeSettings({ enabled: false })
      expect(shouldApplyCompression(10, settings, false)).toBe(false)
    })

    it('returns false when bypass is requested', () => {
      const settings = makeSettings({ enabled: true })
      expect(shouldApplyCompression(10, settings, true)).toBe(false)
    })

    it('returns false when message count is within window size', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      expect(shouldApplyCompression(5, settings, false)).toBe(false)
      expect(shouldApplyCompression(3, settings, false)).toBe(false)
    })

    it('returns true when message count exceeds window size', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      expect(shouldApplyCompression(6, settings, false)).toBe(true)
      expect(shouldApplyCompression(10, settings, false)).toBe(true)
    })

    it('handles edge case at exact window boundary', () => {
      const settings = makeSettings({ enabled: true, windowSize: 5 })
      // At exactly windowSize, we don't compress (nothing before window)
      expect(shouldApplyCompression(5, settings, false)).toBe(false)
      // One more than windowSize, we do compress
      expect(shouldApplyCompression(6, settings, false)).toBe(true)
    })
  })

  describe('splitMessagesForCompression', () => {
    it('returns all messages in window when count is less than window size', () => {
      const messages = [
        makeMessage('user', 'Hello'),
        makeMessage('assistant', 'Hi there!'),
      ]

      const result = splitMessagesForCompression(messages, 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(2)
      expect(result.windowMessages).toEqual(messages)
    })

    it('returns all messages in window when count equals window size', () => {
      const messages = [
        makeMessage('user', 'Message 1'),
        makeMessage('assistant', 'Response 1'),
        makeMessage('user', 'Message 2'),
        makeMessage('assistant', 'Response 2'),
        makeMessage('user', 'Message 3'),
      ]

      const result = splitMessagesForCompression(messages, 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(5)
    })

    it('correctly splits messages when count exceeds window size', () => {
      const messages = [
        makeMessage('user', 'Old message 1'),
        makeMessage('assistant', 'Old response 1'),
        makeMessage('user', 'Old message 2'),
        makeMessage('assistant', 'Old response 2'),
        makeMessage('user', 'Recent message 1'),
        makeMessage('assistant', 'Recent response 1'),
        makeMessage('user', 'Recent message 2'),
      ]

      const result = splitMessagesForCompression(messages, 3)

      expect(result.messagesToCompress).toHaveLength(4)
      expect(result.messagesToCompress[0].content).toBe('Old message 1')
      expect(result.messagesToCompress[3].content).toBe('Old response 2')

      expect(result.windowMessages).toHaveLength(3)
      expect(result.windowMessages[0].content).toBe('Recent message 1')
      expect(result.windowMessages[2].content).toBe('Recent message 2')
    })

    it('handles window size of 1', () => {
      const messages = [
        makeMessage('user', 'First'),
        makeMessage('assistant', 'Second'),
        makeMessage('user', 'Last'),
      ]

      const result = splitMessagesForCompression(messages, 1)

      expect(result.messagesToCompress).toHaveLength(2)
      expect(result.windowMessages).toHaveLength(1)
      expect(result.windowMessages[0].content).toBe('Last')
    })

    it('handles empty message array', () => {
      const result = splitMessagesForCompression([], 5)

      expect(result.messagesToCompress).toHaveLength(0)
      expect(result.windowMessages).toHaveLength(0)
    })
  })

  describe('applyContextCompression', () => {
    const systemPrompt = 'You are Luna, a friendly assistant.'
    const messages: CompressibleMessage[] = [
      makeMessage('user', 'Old message 1'),
      makeMessage('assistant', 'Old response 1'),
      makeMessage('user', 'Old message 2'),
      makeMessage('assistant', 'Old response 2'),
      makeMessage('user', 'Recent message'),
      makeMessage('assistant', 'Recent response'),
    ]

    it('returns not applied when no messages to compress', async () => {
      const options = makeOptions({ windowSize: 10 }) // Larger than message count

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toContain('No messages to compress (all within window size)')
      expect(mockCompressConversationHistory).not.toHaveBeenCalled()
      expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
    })

    it('successfully compresses both history and system prompt', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: true,
        result: {
          compressedText: 'User discussed old topics with assistant.',
          originalTokens: 500,
          compressedTokens: 50,
        },
      })

      mockCompressSystemPrompt.mockResolvedValue({
        success: true,
        result: {
          compressedText: 'Luna: friendly assistant.',
          originalTokens: 100,
          compressedTokens: 20,
        },
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(true)
      expect(result.compressedHistory).toBe('User discussed old topics with assistant.')
      expect(result.compressedSystemPrompt).toBe('Luna: friendly assistant.')
      expect(result.compressionDetails).toBeDefined()
      expect(result.compressionDetails?.originalMessageCount).toBe(6)
      expect(result.compressionDetails?.compressedMessageCount).toBe(4)
      expect(result.compressionDetails?.windowMessageCount).toBe(2)
      expect(result.compressionDetails?.totalSavings).toBe(530) // (500-50) + (100-20)
      expect(result.warnings).toHaveLength(0)
    })

    it('handles history compression failure gracefully', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: false,
        error: 'API rate limited',
      })

      mockCompressSystemPrompt.mockResolvedValue({
        success: true,
        result: {
          compressedText: 'Luna: friendly assistant.',
          originalTokens: 100,
          compressedTokens: 20,
        },
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(true)
      expect(result.compressedHistory).toBeUndefined()
      expect(result.compressedSystemPrompt).toBe('Luna: friendly assistant.')
      expect(result.warnings).toContain('Failed to compress conversation history: API rate limited')
    })

    it('handles system prompt compression failure gracefully', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: true,
        result: {
          compressedText: 'User discussed old topics.',
          originalTokens: 500,
          compressedTokens: 50,
        },
      })

      mockCompressSystemPrompt.mockResolvedValue({
        success: false,
        error: 'Timeout',
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(true)
      expect(result.compressedHistory).toBe('User discussed old topics.')
      expect(result.compressedSystemPrompt).toBeUndefined()
      expect(result.warnings).toContain('Failed to compress system prompt: Timeout')
    })

    it('returns not applied when both compressions fail', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockResolvedValue({
        success: false,
        error: 'Error 1',
      })

      mockCompressSystemPrompt.mockResolvedValue({
        success: false,
        error: 'Error 2',
      })

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toHaveLength(2)
    })

    it('handles thrown errors during compression', async () => {
      const options = makeOptions({ windowSize: 2 })

      mockCompressConversationHistory.mockRejectedValue(new Error('Network error'))
      mockCompressSystemPrompt.mockRejectedValue(new Error('Server error'))

      const result = await applyContextCompression(messages, systemPrompt, options)

      expect(result.compressionApplied).toBe(false)
      expect(result.warnings).toContain('Error during conversation compression: Network error')
      expect(result.warnings).toContain('Error during system prompt compression: Server error')
    })

    it('passes correct parameters to compression functions', async () => {
      const options = makeOptions({
        windowSize: 4,
        compressionTargetTokens: 3000,
        systemPromptTargetTokens: 1500,
        characterName: 'TestChar',
        userName: 'TestUser',
        userId: 'test-user-id',
      })

      mockCompressConversationHistory.mockResolvedValue({ success: false, error: 'test' })
      mockCompressSystemPrompt.mockResolvedValue({ success: false, error: 'test' })

      await applyContextCompression(messages, systemPrompt, options)

      expect(mockCompressConversationHistory).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Old message 1' }),
        ]),
        'TestChar',
        'TestUser',
        3000,
        options.selection,
        'test-user-id',
        undefined,
        undefined
      )

      expect(mockCompressSystemPrompt).toHaveBeenCalledWith(
        systemPrompt,
        1500,
        options.selection,
        'test-user-id',
        undefined,
        undefined
      )
    })
  })

  describe('buildCompressedSystemMessage', () => {
    const fullSystemPrompt = 'You are Luna, a friendly AI assistant who loves helping users.'

    it('returns full system prompt when no compressed content', () => {
      const result = buildCompressedSystemMessage(undefined, undefined, fullSystemPrompt)
      expect(result).toBe(fullSystemPrompt)
    })

    it('uses compressed system prompt when available', () => {
      const compressedSystem = 'Luna: friendly AI assistant.'
      const result = buildCompressedSystemMessage(undefined, compressedSystem, fullSystemPrompt)
      expect(result).toBe(compressedSystem)
    })

    it('uses full system prompt with compressed history', () => {
      const compressedHistory = 'User asked about weather, Luna responded helpfully.'
      const result = buildCompressedSystemMessage(compressedHistory, undefined, fullSystemPrompt)

      expect(result).toContain(fullSystemPrompt)
      expect(result).toContain('Conversation Context')
      expect(result).toContain(compressedHistory)
    })

    it('combines compressed system prompt and compressed history', () => {
      const compressedHistory = 'User asked about weather.'
      const compressedSystem = 'Luna: friendly assistant.'

      const result = buildCompressedSystemMessage(compressedHistory, compressedSystem, fullSystemPrompt)

      expect(result).toContain(compressedSystem)
      expect(result).toContain('Conversation Context')
      expect(result).toContain(compressedHistory)
      expect(result).not.toContain(fullSystemPrompt)
    })

    it('includes proper section headers for compressed history', () => {
      const compressedHistory = 'Summary of earlier conversation.'
      const result = buildCompressedSystemMessage(compressedHistory, undefined, fullSystemPrompt)

      expect(result).toContain('## Conversation Context (Compressed Summary of Earlier Messages)')
      expect(result).toContain('following is a summary of the earlier conversation')
      expect(result).toContain('Recent messages follow this summary')
    })
  })
})
