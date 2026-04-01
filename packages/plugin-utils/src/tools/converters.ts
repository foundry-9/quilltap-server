/**
 * Tool Format Converters
 *
 * Utilities for converting between different provider tool formats.
 * The universal format (OpenAI-style) serves as the baseline for all conversions.
 *
 * @module @quilltap/plugin-utils/tools/converters
 */

import type {
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,
} from '@quilltap/plugin-types';

/**
 * Convert OpenAI/Universal format tool to Anthropic format
 *
 * Anthropic uses a tool_use format with:
 * - name: string
 * - description: string
 * - input_schema: JSON schema object
 *
 * @param tool - Universal tool in OpenAI format
 * @returns Tool formatted for Anthropic's tool_use
 *
 * @example
 * ```typescript
 * const anthropicTool = convertToAnthropicFormat(universalTool);
 * // Returns: {
 * //   name: 'search_web',
 * //   description: 'Search the web',
 * //   input_schema: {
 * //     type: 'object',
 * //     properties: { query: { type: 'string' } },
 * //     required: ['query']
 * //   }
 * // }
 * ```
 */
export function convertToAnthropicFormat(tool: UniversalTool): AnthropicToolDefinition {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: 'object',
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required,
    },
  };
}

/**
 * Convert OpenAI/Universal format tool to Google Gemini format
 *
 * Google uses a function calling format with:
 * - name: string
 * - description: string
 * - parameters: JSON schema object
 *
 * @param tool - Universal tool in OpenAI format
 * @returns Tool formatted for Google's functionCall
 *
 * @example
 * ```typescript
 * const googleTool = convertToGoogleFormat(universalTool);
 * // Returns: {
 * //   name: 'search_web',
 * //   description: 'Search the web',
 * //   parameters: {
 * //     type: 'object',
 * //     properties: { query: { type: 'string' } },
 * //     required: ['query']
 * //   }
 * // }
 * ```
 */
export function convertToGoogleFormat(tool: UniversalTool): GoogleToolDefinition {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: {
      type: 'object',
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required,
    },
  };
}

/**
 * Convert Anthropic format tool to Universal/OpenAI format
 *
 * @param tool - Anthropic format tool
 * @returns Tool in universal OpenAI format
 */
export function convertFromAnthropicFormat(tool: AnthropicToolDefinition): UniversalTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: {
        type: 'object',
        properties: tool.input_schema.properties,
        required: tool.input_schema.required ?? [],
      },
    },
  };
}

/**
 * Convert Google format tool to Universal/OpenAI format
 *
 * @param tool - Google format tool
 * @returns Tool in universal OpenAI format
 */
export function convertFromGoogleFormat(tool: GoogleToolDefinition): UniversalTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

/**
 * Apply prompt/description length limit to a tool
 *
 * Modifies a tool's description if it exceeds maxBytes, appending a warning
 * that the description was truncated. This is useful for providers with
 * strict token limits.
 *
 * @param tool - Tool object (any format) with a description property
 * @param maxBytes - Maximum bytes allowed for description (including warning)
 * @returns Modified tool with truncated description if needed
 *
 * @example
 * ```typescript
 * const limitedTool = applyDescriptionLimit(tool, 500);
 * // If description > 500 bytes, truncates and adds warning
 * ```
 */
export function applyDescriptionLimit<T extends { description: string }>(
  tool: T,
  maxBytes: number
): T {
  if (!tool || !tool.description) {
    return tool;
  }

  const warningText = ' [Note: description truncated due to length limit]';
  const maxDescBytes = maxBytes - Buffer.byteLength(warningText);

  if (maxDescBytes <= 0) {
    console.warn('[plugin-utils] Length limit too small for warning text:', maxBytes);
    return tool;
  }

  const descBytes = Buffer.byteLength(tool.description);

  if (descBytes > maxBytes) {
    // Truncate description to fit within the byte limit
    let truncated = tool.description;
    while (Buffer.byteLength(truncated) > maxDescBytes && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }

    return {
      ...tool,
      description: truncated + warningText,
    };
  }

  return tool;
}

/**
 * Target format for tool conversion
 */
export type ToolConvertTarget = 'openai' | 'anthropic' | 'google';

/**
 * Convert a universal tool to a specific provider format
 *
 * @param tool - Universal tool in OpenAI format
 * @param target - Target provider format
 * @returns Tool in the target format
 */
export function convertToolTo(
  tool: UniversalTool,
  target: ToolConvertTarget
): UniversalTool | AnthropicToolDefinition | GoogleToolDefinition {
  switch (target) {
    case 'anthropic':
      return convertToAnthropicFormat(tool);
    case 'google':
      return convertToGoogleFormat(tool);
    case 'openai':
    default:
      return tool;
  }
}

/**
 * Convert multiple tools to a specific provider format
 *
 * @param tools - Array of universal tools
 * @param target - Target provider format
 * @returns Array of tools in the target format
 */
export function convertToolsTo(
  tools: UniversalTool[],
  target: ToolConvertTarget
): Array<UniversalTool | AnthropicToolDefinition | GoogleToolDefinition> {
  return tools.map((tool) => convertToolTo(tool, target));
}
