/**
 * Unit tests for Help Search Handler
 * Tests lib/tools/handlers/help-search-handler.ts
 *
 * The handler uses a DB-backed help search system:
 * - generateEmbeddingForUser() for semantic search (uses user's embedding profile)
 * - Falls back to keyword search when embedding fails
 * - Loads help docs via helpSearch.loadFromDatabase()
 *
 * Mock strategy:
 * - @/lib/repositories/factory is mocked globally by jest.setup.ts
 * - @/lib/embedding/embedding-service is mocked globally by jest.setup.ts
 * - @/lib/help/help-doc-sync is mocked in this file
 * - All mocks are configured per-test in beforeEach via jest.Mock casting
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

// Mock help-doc-sync
jest.mock('@/lib/help/help-doc-sync', () => ({
  ensureHelpDocsSynced: jest.fn().mockResolvedValue(undefined),
}))

// Note: @/lib/embedding/embedding-service is mocked globally by jest.setup.ts.
// We configure the mock behavior in beforeEach via the imported jest.Mock references.

// Import handler (which uses the mocked modules)
import {
  HelpSearchError,
  executeHelpSearchTool,
  formatHelpSearchResults,
  type HelpSearchToolContext,
} from '@/lib/tools/handlers/help-search-handler'
import type { HelpSearchResult } from '@/lib/tools/help-search-tool'
import { resetHelpSearch } from '@/lib/help-search'

// Import mocked modules — these are jest.fn() instances from jest.setup.ts
import { getRepositories } from '@/lib/repositories/factory'
import {
  generateEmbeddingForUser,
  extractSearchTerms,
  textSimilarity,
  cosineSimilarity,
} from '@/lib/embedding/embedding-service'

// Cast to jest.Mock for type-safe mock method access
const mockedGetRepositories = getRepositories as jest.Mock
const mockedGenerateEmbeddingForUser = generateEmbeddingForUser as jest.Mock
const mockedExtractSearchTerms = extractSearchTerms as jest.Mock
const mockedTextSimilarity = textSimilarity as jest.Mock
const mockedCosineSimilarity = cosineSimilarity as jest.Mock

// Test help doc data
const mockHelpDocs = [
  { id: 'doc-0', title: 'Help Document 0', path: 'help/doc-0.md', url: '/test/doc-0', content: 'This is the content of help document 0. It contains helpful information about topic 0 and embedding profiles configuration.', contentHash: 'h0', embedding: [1, 0, 0, 0], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  { id: 'doc-1', title: 'Help Document 1', path: 'help/doc-1.md', url: '/test/doc-1', content: 'This is the content of help document 1. It contains helpful information about topic 1 and embedding profiles configuration.', contentHash: 'h1', embedding: [0, 1, 0, 0], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  { id: 'doc-2', title: 'Help Document 2', path: 'help/doc-2.md', url: '/test/doc-2', content: 'This is the content of help document 2. It contains helpful information about topic 2 and embedding profiles configuration.', contentHash: 'h2', embedding: [0, 0, 1, 0], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
]

describe('HelpSearchError', () => {
  it('should create an error with message and code', () => {
    const error = new HelpSearchError('Search failed', 'SEARCH_ERROR')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(HelpSearchError)
    expect(error.message).toBe('Search failed')
    expect(error.code).toBe('SEARCH_ERROR')
    expect(error.name).toBe('HelpSearchError')
  })

  it('should support VALIDATION_ERROR code', () => {
    const error = new HelpSearchError('Invalid query', 'VALIDATION_ERROR')
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('should support BUNDLE_ERROR code', () => {
    const error = new HelpSearchError('Bundle failed', 'BUNDLE_ERROR')
    expect(error.code).toBe('BUNDLE_ERROR')
  })

  it('should support API_ERROR code', () => {
    const error = new HelpSearchError('API request failed', 'API_ERROR')
    expect(error.code).toBe('API_ERROR')
  })

  it('should support SEARCH_ERROR code', () => {
    const error = new HelpSearchError('Search execution failed', 'SEARCH_ERROR')
    expect(error.code).toBe('SEARCH_ERROR')
  })
})

describe('executeHelpSearchTool', () => {
  beforeEach(() => {
    resetHelpSearch()

    // Configure getRepositories mock
    mockedGetRepositories.mockReturnValue({
      helpDocs: {
        findAll: jest.fn().mockResolvedValue(mockHelpDocs),
        findAllWithEmbeddings: jest.fn().mockResolvedValue(mockHelpDocs),
      },
    })

    // Configure embedding service mocks
    mockedGenerateEmbeddingForUser.mockReset()
    mockedGenerateEmbeddingForUser.mockResolvedValue({
      embedding: [1, 0, 0, 0],
      model: 'test-model',
      dimensions: 4,
      provider: 'TEST',
    })

    mockedExtractSearchTerms.mockReset()
    mockedExtractSearchTerms.mockImplementation((query: string) => {
      const words = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
      return { terms: words, phrases: [] }
    })

    mockedTextSimilarity.mockReset()
    mockedTextSimilarity.mockReturnValue(0.5)

    mockedCosineSimilarity.mockReset()
    mockedCosineSimilarity.mockImplementation((a: number[], b: number[]) => {
      let sum = 0
      for (let i = 0; i < a.length && i < b.length; i++) {
        sum += a[i] * b[i]
      }
      return sum
    })
  })

  afterEach(() => {
    resetHelpSearch()
  })

  describe('input validation', () => {
    it('should fail with missing query', async () => {
      const input = { limit: 5 }
      const context: HelpSearchToolContext = { userId: 'user-123' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Invalid input')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('')
    })

    it('should fail with null query', async () => {
      const input = { query: null }
      const context: HelpSearchToolContext = { userId: 'user-456' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.totalFound).toBe(0)
    })

    it('should fail with empty string query', async () => {
      const input = { query: '' }
      const context: HelpSearchToolContext = { userId: 'user-empty' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with whitespace-only query', async () => {
      const input = { query: '   \t\n  ' }
      const context: HelpSearchToolContext = { userId: 'user-whitespace' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with non-string query', async () => {
      const input = { query: 12345 }
      const context: HelpSearchToolContext = { userId: 'user-number' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with null input', async () => {
      const context: HelpSearchToolContext = { userId: 'user-null' }

      const result = await executeHelpSearchTool(null, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.totalFound).toBe(0)
    })

    it('should fail with invalid limit too low', async () => {
      const input = { query: 'valid query', limit: 0 }
      const context: HelpSearchToolContext = { userId: 'user-low' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with invalid limit too high', async () => {
      const input = { query: 'valid query', limit: 11 }
      const context: HelpSearchToolContext = { userId: 'user-high' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with non-integer limit', async () => {
      const input = { query: 'valid query', limit: 3.7 }
      const context: HelpSearchToolContext = { userId: 'user-float' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with query exceeding max length', async () => {
      const input = { query: 'a'.repeat(501) }
      const context: HelpSearchToolContext = { userId: 'user-long' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('keyword fallback search', () => {
    it('should use keyword search when generateEmbeddingForUser throws', async () => {
      mockedGenerateEmbeddingForUser.mockRejectedValueOnce(new Error('No embedding profile configured'))

      const input = { query: 'embedding profiles configuration' }
      const context: HelpSearchToolContext = { userId: 'user-123' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
      // Should have called extractSearchTerms for keyword fallback
      expect(mockedExtractSearchTerms).toHaveBeenCalled()
    })

    it('should return results matching keywords', async () => {
      mockedGenerateEmbeddingForUser.mockRejectedValueOnce(new Error('No embedding profile'))

      const input = { query: 'document topic' }
      const context: HelpSearchToolContext = { userId: 'user-keyword' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(mockedTextSimilarity).toHaveBeenCalled()
    })
  })

  describe('semantic search', () => {
    it('should use semantic search when generateEmbeddingForUser succeeds', async () => {
      const input = { query: 'embedding profiles' }
      const context: HelpSearchToolContext = { userId: 'user-semantic' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(mockedGenerateEmbeddingForUser).toHaveBeenCalledWith('embedding profiles', 'user-semantic')
      // cosineSimilarity is used in the search path
      expect(mockedCosineSimilarity).toHaveBeenCalled()
    })

    it('should fall back to keyword search on embedding API error', async () => {
      mockedGenerateEmbeddingForUser.mockRejectedValueOnce(new Error('API rate limit exceeded'))

      const input = { query: 'embedding profiles configuration' }
      const context: HelpSearchToolContext = { userId: 'user-fallback' }

      const result = await executeHelpSearchTool(input, context)

      // Should still succeed using keyword fallback
      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(mockedExtractSearchTerms).toHaveBeenCalled()
    })

    it('should fall back to keyword search on network error', async () => {
      mockedGenerateEmbeddingForUser.mockRejectedValueOnce(new Error('Network error'))

      const input = { query: 'embedding profiles' }
      const context: HelpSearchToolContext = { userId: 'user-network-error' }

      const result = await executeHelpSearchTool(input, context)

      // Should still succeed using keyword fallback
      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(mockedExtractSearchTerms).toHaveBeenCalled()
    })
  })

  describe('result limiting', () => {
    it('should use default limit of 3', async () => {
      const input = { query: 'document' }
      const context: HelpSearchToolContext = { userId: 'user-default-limit' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      // Should return at most 3 results by default
      expect(result.results!.length).toBeLessThanOrEqual(3)
    })

    it('should respect custom limit', async () => {
      const input = { query: 'document', limit: 2 }
      const context: HelpSearchToolContext = { userId: 'user-custom-limit' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(result.results!.length).toBeLessThanOrEqual(2)
    })
  })

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Make both semantic and keyword search fail
      mockedGenerateEmbeddingForUser.mockRejectedValueOnce(new Error('Embedding failed'))
      mockedExtractSearchTerms.mockImplementationOnce(() => { throw new Error('Unexpected error') })

      const input = { query: 'test query' }
      const context: HelpSearchToolContext = { userId: 'user-error' }

      const result = await executeHelpSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.query).toBe('test query')
    })
  })
})

describe('formatHelpSearchResults', () => {
  it('should return message for empty results', () => {
    const results: HelpSearchResult[] = []
    const formatted = formatHelpSearchResults(results)

    expect(formatted).toBe('No relevant help documentation found.')
  })

  it('should format single result', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Test Help Document',
        path: 'help/test.md',
        url: '/test',
        score: 0.85,
        content: 'This is the content of the test document.',
      },
    ]

    const formatted = formatHelpSearchResults(results)

    expect(formatted).toContain('Found 1 relevant help documents')
    expect(formatted).toContain('[Help Document 1]')
    expect(formatted).toContain('Title: Test Help Document')
    expect(formatted).toContain('Path: help/test.md')
    expect(formatted).toContain('URL: /test')
    expect(formatted).toContain('Relevance: High')
    expect(formatted).toContain('This is the content of the test document.')
  })

  it('should format multiple results', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'First Document',
        path: 'help/first.md',
        url: '/first',
        score: 0.9,
        content: 'First content.',
      },
      {
        id: 'doc-2',
        title: 'Second Document',
        path: 'help/second.md',
        url: '/second',
        score: 0.5,
        content: 'Second content.',
      },
      {
        id: 'doc-3',
        title: 'Third Document',
        path: 'help/third.md',
        url: '/third',
        score: 0.2,
        content: 'Third content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)

    expect(formatted).toContain('Found 3 relevant help documents')
    expect(formatted).toContain('[Help Document 1]')
    expect(formatted).toContain('[Help Document 2]')
    expect(formatted).toContain('[Help Document 3]')
    expect(formatted).toContain('Title: First Document')
    expect(formatted).toContain('Title: Second Document')
    expect(formatted).toContain('Title: Third Document')
  })

  it('should show High relevance for scores >= 0.7', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'High Score',
        path: 'help/high.md',
        url: '/high',
        score: 0.75,
        content: 'Content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)
    expect(formatted).toContain('Relevance: High')
  })

  it('should show Medium relevance for scores >= 0.4 and < 0.7', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Medium Score',
        path: 'help/medium.md',
        url: '/medium',
        score: 0.5,
        content: 'Content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)
    expect(formatted).toContain('Relevance: Medium')
  })

  it('should show Low relevance for scores < 0.4', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Low Score',
        path: 'help/low.md',
        url: '/low',
        score: 0.2,
        content: 'Content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)
    expect(formatted).toContain('Relevance: Low')
  })

  it('should truncate long content', () => {
    const longContent = 'A'.repeat(1500) // More than 1000 chars
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Long Content',
        path: 'help/long.md',
        url: '/long',
        score: 0.8,
        content: longContent,
      },
    ]

    const formatted = formatHelpSearchResults(results)

    // Should end with ellipsis after truncation
    expect(formatted).toContain('...')
    // Should not contain the full content
    expect(formatted.length).toBeLessThan(longContent.length + 500)
  })

  it('should not truncate short content', () => {
    const shortContent = 'This is short content that fits within limits.'
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Short Content',
        path: 'help/short.md',
        url: '/short',
        score: 0.8,
        content: shortContent,
      },
    ]

    const formatted = formatHelpSearchResults(results)

    expect(formatted).toContain(shortContent)
    expect(formatted).not.toMatch(/\.\.\.[^.]/) // No truncation ellipsis
  })

  it('should separate results with dividers', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'First',
        path: 'help/first.md',
        url: '/first',
        score: 0.8,
        content: 'First content.',
      },
      {
        id: 'doc-2',
        title: 'Second',
        path: 'help/second.md',
        url: '/second',
        score: 0.6,
        content: 'Second content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)

    expect(formatted).toContain('---')
  })

  it('should return string type', () => {
    const results: HelpSearchResult[] = [
      {
        id: 'doc-1',
        title: 'Test',
        path: 'help/test.md',
        url: '/test',
        score: 0.8,
        content: 'Content.',
      },
    ]

    const formatted = formatHelpSearchResults(results)
    expect(typeof formatted).toBe('string')
  })
})
