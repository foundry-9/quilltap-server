/**
 * Read Conversation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to read the rendered Markdown
 * version of the current conversation, with sequential message numbering
 * and interchange grouping.
 */

/**
 * Input parameters for the read conversation tool
 */
export interface ReadConversationToolInput {
  conversationId?: string
  exclude_annotations?: boolean
}

/**
 * Output from the read conversation tool
 */
export interface ReadConversationToolOutput {
  success: boolean
  markdown?: string
  messageCount?: number
  interchangeCount?: number
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const readConversationToolDefinition = {
  type: 'function',
  function: {
    name: 'read_conversation',
    description:
      'Read the rendered Markdown version of a conversation. Without a conversationId, reads the current conversation. With a conversationId (e.g., from search_scriptorium results), reads that specific conversation. Returns the full conversation with sequential message numbering and interchange grouping.',
    parameters: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description:
            'Optional ID of a specific conversation to read. If omitted, reads the current conversation. Use search_scriptorium to find conversation IDs.',
        },
        exclude_annotations: {
          type: 'boolean',
          description:
            'If true, returns clean conversation without any annotations. If false (default), includes all character annotations.',
          default: false,
        },
      },
      required: [],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateReadConversationInput(
  input: unknown
): input is ReadConversationToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // Optional conversationId
  if (obj.conversationId !== undefined) {
    if (typeof obj.conversationId !== 'string' || obj.conversationId.trim().length === 0) {
      return false
    }
  }

  // Optional exclude_annotations
  if (obj.exclude_annotations !== undefined) {
    if (typeof obj.exclude_annotations !== 'boolean') {
      return false
    }
  }

  return true
}
