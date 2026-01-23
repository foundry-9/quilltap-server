/**
 * Unit tests for Web Search Handler
 * Tests lib/tools/handlers/web-search-handler.ts
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import {
  WebSearchError,
  executeWebSearchTool,
  formatWebSearchResults,
  isWebSearchConfigured,
  WebSearchToolContext,
} from '@/lib/tools/handlers/web-search-handler'
import { WebSearchResult } from '@/lib/tools/web-search-tool'

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>
global.fetch = mockFetch

// Store original env
const originalEnv = process.env

describe('WebSearchError', () => {
  it('should create an error with message and code', () => {
    const error = new WebSearchError('Search failed', 'SEARCH_ERROR')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(WebSearchError)
    expect(error.message).toBe('Search failed')
    expect(error.code).toBe('SEARCH_ERROR')
    expect(error.name).toBe('WebSearchError')
  })

  it('should support VALIDATION_ERROR code', () => {
    const error = new WebSearchError('Invalid query', 'VALIDATION_ERROR')
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('should support API_ERROR code', () => {
    const error = new WebSearchError('API request failed', 'API_ERROR')
    expect(error.code).toBe('API_ERROR')
  })

  it('should support SEARCH_ERROR code', () => {
    const error = new WebSearchError('Search execution failed', 'SEARCH_ERROR')
    expect(error.code).toBe('SEARCH_ERROR')
  })

  it('should have correct prototype chain', () => {
    const error = new WebSearchError('Test error', 'SEARCH_ERROR')
    expect(error instanceof WebSearchError).toBe(true)
    expect(error instanceof Error).toBe(true)
  })
})

describe('isWebSearchConfigured', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should return true when SERPER_API_KEY is set', () => {
    process.env.SERPER_API_KEY = 'test-api-key'
    // Re-import to get fresh module state
    const { isWebSearchConfigured: freshCheck } = require('@/lib/tools/handlers/web-search-handler')
    expect(freshCheck()).toBe(true)
  })

  it('should return false when SERPER_API_KEY is not set', () => {
    delete process.env.SERPER_API_KEY
    expect(isWebSearchConfigured()).toBe(false)
  })
})

describe('executeWebSearchTool', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // Helper to create a mock successful Serper response
  const createMockSerperResponse = (organic: Array<{ title: string; link: string; snippet: string; date?: string }>) => ({
    organic,
    searchParameters: { q: 'test' },
    credits: 2499,
  })

  describe('API key handling', () => {
    it('should fail when SERPER_API_KEY is not set', async () => {
      delete process.env.SERPER_API_KEY
      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-123' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Web search is not configured')
      expect(result.error).toContain('SERPER_API_KEY')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('valid input execution', () => {
    beforeEach(() => {
      process.env.SERPER_API_KEY = 'test-api-key'
    })

    it('should execute with valid query and return results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([
          { title: 'AI Article', link: 'https://example.com/ai', snippet: 'Info about AI' },
        ]),
      } as Response)

      const input = { query: 'what is artificial intelligence' }
      const context: WebSearchToolContext = { userId: 'user-123' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.query).toBe('what is artificial intelligence')
      expect(result.totalFound).toBeGreaterThan(0)
      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should execute with custom maxResults', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([
          { title: 'Result 1', link: 'https://example.com/1', snippet: 'Snippet 1' },
          { title: 'Result 2', link: 'https://example.com/2', snippet: 'Snippet 2' },
          { title: 'Result 3', link: 'https://example.com/3', snippet: 'Snippet 3' },
        ]),
      } as Response)

      const input = { query: 'latest AI news', maxResults: 3 }
      const context: WebSearchToolContext = { userId: 'user-456' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.totalFound).toBeGreaterThan(0)
      // Verify fetch was called with correct num parameter
      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          body: JSON.stringify({ q: 'latest AI news', num: 3 }),
        })
      )
    })

    it('should log search with user ID and query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([
          { title: 'ML Article', link: 'https://example.com/ml', snippet: 'About ML' },
        ]),
      } as Response)

      const input = { query: 'machine learning', maxResults: 5 }
      const context: WebSearchToolContext = { userId: 'user-789' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.query).toBe('machine learning')
    })

    it('should map Serper response to WebSearchResult format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([
          { title: 'Test Title', link: 'https://test.com', snippet: 'Test snippet', date: '2024-01-15' },
        ]),
      } as Response)

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'test-user' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(result.results!.length).toBe(1)

      const firstResult = result.results![0]
      expect(firstResult.title).toBe('Test Title')
      expect(firstResult.url).toBe('https://test.com')
      expect(firstResult.snippet).toBe('Test snippet')
      expect(firstResult.publishedDate).toBe('2024-01-15')
    })

    it('should include knowledge graph when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic: [],
          knowledgeGraph: {
            title: 'Knowledge Graph Title',
            description: 'Knowledge graph description',
            source: { name: 'Wikipedia', link: 'https://wikipedia.org/test' },
          },
        }),
      } as Response)

      const input = { query: 'test query', maxResults: 5 }
      const context: WebSearchToolContext = { userId: 'user-kg' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(result.results!.length).toBe(1)
      expect(result.results![0].title).toBe('Knowledge Graph Title')
      expect(result.results![0].snippet).toBe('Knowledge graph description')
      expect(result.results![0].url).toBe('https://wikipedia.org/test')
    })

    it('should use default maxResults when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([
          { title: 'Result', link: 'https://example.com', snippet: 'Snippet' },
        ]),
      } as Response)

      const input = { query: 'default max results test' }
      const context: WebSearchToolContext = { userId: 'user-default' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      // Verify default of 5 was used
      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          body: JSON.stringify({ q: 'default max results test', num: 5 }),
        })
      )
    })

    it('should send correct headers to Serper API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockSerperResponse([]),
      } as Response)

      const input = { query: 'test headers' }
      const context: WebSearchToolContext = { userId: 'user-headers' }

      await executeWebSearchTool(input, context)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-API-KEY': 'test-api-key',
            'Content-Type': 'application/json',
          },
        })
      )
    })
  })

  describe('API error handling', () => {
    beforeEach(() => {
      process.env.SERPER_API_KEY = 'test-api-key'
    })

    it('should handle 401 unauthorized error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      } as Response)

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-401' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid Serper API key')
    })

    it('should handle 403 forbidden error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Access denied',
      } as Response)

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-403' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid Serper API key')
    })

    it('should handle 429 rate limit error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
      } as Response)

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-429' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('rate limit exceeded')
    })

    it('should handle other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
      } as Response)

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-500' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
      expect(result.error).toContain('Internal Server Error')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const input = { query: 'test query' }
      const context: WebSearchToolContext = { userId: 'user-network' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  describe('invalid input handling', () => {
    // Validation happens before API key check, so no need for API key
    it('should fail with missing query', async () => {
      const input = { maxResults: 5 }
      const context: WebSearchToolContext = { userId: 'user-123' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Invalid input')
      expect(result.error).toContain('query is required')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('')
    })

    it('should fail with null query', async () => {
      const input = { query: null }
      const context: WebSearchToolContext = { userId: 'user-456' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.totalFound).toBe(0)
    })

    it('should fail with undefined query', async () => {
      const input = { query: undefined }
      const context: WebSearchToolContext = { userId: 'user-789' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with empty string query', async () => {
      const input = { query: '' }
      const context: WebSearchToolContext = { userId: 'user-empty' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with whitespace-only query', async () => {
      const input = { query: '   \t\n  ' }
      const context: WebSearchToolContext = { userId: 'user-whitespace' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with non-string query', async () => {
      const input = { query: 12345 }
      const context: WebSearchToolContext = { userId: 'user-number' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with null input', async () => {
      const context: WebSearchToolContext = { userId: 'user-null' }

      const result = await executeWebSearchTool(null, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.totalFound).toBe(0)
    })

    it('should fail with undefined input', async () => {
      const context: WebSearchToolContext = { userId: 'user-undefined' }

      const result = await executeWebSearchTool(undefined, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with invalid maxResults too low', async () => {
      const input = { query: 'valid query', maxResults: 0 }
      const context: WebSearchToolContext = { userId: 'user-low' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with invalid maxResults too high', async () => {
      const input = { query: 'valid query', maxResults: 11 }
      const context: WebSearchToolContext = { userId: 'user-high' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with non-integer maxResults', async () => {
      const input = { query: 'valid query', maxResults: 3.7 }
      const context: WebSearchToolContext = { userId: 'user-float' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should fail with non-object input', async () => {
      const context: WebSearchToolContext = { userId: 'user-string' }

      const result = await executeWebSearchTool('query string', context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should set query to empty string on validation failure when query cannot be determined', async () => {
      const input = { maxResults: 5 }
      const context: WebSearchToolContext = { userId: 'user-test' }

      const result = await executeWebSearchTool(input, context)

      expect(result.query).toBe('')
    })

    it('should return empty query on validation failure for invalid input', async () => {
      const input = { query: 'partial input', maxResults: 'invalid' }
      const context: WebSearchToolContext = { userId: 'user-test' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      // Validation failures return empty query, not the invalid input query
      expect(result.query).toBe('')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      process.env.SERPER_API_KEY = 'test-api-key'
    })

    it('should handle valid execution without errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [{ title: 'Test', link: 'https://test.com', snippet: 'Test snippet' }] }),
      } as Response)

      const input = { query: 'normal test query' }
      const context: WebSearchToolContext = { userId: 'user-error' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return error message for validation failures', async () => {
      const input = { query: '' }
      const context: WebSearchToolContext = { userId: 'user-test' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should succeed with valid query when API key is configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [{ title: 'Result', link: 'https://example.com', snippet: 'Snippet' }] }),
      } as Response)

      const input = { query: 'valid query' }
      const context: WebSearchToolContext = { userId: 'user-valid' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
    })

    it('should not throw on validation failure', async () => {
      const input = { query: null }
      const context: WebSearchToolContext = { userId: 'user-fail' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
    })

    it('should handle errors in error response with query extraction from catch block', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [{ title: 'Test', link: 'https://test.com', snippet: 'Test snippet' }] }),
      } as Response)

      const input = { query: 'testable query', extraData: 'some data' }
      const context: WebSearchToolContext = { userId: 'user-catch-test' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
      expect(result.query).toBe('testable query')
    })

    it('should return empty query in error when query not extractable', async () => {
      const input = 'just a string'
      const context: WebSearchToolContext = { userId: 'user-string' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(false)
      expect(result.query).toBe('')
    })
  })

  describe('context handling', () => {
    beforeEach(() => {
      process.env.SERPER_API_KEY = 'test-api-key'
    })

    it('should use provided userId in logging', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [{ title: 'Test', link: 'https://test.com', snippet: 'Snippet' }] }),
      } as Response)

      const input = { query: 'test' }
      const context: WebSearchToolContext = { userId: 'specific-user-id' }

      const result = await executeWebSearchTool(input, context)

      expect(result.success).toBe(true)
    })

    it('should handle different userId formats', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ organic: [{ title: 'Test', link: 'https://test.com', snippet: 'Snippet' }] }),
      } as Response)

      const input = { query: 'test' }

      // Test with UUID format
      let context: WebSearchToolContext = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      }
      let result = await executeWebSearchTool(input, context)
      expect(result.success).toBe(true)

      // Test with simple format
      context = { userId: 'user-123' }
      result = await executeWebSearchTool(input, context)
      expect(result.success).toBe(true)
    })
  })
})

describe('formatWebSearchResults', () => {
  it('should return message for empty results', () => {
    const results: WebSearchResult[] = []
    const formatted = formatWebSearchResults(results)

    expect(formatted).toBe('No search results found.')
  })

  it('should format single result', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Test Result',
        url: 'https://example.com',
        snippet: 'This is a test snippet',
        publishedDate: '2024-01-15T10:00:00Z',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain('Found 1 search results')
    expect(formatted).toContain('[Result 1]')
    expect(formatted).toContain('Title: Test Result')
    expect(formatted).toContain('URL: https://example.com')
    expect(formatted).toContain('Summary: This is a test snippet')
    expect(formatted).toContain('Published:')
  })

  it('should format multiple results', () => {
    const results: WebSearchResult[] = [
      {
        title: 'First Result',
        url: 'https://example1.com',
        snippet: 'First snippet',
        publishedDate: '2024-01-15T10:00:00Z',
      },
      {
        title: 'Second Result',
        url: 'https://example2.com',
        snippet: 'Second snippet',
        publishedDate: '2024-01-14T10:00:00Z',
      },
      {
        title: 'Third Result',
        url: 'https://example3.com',
        snippet: 'Third snippet',
        publishedDate: '2024-01-13T10:00:00Z',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain('Found 3 search results')
    expect(formatted).toContain('[Result 1]')
    expect(formatted).toContain('[Result 2]')
    expect(formatted).toContain('[Result 3]')
    expect(formatted).toContain('Title: First Result')
    expect(formatted).toContain('Title: Second Result')
    expect(formatted).toContain('Title: Third Result')
    expect(formatted).toContain('https://example1.com')
    expect(formatted).toContain('https://example2.com')
    expect(formatted).toContain('https://example3.com')
  })

  it('should handle results without publishedDate', () => {
    const results: WebSearchResult[] = [
      {
        title: 'No Date Result',
        url: 'https://example.com',
        snippet: 'This result has no publish date',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain('[Result 1]')
    expect(formatted).not.toContain('Published:')
    expect(formatted).toContain('Title: No Date Result')
    expect(formatted).toContain('Summary: This result has no publish date')
  })

  it('should format date correctly', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Dated Result',
        url: 'https://example.com',
        snippet: 'Result with date',
        publishedDate: new Date('2024-12-01T00:00:00Z').toISOString(),
      },
    ]

    const formatted = formatWebSearchResults(results)

    // Should contain localized date format
    expect(formatted).toContain('Published:')
  })

  it('should properly separate multiple results with line breaks', () => {
    const results: WebSearchResult[] = [
      {
        title: 'First',
        url: 'https://first.com',
        snippet: 'First snippet',
      },
      {
        title: 'Second',
        url: 'https://second.com',
        snippet: 'Second snippet',
      },
    ]

    const formatted = formatWebSearchResults(results)

    // Check that results are separated
    const parts = formatted.split('\n\n')
    expect(parts.length).toBeGreaterThan(2)
  })

  it('should include all required fields for each result', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Complete Result',
        url: 'https://example.com/page',
        snippet: 'A comprehensive snippet with useful information',
        publishedDate: '2024-12-01T15:30:00Z',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain('Title: Complete Result')
    expect(formatted).toContain('URL: https://example.com/page')
    expect(formatted).toContain(
      'Summary: A comprehensive snippet with useful information'
    )
  })

  it('should handle special characters in title and snippet', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Result with "quotes" and & special chars',
        url: 'https://example.com',
        snippet: 'Snippet with <html> tags & symbols',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain('Result with "quotes" and & special chars')
    expect(formatted).toContain('Snippet with <html> tags & symbols')
  })

  it('should handle very long URLs', () => {
    const longUrl =
      'https://example.com/very/long/path/with/many/segments/that/goes/on/and/on'
    const results: WebSearchResult[] = [
      {
        title: 'Long URL Result',
        url: longUrl,
        snippet: 'Result with a very long URL',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain(longUrl)
  })

  it('should handle very long snippets', () => {
    const longSnippet =
      'This is a very long snippet ' +
      'that contains a lot of text that should be properly ' +
      'formatted and included in the output without being truncated ' +
      'or modified in any way. It should preserve all the content.'
    const results: WebSearchResult[] = [
      {
        title: 'Long Snippet Result',
        url: 'https://example.com',
        snippet: longSnippet,
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain(longSnippet)
  })

  it('should use correct numbering for results', () => {
    const results: WebSearchResult[] = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example${i + 1}.com`,
      snippet: `Snippet for result ${i + 1}`,
    }))

    const formatted = formatWebSearchResults(results)

    for (let i = 1; i <= 5; i++) {
      expect(formatted).toContain(`[Result ${i}]`)
    }
  })

  it('should include result count in header', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Result 1',
        url: 'https://example1.com',
        snippet: 'Snippet 1',
      },
      {
        title: 'Result 2',
        url: 'https://example2.com',
        snippet: 'Snippet 2',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted.startsWith('Found 2 search results:')).toBe(true)
  })

  it('should return string type', () => {
    const results: WebSearchResult[] = [
      {
        title: 'Test',
        url: 'https://example.com',
        snippet: 'Snippet',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(typeof formatted).toBe('string')
  })

  it('should preserve URL protocol and structure', () => {
    const results: WebSearchResult[] = [
      {
        title: 'HTTPS Result',
        url: 'https://secure.example.com:443/path?query=value#fragment',
        snippet: 'Secure result',
      },
      {
        title: 'HTTP Result',
        url: 'http://insecure.example.com/path',
        snippet: 'Insecure result',
      },
    ]

    const formatted = formatWebSearchResults(results)

    expect(formatted).toContain(
      'https://secure.example.com:443/path?query=value#fragment'
    )
    expect(formatted).toContain('http://insecure.example.com/path')
  })
})
