/**
 * Unit Tests for Recovery Service
 * Tests lib/services/chat-message/recovery.service.ts
 * v2.7-dev: Graceful Error Recovery Feature
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { AttachedFile } from '@/lib/services/chat-message/types'

// Define mocks at module level
const mockParseTokenLimitError = jest.fn()
const mockParseContentLimitError = jest.fn()
const mockIsTokenLimitError = jest.fn()
const mockIsContentLimitError = jest.fn()

// Mock dependencies
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/llm/errors', () => ({
  __esModule: true,
  parseTokenLimitError: (...args: unknown[]) => mockParseTokenLimitError(...args),
  parseContentLimitError: (...args: unknown[]) => mockParseContentLimitError(...args),
  isTokenLimitError: (...args: unknown[]) => mockIsTokenLimitError(...args),
  isContentLimitError: (...args: unknown[]) => mockIsContentLimitError(...args),
}))

// Import after mocks using require
const {
  buildRecoverySystemPrompt,
  buildRecoveryUserMessage,
  buildStaticFallbackMessage,
} = require('@/lib/services/chat-message/recovery.service') as typeof import('@/lib/services/chat-message/recovery.service')

// Test fixtures
const makeAttachedFile = (overrides: Partial<AttachedFile> = {}): AttachedFile => ({
  id: 'file-123',
  filename: 'document.pdf',
  mimeType: 'application/pdf',
  size: 1048576, // 1MB
  url: 'https://example.com/file.pdf',
  ...overrides,
})

describe('Recovery Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default mock implementations
    mockIsTokenLimitError.mockReturnValue(true)
    mockIsContentLimitError.mockReturnValue(false)
    mockParseTokenLimitError.mockReturnValue({})
    mockParseContentLimitError.mockReturnValue({ type: 'unknown' })
  })

  describe('buildRecoverySystemPrompt', () => {
    it('creates minimal system prompt with character name', () => {
      const prompt = buildRecoverySystemPrompt('Luna')

      expect(prompt).toContain('You are Luna')
      expect(prompt).toContain('technical issue')
      expect(prompt).toContain('respond helpfully')
      expect(prompt).toContain('in character')
    })

    it('works with different character names', () => {
      const prompt = buildRecoverySystemPrompt('Max the Robot')

      expect(prompt).toContain('You are Max the Robot')
    })
  })

  describe('buildRecoveryUserMessage', () => {
    describe('token limit errors', () => {
      beforeEach(() => {
        mockIsTokenLimitError.mockReturnValue(true)
        mockIsContentLimitError.mockReturnValue(false)
      })

      it('builds message with token counts when available', () => {
        mockParseTokenLimitError.mockReturnValue({
          requestedTokens: 210000,
          maxTokens: 200000,
        })

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, [], 'Hello world')

        expect(message).toContain('[Automatic System Notice]')
        expect(message).toContain('210,000')
        expect(message).toContain('200,000')
        expect(message).toContain('token')
      })

      it('builds generic message when token counts unavailable', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, [])

        expect(message).toContain('exceeded the model\'s token limit')
      })

      it('includes file attachment details', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const files = [
          makeAttachedFile({ filename: 'large-doc.pdf', size: 5242880 }), // 5MB
          makeAttachedFile({ filename: 'image.png', mimeType: 'image/png', size: 2097152 }), // 2MB
        ]

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, files)

        expect(message).toContain('Attached file details')
        expect(message).toContain('large-doc.pdf')
        expect(message).toContain('image.png')
        expect(message).toContain('5.0 MB')
        expect(message).toContain('2.0 MB')
      })

      it('notes when no files attached', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, [])

        expect(message).toContain('No files were attached')
        expect(message).toContain('long conversation history')
      })

      it('includes original user message when provided', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, [], 'Can you analyze this document?')

        expect(message).toContain("user's original message")
        expect(message).toContain('Can you analyze this document?')
      })

      it('suggests breaking document into sections', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildRecoveryUserMessage(error, [])

        expect(message).toContain('breaking the document into smaller sections')
        expect(message).toContain('starting a new conversation')
      })
    })

    describe('content limit errors', () => {
      beforeEach(() => {
        mockIsTokenLimitError.mockReturnValue(false)
        mockIsContentLimitError.mockReturnValue(true)
      })

      it('builds message for PDF page limit', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'pdf_pages',
          maxValue: 100,
        })

        const error = new Error('PDF exceeds page limit')
        const message = buildRecoveryUserMessage(error, [makeAttachedFile()])

        expect(message).toContain('PDF exceeds')
        expect(message).toContain('100 pages')
      })

      it('builds message with description when available', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'unknown',
          description: 'Custom limit description from API',
        })

        const error = new Error('Content limit')
        const message = buildRecoveryUserMessage(error, [])

        expect(message).toContain('Custom limit description from API')
      })

      it('suggests splitting PDF for page limit errors', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'pdf_pages',
          maxValue: 100,
        })

        const error = new Error('PDF exceeds page limit')
        const message = buildRecoveryUserMessage(error, [makeAttachedFile()])

        expect(message).toContain('splitting the PDF')
        expect(message).toContain('fewer pages')
        expect(message).toContain('extracting specific sections')
      })

      it('suggests general solutions for other content limits', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'image_size',
        })

        const error = new Error('Image too large')
        const message = buildRecoveryUserMessage(error, [makeAttachedFile()])

        expect(message).toContain('smaller file')
        expect(message).toContain('compressing')
      })
    })
  })

  describe('buildStaticFallbackMessage', () => {
    describe('token limit errors', () => {
      beforeEach(() => {
        mockIsTokenLimitError.mockReturnValue(true)
        mockIsContentLimitError.mockReturnValue(false)
      })

      it('includes token counts when available', () => {
        mockParseTokenLimitError.mockReturnValue({
          requestedTokens: 210000,
          maxTokens: 200000,
        })

        const error = new Error('Token limit exceeded')
        const message = buildStaticFallbackMessage([], error)

        expect(message).toContain('apologize')
        expect(message).toContain('210,000')
        expect(message).toContain('200,000')
      })

      it('uses generic message without token counts', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildStaticFallbackMessage([], error)

        expect(message).toContain('exceeded the maximum token limit')
      })

      it('suggests conversation actions when no files', () => {
        mockParseTokenLimitError.mockReturnValue({})

        const error = new Error('Token limit exceeded')
        const message = buildStaticFallbackMessage([], error)

        expect(message).toContain('conversation may have become too long')
        expect(message).toContain('new conversation')
        expect(message).toContain('shorter question')
      })
    })

    describe('content limit errors', () => {
      beforeEach(() => {
        mockIsTokenLimitError.mockReturnValue(false)
        mockIsContentLimitError.mockReturnValue(true)
      })

      it('explains PDF page limit', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'pdf_pages',
          maxValue: 100,
        })

        const error = new Error('PDF exceeds page limit')
        const files = [makeAttachedFile({ filename: 'large.pdf' })]
        const message = buildStaticFallbackMessage(files, error)

        expect(message).toContain('PDF exceeds')
        expect(message).toContain('100 pages')
      })

      it('lists attached files', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'file_size',
        })

        const files = [
          makeAttachedFile({ filename: 'doc1.pdf', size: 5242880 }),
          makeAttachedFile({ filename: 'doc2.pdf', size: 3145728 }),
        ]

        const error = new Error('File too large')
        const message = buildStaticFallbackMessage(files, error)

        expect(message).toContain('attached 2 file(s)')
        expect(message).toContain('doc1.pdf')
        expect(message).toContain('doc2.pdf')
        expect(message).toContain('5.0 MB')
        expect(message).toContain('3.0 MB')
      })

      it('suggests PDF-specific solutions for PDF page errors', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'pdf_pages',
          maxValue: 100,
        })

        const files = [makeAttachedFile()]
        const error = new Error('PDF exceeds page limit')
        const message = buildStaticFallbackMessage(files, error)

        expect(message).toContain('Split the PDF')
        expect(message).toContain('under 100 pages')
        expect(message).toContain('specific pages')
      })

      it('suggests general solutions for other errors', () => {
        mockParseContentLimitError.mockReturnValue({
          type: 'image_size',
        })

        const files = [makeAttachedFile()]
        const error = new Error('Image too large')
        const message = buildStaticFallbackMessage(files, error)

        expect(message).toContain('Remove the attachment')
        expect(message).toContain('smaller or compressed')
      })
    })
  })

  describe('file size formatting', () => {
    beforeEach(() => {
      mockIsTokenLimitError.mockReturnValue(true)
      mockParseTokenLimitError.mockReturnValue({})
    })

    it('formats bytes correctly', () => {
      const files = [makeAttachedFile({ size: 500 })]
      const message = buildRecoveryUserMessage(new Error('test'), files)
      expect(message).toContain('500 bytes')
    })

    it('formats kilobytes correctly', () => {
      const files = [makeAttachedFile({ size: 2048 })]
      const message = buildRecoveryUserMessage(new Error('test'), files)
      expect(message).toContain('2.0 KB')
    })

    it('formats megabytes correctly', () => {
      const files = [makeAttachedFile({ size: 5242880 })]
      const message = buildRecoveryUserMessage(new Error('test'), files)
      expect(message).toContain('5.0 MB')
    })
  })
})
