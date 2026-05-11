/**
 * Search Scriptorium Tool Definition
 * Project Scriptorium Phase 2
 *
 * Provides a unified search tool for LLMs to search across character
 * memories and conversation history simultaneously.
 */

/**
 * Input parameters for the search scriptorium tool
 */
export interface SearchScriptoriumToolInput {
  query: string
  sources?: ('memories' | 'conversations' | 'documents' | 'knowledge')[]
  limit?: number
  minImportance?: number
}

/**
 * Individual search result from any source
 */
export interface SearchScriptoriumResult {
  content: string
  sourceType: 'memory' | 'conversation' | 'document' | 'knowledge'
  relevanceScore: number
  metadata: {
    // Memory-specific
    memoryId?: string
    summary?: string
    importance?: number
    effectiveWeight?: number
    createdAt?: string
    source?: 'AUTO' | 'MANUAL'
    // Conversation-specific
    conversationId?: string
    interchangeIndex?: number
    conversationTitle?: string
    participantNames?: string[]
    // Document-specific
    mountPointName?: string
    fileName?: string
    filePath?: string
    chunkIndex?: number
    headingContext?: string
    // Knowledge-specific
    knowledgeTier?: 'character' | 'project' | 'global'
  }
}

/**
 * Output from the search scriptorium tool
 */
export interface SearchScriptoriumToolOutput {
  success: boolean
  results?: SearchScriptoriumResult[]
  error?: string
  totalFound: number
  query: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const searchScriptoriumToolDefinition = {
  type: 'function',
  function: {
    name: 'search',
    description:
      "Search across your memories, past conversation history, mounted documents, and every Knowledge/ folder available to you. Returns results from your personal memories, rendered conversations, indexed document collections, and the Knowledge/ folder of your own character vault, the Knowledge/ folder of every document store linked to this chat's project, and the Knowledge/ folder of the instance-wide Quilltap General store — all ranked by relevance. Use this to find information from past interactions, recall conversation details, locate specific discussions by topic, search through reference documents, or look up what's been written down — by you, by the project, or by the operator at large.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for across memories, conversations, documents, and your own knowledge base. Be specific about the topic, event, or detail you want to find.',
          minLength: 1,
          maxLength: 500,
        },
        sources: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['memories', 'conversations', 'documents', 'knowledge'],
          },
          description:
            "Which sources to search. Defaults to all sources if not specified. Use \"documents\" to search through mounted document collections; use \"knowledge\" to search every Knowledge/ folder available to you — the one in your own character vault, the one in each document store linked to the active chat's project, and the one in the instance-wide Quilltap General store. Each knowledge result is tagged with its tier (character, project, or global) so you can tell whose voice it speaks in.",
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Maximum number of results to return across all sources. Default is 10.',
          default: 10,
        },
        minImportance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Minimum importance score (0-1) for memory results. Only affects memory search, not conversations. Default is 0.',
          default: 0,
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateSearchScriptoriumInput(
  input: unknown
): input is SearchScriptoriumToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // query is required
  if (typeof obj.query !== 'string' || obj.query.trim().length === 0) {
    return false
  }

  // Optional sources
  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      return false
    }
    const validSources = ['memories', 'conversations', 'documents', 'knowledge']
    for (const s of obj.sources) {
      if (typeof s !== 'string' || !validSources.includes(s)) {
        return false
      }
    }
  }

  // Optional limit
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return false
    }
  }

  // Optional minImportance
  if (obj.minImportance !== undefined) {
    const importance = Number(obj.minImportance)
    if (isNaN(importance) || importance < 0 || importance > 1) {
      return false
    }
  }

  return true
}
