/**
 * Help Search Tool Handler
 *
 * Executes help documentation search when the LLM requests assistance
 * understanding Quilltap features, settings, or usage.
 *
 * Uses semantic search when OPENAI_API_KEY is available (to generate query embeddings),
 * with automatic fallback to keyword-based search when no API key is configured.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '@/lib/logger'
import { getHelpSearch } from '@/lib/help-search'
import { extractSearchTerms, textSimilarity } from '@/lib/embedding/embedding-service'
import {
  HelpSearchToolInput,
  HelpSearchToolOutput,
  HelpSearchResult,
  validateHelpSearchInput,
} from '../help-search-tool'

/**
 * Context required for help search execution
 */
export interface HelpSearchToolContext {
  /** User ID for logging */
  userId: string
}

/**
 * Error thrown during help search execution
 */
export class HelpSearchError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'BUNDLE_ERROR' | 'SEARCH_ERROR' | 'API_ERROR'
  ) {
    super(message)
    this.name = 'HelpSearchError'
  }
}

/** OpenAI embedding model used in the help bundle */
const HELP_BUNDLE_EMBEDDING_MODEL = 'text-embedding-3-small'

/** OpenAI embeddings API endpoint */
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

/** Path to the help bundle file */
const HELP_BUNDLE_PATH = join(process.cwd(), 'public', 'help-bundle.msgpack.gz')

/**
 * Generate an embedding for the query using OpenAI API directly
 *
 * Uses the same model as the help bundle to ensure dimension compatibility.
 *
 * @param query - The search query to embed
 * @param apiKey - OpenAI API key
 * @returns Embedding vector
 */
async function generateQueryEmbedding(query: string, apiKey: string): Promise<number[]> {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: HELP_BUNDLE_EMBEDDING_MODEL,
      input: query,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new HelpSearchError(
      `OpenAI embedding failed: ${error.error?.message || response.statusText}`,
      'API_ERROR'
    )
  }

  const data = await response.json()
  return data.data[0].embedding
}

/**
 * Load the help bundle into the singleton HelpSearch instance
 */
async function ensureHelpBundleLoaded(): Promise<boolean> {
  const helpSearch = getHelpSearch()

  if (helpSearch.isLoaded()) {
    return true
  }

  try {
    const bundleBuffer = await readFile(HELP_BUNDLE_PATH)
    await helpSearch.loadFromBuffer(bundleBuffer)
    return true
  } catch (error) {
    logger.error('Failed to load help bundle', {
      context: 'help-search-handler',
      path: HELP_BUNDLE_PATH,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Perform semantic search using embeddings
 */
async function semanticSearch(
  query: string,
  limit: number,
  apiKey: string
): Promise<HelpSearchResult[]> {
  const helpSearch = getHelpSearch()

  // Generate embedding for the query
  const queryEmbedding = await generateQueryEmbedding(query, apiKey)

  // Search the help bundle
  const results = helpSearch.search(queryEmbedding, limit)

  return results.map(result => ({
    id: result.document.id,
    title: result.document.title,
    path: result.document.path,
    score: result.score,
    content: result.document.content,
  }))
}

/**
 * Perform keyword-based fallback search
 */
function keywordSearch(query: string, limit: number): HelpSearchResult[] {
  const helpSearch = getHelpSearch()
  const searchTerms = extractSearchTerms(query)

  // Get all documents and score them
  const allDocs = helpSearch.getAllDocuments()

  const scored = allDocs.map(doc => ({
    doc,
    score: textSimilarity(searchTerms, `${doc.title} ${doc.content}`),
  }))

  // Sort by score descending and take top results
  const topResults = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return topResults.map(item => ({
    id: item.doc.id,
    title: item.doc.title,
    path: item.doc.path,
    score: item.score,
    content: item.doc.content,
  }))
}

/**
 * Execute a help search tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID
 * @returns Tool output with search results
 */
export async function executeHelpSearchTool(
  input: unknown,
  context: HelpSearchToolContext
): Promise<HelpSearchToolOutput> {
  try {
    // Validate input
    if (!validateHelpSearchInput(input)) {
      logger.warn('Help search validation failed', {
        context: 'help-search-handler',
        userId: context.userId,
        input,
      })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string (max 500 chars)',
        totalFound: 0,
        query: '',
      }
    }

    const { query, limit = 3 } = input

    // Ensure the help bundle is loaded
    const bundleLoaded = await ensureHelpBundleLoaded()
    if (!bundleLoaded) {
      return {
        success: false,
        error: 'Help documentation bundle is not available. Please run "npm run build:help" to generate it.',
        totalFound: 0,
        query,
      }
    }

    // Check for OpenAI API key for semantic search
    const apiKey = process.env.OPENAI_API_KEY

    let results: HelpSearchResult[]
    let searchMethod: 'semantic' | 'keyword'

    if (apiKey) {
      try {
        results = await semanticSearch(query, limit, apiKey)
        searchMethod = 'semantic'
      } catch (error) {
        // Fall back to keyword search on API error
        logger.warn('Semantic search failed, falling back to keyword search', {
          context: 'help-search-handler',
          userId: context.userId,
          error: error instanceof Error ? error.message : String(error),
        })
        results = keywordSearch(query, limit)
        searchMethod = 'keyword'
      }
    } else {
      // No API key, use keyword search directly
      results = keywordSearch(query, limit)
      searchMethod = 'keyword'
    }

    logger.info('Help search completed', {
      context: 'help-search-handler',
      userId: context.userId,
      query,
      searchMethod,
      resultsCount: results.length,
    })

    return {
      success: true,
      results,
      totalFound: results.length,
      query,
    }
  } catch (error) {
    logger.error('Help search tool execution failed', {
      context: 'help-search-handler',
      userId: context.userId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during help search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format help search results for inclusion in conversation context
 *
 * @param results - Search results to format
 * @returns Formatted string suitable for LLM context
 */
export function formatHelpSearchResults(results: HelpSearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant help documentation found.'
  }

  const formatted = results.map((result, index) => {
    const relevanceLabel = result.score >= 0.7 ? 'High' :
      result.score >= 0.4 ? 'Medium' : 'Low'

    // Truncate content for context (first 1000 chars)
    const truncatedContent = result.content.length > 1000
      ? result.content.substring(0, 1000) + '...'
      : result.content

    return `[Help Document ${index + 1}] (Relevance: ${relevanceLabel})
Title: ${result.title}
Path: ${result.path}
Content:
${truncatedContent}`
  })

  return `Found ${results.length} relevant help documents:\n\n${formatted.join('\n\n---\n\n')}`
}
