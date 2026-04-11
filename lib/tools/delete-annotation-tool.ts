/**
 * Delete Annotation Tool Definition
 * Project Scriptorium
 *
 * Provides a tool interface for LLMs to remove their own annotation
 * from a specific message in a conversation. Only the calling character's
 * annotation is affected.
 */

/**
 * Input parameters for the delete annotation tool
 */
export interface DeleteAnnotationToolInput {
  message_index: number
}

/**
 * Output from the delete annotation tool
 */
export interface DeleteAnnotationToolOutput {
  success: boolean
  message_index: number
  character_name?: string
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const deleteAnnotationToolDefinition = {
  type: 'function',
  function: {
    name: 'delete_annotation',
    description:
      'Remove your annotation from a specific message in this conversation. Only removes your own annotation — other characters\' annotations are not affected.',
    parameters: {
      type: 'object',
      properties: {
        message_index: {
          type: 'integer',
          minimum: 0,
          description:
            'The 0-based message number to remove your annotation from.',
        },
      },
      required: ['message_index'],
    },
  },
}

/**
 * Helper to validate tool input parameters
 */
export function validateDeleteAnnotationInput(
  input: unknown
): input is DeleteAnnotationToolInput {
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

  return true
}
