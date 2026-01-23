/**
 * Web Search Tool Handler
 *
 * This handler performs web searches when the LLM explicitly requests
 * real-time information from the internet.
 *
 * Uses Serper.dev API for Google search results.
 * Get a free API key at https://serper.dev/ (2,500 free searches/month)
 */

import {
  WebSearchToolInput,
  WebSearchToolOutput,
  WebSearchResult,
  validateWebSearchInput,
} from '../web-search-tool'
import { logger } from '@/lib/logger'

/**
 * Serper API response types
 */
interface SerperOrganicResult {
  title: string
  link: string
  snippet: string
  date?: string
  position?: number
}

interface SerperKnowledgeGraph {
  title?: string
  type?: string
  description?: string
  source?: { name: string; link: string }
}

interface SerperResponse {
  organic?: SerperOrganicResult[]
  knowledgeGraph?: SerperKnowledgeGraph
  searchParameters?: {
    q: string
    num?: number
  }
  credits?: number
}

/**
 * Context required for web search execution
 */
export interface WebSearchToolContext {
  /** User ID for authentication and logging */
  userId: string
}

/**
 * Error thrown during web search execution
 */
export class WebSearchError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'SEARCH_ERROR' | 'API_ERROR' | 'CONFIG_ERROR'
  ) {
    super(message)
    this.name = 'WebSearchError'
  }
}

/** Serper API endpoint */
const SERPER_API_URL = 'https://google.serper.dev/search'

/**
 * Check if web search is configured
 */
export function isWebSearchConfigured(): boolean {
  return !!process.env.SERPER_API_KEY
}

/**
 * Execute a web search using the Serper.dev API
 *
 * Requires SERPER_API_KEY environment variable to be set.
 * Get a free API key at https://serper.dev/ (2,500 free searches/month)
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID
 * @returns Tool output with search results
 */
export async function executeWebSearchTool(
  input: unknown,
  context: WebSearchToolContext
): Promise<WebSearchToolOutput> {
  try {
    // Validate input
    if (!validateWebSearchInput(input)) {
      logger.warn('Web search validation failed', { userId: context.userId, input })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string',
        totalFound: 0,
        query: '',
      }
    }

    const { query, maxResults = 5 } = input

    // Check for API key
    const apiKey = process.env.SERPER_API_KEY
    if (!apiKey) {
      logger.warn('Web search attempted without API key', { userId: context.userId, query })
      return {
        success: false,
        error: 'Web search is not configured. Please set SERPER_API_KEY in your environment variables. Get a free API key at https://serper.dev/',
        totalFound: 0,
        query,
      }
    }

    logger.debug('Web search initiated', { userId: context.userId, query, maxResults })

    // Call Serper API
    const response = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: maxResults,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Serper API request failed', {
        userId: context.userId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: 'Invalid Serper API key. Please check your SERPER_API_KEY environment variable.',
          totalFound: 0,
          query,
        }
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'Serper API rate limit exceeded. Please try again later or upgrade your plan at serper.dev.',
          totalFound: 0,
          query,
        }
      }

      return {
        success: false,
        error: `Search API error: ${response.status} ${response.statusText}`,
        totalFound: 0,
        query,
      }
    }

    const data: SerperResponse = await response.json()

    logger.debug('Serper API response received', {
      userId: context.userId,
      query,
      resultsCount: data.organic?.length ?? 0,
      hasKnowledgeGraph: !!data.knowledgeGraph,
      creditsRemaining: data.credits,
    })

    // Map Serper results to our format
    const results: WebSearchResult[] = (data.organic ?? []).map((result) => ({
      title: result.title,
      url: result.link,
      snippet: result.snippet,
      publishedDate: result.date,
    }))

    // If we have a knowledge graph result and few organic results, include it
    const kg = data.knowledgeGraph
    if (kg?.description && results.length < maxResults) {
      results.unshift({
        title: kg.title ?? 'Knowledge Graph',
        url: kg.source?.link ?? '',
        snippet: kg.description,
      })
    }

    logger.info('Web search completed', {
      userId: context.userId,
      query,
      resultsCount: results.length,
    })

    return {
      success: true,
      results,
      totalFound: results.length,
      query,
    }
  } catch (error) {
    logger.error('Web search tool execution failed', { userId: context.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during web search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format web search results for inclusion in conversation context
 *
 * @param results - Search results to format
 * @returns Formatted string suitable for LLM context
 */
export function formatWebSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return 'No search results found.'
  }

  const formatted = results.map((result, index) => {
    const dateStr = result.publishedDate
      ? ` (Published: ${new Date(result.publishedDate).toLocaleDateString()})`
      : ''

    return `[Result ${index + 1}]${dateStr}
Title: ${result.title}
URL: ${result.url}
Summary: ${result.snippet}`
  })

  return `Found ${results.length} search results:\n\n${formatted.join('\n\n')}`
}
