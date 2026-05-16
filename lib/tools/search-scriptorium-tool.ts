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
  scope?: 'all' | 'project' | 'character'
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
      "Search across your memories, past conversation history, and every document store you can reach. Returns results from your personal memories, rendered conversations, files in your character vault, files in every document store linked to this chat's project, files in the instance-wide Quilltap General store, and — when narrowed to the `knowledge` source — the `Knowledge/` folders inside those same stores. Use `scope` to confine the search to your own vault or to the project pool. Use this to find information from past interactions, recall conversation details, locate specific discussions by topic, search through reference documents, or look up what's been written down — by you, by the project, or by the operator at large.",
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
            'Which layers to search. Defaults to all sources if not specified. "memories" recalls your personal commonplace-book memories; "conversations" searches rendered transcripts of past chats; "documents" searches every file in every document store within the current `scope`; "knowledge" searches only files under a `Knowledge/` folder inside those same stores. Each knowledge result is tagged with its tier (character, project, or global) so you can tell whose voice it speaks in.',
        },
        scope: {
          type: 'string',
          enum: ['all', 'project', 'character'],
          description:
            "Which document stores the `documents` and `knowledge` sources reach into. \"all\" (the default) searches every store you can see — your own character vault, every document store linked to this chat's project, and the instance-wide Quilltap General store. \"project\" narrows to just the document stores linked to this chat's project (returns nothing if no project is attached). \"character\" narrows to just your own character vault. `scope` has no effect on `memories` or `conversations`.",
          default: 'all',
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

  // Optional scope
  if (obj.scope !== undefined) {
    const validScopes = ['all', 'project', 'character']
    if (typeof obj.scope !== 'string' || !validScopes.includes(obj.scope)) {
      return false
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
