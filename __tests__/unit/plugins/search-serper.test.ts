/**
 * Unit Tests for Serper Web Search Provider Plugin
 * Tests plugins/dist/qtap-plugin-search-serper/index.ts
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { plugin } from '@/plugins/dist/qtap-plugin-search-serper/index'

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>
global.fetch = mockFetch

describe('Serper Search Provider Plugin', () => {
  // ============================================================================
  // METADATA
  // ============================================================================

  describe('metadata', () => {
    it('should have correct providerName', () => {
      expect(plugin.metadata.providerName).toBe('SERPER')
    })

    it('should have correct displayName', () => {
      expect(plugin.metadata.displayName).toBe('Serper Web Search')
    })

    it('should have correct abbreviation', () => {
      expect(plugin.metadata.abbreviation).toBe('SRP')
    })

    it('should have colors set', () => {
      expect(plugin.metadata.colors).toBeDefined()
      expect(plugin.metadata.colors).toHaveProperty('bg')
      expect(plugin.metadata.colors).toHaveProperty('text')
      expect(plugin.metadata.colors).toHaveProperty('icon')
    })
  })

  // ============================================================================
  // CONFIG
  // ============================================================================

  describe('config', () => {
    it('should require an API key', () => {
      expect(plugin.config.requiresApiKey).toBe(true)
    })

    it('should have correct API key label', () => {
      expect(plugin.config.apiKeyLabel).toBe('Serper API Key')
    })

    it('should not require a base URL', () => {
      expect(plugin.config.requiresBaseUrl).toBe(false)
    })
  })

  // ============================================================================
  // executeSearch
  // ============================================================================

  describe('executeSearch', () => {
    beforeEach(() => {
      mockFetch.mockReset()
    })

    it('should return results mapped correctly from Serper organic results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic: [
            { title: 'First Result', link: 'https://example.com/1', snippet: 'First snippet', date: '2024-03-15' },
            { title: 'Second Result', link: 'https://example.com/2', snippet: 'Second snippet' },
          ],
        }),
      } as Response)

      const result = await plugin.executeSearch('test query', 5, 'test-api-key')

      expect(result.success).toBe(true)
      expect(result.query).toBe('test query')
      expect(result.results).toBeDefined()
      expect(result.results).toHaveLength(2)
      expect(result.results![0]).toEqual({
        title: 'First Result',
        url: 'https://example.com/1',
        snippet: 'First snippet',
        publishedDate: '2024-03-15',
      })
      expect(result.results![1]).toEqual({
        title: 'Second Result',
        url: 'https://example.com/2',
        snippet: 'Second snippet',
        publishedDate: undefined,
      })
      expect(result.totalFound).toBe(2)

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-API-KEY': 'test-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: 'test query', num: 5 }),
        })
      )
    })

    it('should include knowledge graph when organic results are fewer than maxResults', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic: [
            { title: 'Organic Result', link: 'https://example.com/organic', snippet: 'An organic result' },
          ],
          knowledgeGraph: {
            title: 'KG Title',
            description: 'Knowledge graph description text',
            source: { name: 'Wikipedia', link: 'https://en.wikipedia.org/wiki/Test' },
          },
        }),
      } as Response)

      const result = await plugin.executeSearch('test', 5, 'test-api-key')

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      // Knowledge graph should be prepended
      expect(result.results).toHaveLength(2)
      expect(result.results![0]).toEqual({
        title: 'KG Title',
        url: 'https://en.wikipedia.org/wiki/Test',
        snippet: 'Knowledge graph description text',
      })
      expect(result.results![1]).toEqual({
        title: 'Organic Result',
        url: 'https://example.com/organic',
        snippet: 'An organic result',
        publishedDate: undefined,
      })
    })

    it('should handle empty organic results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic: [],
        }),
      } as Response)

      const result = await plugin.executeSearch('obscure query', 5, 'test-api-key')

      expect(result.success).toBe(true)
      expect(result.results).toBeDefined()
      expect(result.results).toHaveLength(0)
      expect(result.totalFound).toBe(0)
    })

    it('should return invalid API key error on 401 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      } as Response)

      const result = await plugin.executeSearch('test', 5, 'bad-key')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid Serper API key')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('test')
    })

    it('should return invalid API key error on 403 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Access denied',
      } as Response)

      const result = await plugin.executeSearch('test', 5, 'bad-key')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid Serper API key')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('test')
    })

    it('should return rate limit error on 429 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
      } as Response)

      const result = await plugin.executeSearch('test', 5, 'test-api-key')

      expect(result.success).toBe(false)
      expect(result.error).toContain('rate limit exceeded')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('test')
    })

    it('should return generic error with status on 500 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Something went wrong',
      } as Response)

      const result = await plugin.executeSearch('test', 5, 'test-api-key')

      expect(result.success).toBe(false)
      expect(result.error).toContain('500')
      expect(result.error).toContain('Internal Server Error')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('test')
    })

    it('should return error message on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))

      const result = await plugin.executeSearch('test', 5, 'test-api-key')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to fetch')
      expect(result.totalFound).toBe(0)
      expect(result.query).toBe('test')
    })
  })

  // ============================================================================
  // formatResults
  // ============================================================================

  describe('formatResults', () => {
    it('should return no results message for empty array', () => {
      const formatted = plugin.formatResults([])

      expect(formatted).toBe('No search results found.')
    })

    it('should format a single result correctly with title, URL, and summary', () => {
      const formatted = plugin.formatResults([
        {
          title: 'Test Article',
          url: 'https://example.com/article',
          snippet: 'A test article about testing',
        },
      ])

      expect(formatted).toContain('Found 1 search results:')
      expect(formatted).toContain('[Result 1]')
      expect(formatted).toContain('Title: Test Article')
      expect(formatted).toContain('URL: https://example.com/article')
      expect(formatted).toContain('Summary: A test article about testing')
    })

    it('should format multiple results correctly with numbering', () => {
      const formatted = plugin.formatResults([
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
        {
          title: 'Third',
          url: 'https://third.com',
          snippet: 'Third snippet',
        },
      ])

      expect(formatted).toContain('Found 3 search results:')
      expect(formatted).toContain('[Result 1]')
      expect(formatted).toContain('[Result 2]')
      expect(formatted).toContain('[Result 3]')
      expect(formatted).toContain('Title: First')
      expect(formatted).toContain('Title: Second')
      expect(formatted).toContain('Title: Third')
      expect(formatted).toContain('URL: https://first.com')
      expect(formatted).toContain('URL: https://second.com')
      expect(formatted).toContain('URL: https://third.com')
    })

    it('should include date string for results with publishedDate', () => {
      const formatted = plugin.formatResults([
        {
          title: 'Dated Article',
          url: 'https://example.com/dated',
          snippet: 'An article with a date',
          publishedDate: '2024-06-15',
        },
      ])

      expect(formatted).toContain('[Result 1]')
      expect(formatted).toContain('Published:')
      expect(formatted).toContain('Title: Dated Article')
    })

    it('should omit date for results without publishedDate', () => {
      const formatted = plugin.formatResults([
        {
          title: 'Undated Article',
          url: 'https://example.com/undated',
          snippet: 'An article without a date',
        },
      ])

      expect(formatted).toContain('[Result 1]')
      expect(formatted).not.toContain('Published:')
      expect(formatted).toContain('Title: Undated Article')
    })
  })

  // ============================================================================
  // validateApiKey
  // ============================================================================

  describe('validateApiKey', () => {
    beforeEach(() => {
      mockFetch.mockReset()
    })

    it('should return true when API responds ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ organic: [] }),
      } as Response)

      const result = await plugin.validateApiKey('valid-api-key')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-API-KEY': 'valid-api-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: 'test', num: 1 }),
        })
      )
    })

    it('should return false when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response)

      const result = await plugin.validateApiKey('invalid-api-key')

      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      const result = await plugin.validateApiKey('some-api-key')

      expect(result).toBe(false)
    })
  })
})
