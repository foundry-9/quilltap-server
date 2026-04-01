/**
 * Submit Final Response Tool Definition
 * Agent Mode Feature
 *
 * Provides a tool interface for LLMs in agent mode to signal completion
 * of iterative tool use and deliver a final response to the user.
 * This tool is only available when agent mode is enabled for a chat.
 */

/**
 * Input parameters for the submit final response tool
 */
export interface SubmitFinalResponseToolInput {
  /** The final response content to deliver to the user */
  response: string
  /** Optional summary of what was accomplished (for logging/display) */
  summary?: string
  /** Optional confidence level (0-1) in the response quality */
  confidence?: number
}

/**
 * Output from the submit final response tool
 */
export interface SubmitFinalResponseToolOutput {
  success: boolean
  message: string
  /** The final response that should be displayed to the user */
  finalResponse?: string
  /** Summary of the agent's work */
  summary?: string
  /** Confidence level if provided */
  confidence?: number
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const submitFinalResponseToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_final_response',
    description:
      'Signal completion of agent mode processing and submit the final response to the user. ' +
      'Call this tool when you have gathered all necessary information, verified your results, ' +
      'and are ready to deliver a comprehensive answer. The response parameter should contain ' +
      'your complete, polished answer. Do not call other tools after calling this one.',
    parameters: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          description:
            'The final response to deliver to the user. This should be your complete, well-formatted answer ' +
            'incorporating all information gathered from tool use.',
        },
        summary: {
          type: 'string',
          description:
            'Optional brief summary of what you accomplished (e.g., "Searched 3 files and found the bug in config.ts").',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Optional confidence level (0-1) in your response. Use 0.9+ when highly confident, 0.5-0.9 for moderate confidence, below 0.5 when uncertain.',
        },
      },
      required: ['response'],
    },
  },
}

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicSubmitFinalResponseToolDefinition = {
  name: 'submit_final_response',
  description:
    'Signal completion of agent mode processing and submit the final response to the user. ' +
    'Call this tool when you have gathered all necessary information, verified your results, ' +
    'and are ready to deliver a comprehensive answer. The response parameter should contain ' +
    'your complete, polished answer. Do not call other tools after calling this one.',
  input_schema: {
    type: 'object' as const,
    properties: {
      response: {
        type: 'string',
        description:
          'The final response to deliver to the user. This should be your complete, well-formatted answer ' +
          'incorporating all information gathered from tool use.',
      },
      summary: {
        type: 'string',
        description:
          'Optional brief summary of what you accomplished (e.g., "Searched 3 files and found the bug in config.ts").',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'Optional confidence level (0-1) in your response. Use 0.9+ when highly confident, 0.5-0.9 for moderate confidence, below 0.5 when uncertain.',
      },
    },
    required: ['response'],
  },
}

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAISubmitFinalResponseTool() {
  return submitFinalResponseToolDefinition
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicSubmitFinalResponseTool() {
  return anthropicSubmitFinalResponseToolDefinition
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleSubmitFinalResponseTool() {
  return {
    name: anthropicSubmitFinalResponseToolDefinition.name,
    description: anthropicSubmitFinalResponseToolDefinition.description,
    parameters: anthropicSubmitFinalResponseToolDefinition.input_schema,
  }
}

/**
 * Helper to validate tool input parameters
 */
export function validateSubmitFinalResponseInput(
  input: unknown
): input is SubmitFinalResponseToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // response is required and must be a string
  if (typeof obj.response !== 'string' || obj.response.trim().length === 0) {
    return false
  }

  // summary is optional but must be a string if provided
  if (obj.summary !== undefined && typeof obj.summary !== 'string') {
    return false
  }

  // confidence is optional but must be a number between 0 and 1 if provided
  if (obj.confidence !== undefined) {
    if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
      return false
    }
  }

  return true
}
