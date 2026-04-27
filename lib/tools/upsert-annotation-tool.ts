/**
 * Upsert Annotation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to add or update annotations
 * on specific messages in a conversation. Each character can have
 * one annotation per message.
 */

/**
 * Input parameters for the upsert annotation tool
 */
export interface UpsertAnnotationToolInput {
  message_index: number
  content: string
}

/**
 * Output from the upsert annotation tool
 */
export interface UpsertAnnotationToolOutput {
  success: boolean
  message_index: number
  character_name?: string
  action?: 'created' | 'updated'
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const upsertAnnotationToolDefinition = {
  type: 'function',
  function: {
    name: 'upsert_annotation',
    description:
      'Add or update your annotation on a specific message in this conversation. Annotations are personal commentary that persist across the conversation. Each character can have one annotation per message. Use this to mark important moments, add context, record observations, or note emotional reactions.',
    parameters: {
      type: 'object',
      properties: {
        message_index: {
          type: 'integer',
          minimum: 0,
          description:
            'The 0-based message number to annotate (as shown in the rendered conversation, e.g., Message 0, Message 1).',
        },
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          description:
            'Your annotation text. This is your personal commentary on the message.',
        },
      },
      required: ['message_index', 'content'],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateUpsertAnnotationInput(
  input: unknown
): input is UpsertAnnotationToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // message_index is required
  if (obj.message_index === undefined) {
    return false
  }
  const index = Number(obj.message_index)
  if (!Number.isInteger(index) || index < 0) {
    return false
  }

  // content is required
  if (typeof obj.content !== 'string') {
    return false
  }
  if (obj.content.length < 1 || obj.content.length > 2000) {
    return false
  }

  return true
}
