/**
 * Help Search Tool Definition
 *
 * Provides a tool interface for LLMs to search Quilltap's help documentation
 * during conversations. This allows the LLM to look up feature guidance,
 * configuration help, and usage instructions to better assist users.
 */

/**
 * Input parameters for the help search tool
 */
export interface HelpSearchToolInput {
  query: string
  limit?: number
}

/**
 * A single help search result
 */
export interface HelpSearchResult {
  id: string
  title: string
  path: string
  url: string
  score: number
  content: string
}

/**
 * Output from the help search tool
 */
export interface HelpSearchToolOutput {
  success: boolean
  results?: HelpSearchResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const helpSearchToolDefinition = {
  type: 'function',
  function: {
    name: 'search_help',
    description:
      'Search Quilltap help documentation for features, settings, configuration, or usage guidance. Use this when the user asks about how to use Quilltap, configure settings, troubleshoot issues, or understand features. This helps you provide accurate documentation-based answers.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for in the help documentation. Be specific about the feature, setting, or topic. Examples: "how to configure embedding profiles", "image generation settings", "memory search", "project files"',
          minLength: 1,
          maxLength: 500,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Maximum number of help documents to retrieve. Default is 3.',
          default: 3,
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateHelpSearchInput(
  input: unknown
): input is HelpSearchToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // query is required
  if (typeof obj.query !== 'string' || obj.query.trim().length === 0) {
    return false
  }

  // query max length
  if (obj.query.length > 500) {
    return false
  }

  // Optional limit
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      return false
    }
  }

  return true
}
