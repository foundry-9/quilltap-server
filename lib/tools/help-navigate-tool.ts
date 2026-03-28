/**
 * Help Navigate Tool Definition
 *
 * Provides a tool interface for LLMs to navigate the user's browser to a
 * specific Quilltap page. This is particularly useful after searching help
 * documentation — the LLM can direct the user straight to the relevant
 * settings page, opening the correct tab and section automatically.
 */

/**
 * Input parameters for the help navigate tool
 */
export interface HelpNavigateToolInput {
  url: string
}

/**
 * Output from the help navigate tool
 */
export interface HelpNavigateToolOutput {
  success: boolean
  url: string
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const helpNavigateToolDefinition = {
  type: 'function',
  function: {
    name: 'help_navigate',
    description:
      'Navigate the user\'s browser to a specific Quilltap page. Use this after searching help documentation to take the user directly to the relevant settings page, feature page, or configuration section. URLs can include tab and section parameters to open specific settings tabs and expand specific collapsible sections automatically. Only use URLs found in help documentation results or that you know to be valid Quilltap routes.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The internal Quilltap URL to navigate to. Must start with /. Examples: "/settings?tab=chat&section=dangerous-content", "/settings?tab=appearance", "/aurora", "/salon"',
          pattern: '^/',
        },
      },
      required: ['url'],
    },
  },
}

/**
 * Allowed URL path prefixes for navigation (security: prevent navigating to arbitrary URLs)
 */
const ALLOWED_PATH_PREFIXES = [
  '/settings',
  '/aurora',
  '/salon',
  '/prospero',
  '/profile',
  '/files',
  '/setup',
]

/**
 * Helper to validate tool input parameters
 */
export function validateHelpNavigateInput(
  input: unknown
): input is HelpNavigateToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // url is required
  if (typeof obj.url !== 'string' || obj.url.trim().length === 0) {
    return false
  }

  // Must start with /
  if (!obj.url.startsWith('/')) {
    return false
  }

  // Must be an allowed path
  const pathname = obj.url.split('?')[0]
  if (!ALLOWED_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return false
  }

  return true
}
