/**
 * Request Full Context Tool Definition
 * Context Compression Feature
 *
 * Provides a tool interface for LLMs to request a full context reload
 * when the compressed context is missing important details or when
 * a complex question requires the complete conversation history.
 */

/**
 * Input parameters for the request full context tool
 * This tool takes no parameters - it simply signals intent
 */
export interface RequestFullContextToolInput {
  // No input parameters required
}

/**
 * Output from the request full context tool
 */
export interface RequestFullContextToolOutput {
  success: boolean
  message: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const requestFullContextToolDefinition = {
  type: 'function',
  function: {
    name: 'request_full_context',
    description:
      'Request a full, uncompressed context reload for the next message. Use this when you realize the compressed context is missing important details, when the conversation has shifted significantly and you need the complete picture, or when handling a complex question that requires full historical understanding. This tool takes no parameters - it simply signals that the next message should bypass compression and provide complete context.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicRequestFullContextToolDefinition = {
  name: 'request_full_context',
  description:
    'Request a full, uncompressed context reload for the next message. Use this when you realize the compressed context is missing important details, when the conversation has shifted significantly and you need the complete picture, or when handling a complex question that requires full historical understanding. This tool takes no parameters - it simply signals that the next message should bypass compression and provide complete context.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIRequestFullContextTool() {
  return requestFullContextToolDefinition
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicRequestFullContextTool() {
  return anthropicRequestFullContextToolDefinition
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleRequestFullContextTool() {
  return {
    name: anthropicRequestFullContextToolDefinition.name,
    description: anthropicRequestFullContextToolDefinition.description,
    parameters: anthropicRequestFullContextToolDefinition.input_schema,
  }
}

/**
 * Helper to validate tool input parameters
 * Since this tool takes no parameters, any object is valid
 */
export function validateRequestFullContextInput(
  input: unknown
): input is RequestFullContextToolInput {
  // Any object (including empty) is valid since this tool takes no parameters
  return typeof input === 'object'
}
