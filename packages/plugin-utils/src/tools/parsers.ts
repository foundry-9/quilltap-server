/**
 * Tool Call Parsers
 *
 * Provider-specific parsers for extracting tool calls from LLM responses.
 * Each parser converts from a provider's native format to the standardized
 * ToolCallRequest format.
 *
 * @module @quilltap/plugin-utils/tools/parsers
 */

import type { ToolCallRequest } from '@quilltap/plugin-types';

/**
 * Supported tool call response formats
 */
export type ToolCallFormat = 'openai' | 'anthropic' | 'google' | 'auto';

/**
 * Parse OpenAI format tool calls from LLM response
 *
 * Extracts tool calls from OpenAI/Grok API responses which return
 * tool_calls in the message object.
 *
 * Expected response structures:
 * - `response.tool_calls` (direct)
 * - `response.choices[0].message.tool_calls` (nested)
 *
 * @param response - The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const response = await openai.chat.completions.create({...});
 * const toolCalls = parseOpenAIToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseOpenAIToolCalls(response: unknown): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    const resp = response as Record<string, unknown>;

    // Handle direct tool_calls array (snake_case)
    let toolCallsArray = resp?.tool_calls as unknown[] | undefined;

    // Handle direct toolCalls array (camelCase - some SDKs use this)
    if (!toolCallsArray) {
      toolCallsArray = (resp as Record<string, unknown>)?.toolCalls as unknown[] | undefined;
    }

    // Check nested structure from non-streaming responses: choices[0].message.tool_calls
    if (!toolCallsArray) {
      const choices = resp?.choices as
        | Array<{ message?: { tool_calls?: unknown[]; toolCalls?: unknown[] } }>
        | undefined;
      toolCallsArray = choices?.[0]?.message?.tool_calls || choices?.[0]?.message?.toolCalls;
    }

    // Check nested structure from streaming responses: choices[0].delta.toolCalls
    // OpenRouter SDK uses camelCase and puts tool calls in delta for streaming
    if (!toolCallsArray) {
      const choices = resp?.choices as
        | Array<{ delta?: { tool_calls?: unknown[]; toolCalls?: unknown[] } }>
        | undefined;
      toolCallsArray = choices?.[0]?.delta?.tool_calls || choices?.[0]?.delta?.toolCalls;
    }

    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        const tc = toolCall as {
          type?: string;
          function?: { name: string; arguments: string };
        };

        if (tc.type === 'function' && tc.function) {
          toolCalls.push({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }
  } catch (error) {
    // Log error but don't throw - return empty array
    console.error('[plugin-utils] Error parsing OpenAI tool calls:', error);
  }

  return toolCalls;
}

/**
 * Parse Anthropic format tool calls from LLM response
 *
 * Extracts tool calls from Anthropic API responses which return
 * tool_use blocks in the content array.
 *
 * Expected response structure:
 * - `response.content` array with `{ type: 'tool_use', name, input }`
 *
 * @param response - The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const response = await anthropic.messages.create({...});
 * const toolCalls = parseAnthropicToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseAnthropicToolCalls(response: unknown): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    const resp = response as Record<string, unknown>;

    if (!resp?.content || !Array.isArray(resp.content)) {
      return toolCalls;
    }

    for (const block of resp.content) {
      const b = block as { type?: string; name?: string; input?: Record<string, unknown> };

      if (b.type === 'tool_use' && b.name) {
        toolCalls.push({
          name: b.name,
          arguments: b.input || {},
        });
      }
    }
  } catch (error) {
    console.error('[plugin-utils] Error parsing Anthropic tool calls:', error);
  }

  return toolCalls;
}

/**
 * Parse Google Gemini format tool calls from LLM response
 *
 * Extracts tool calls from Google Gemini API responses which return
 * functionCall objects in the parts array.
 *
 * Expected response structure:
 * - `response.candidates[0].content.parts` array with `{ functionCall: { name, args } }`
 *
 * @param response - The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const response = await gemini.generateContent({...});
 * const toolCalls = parseGoogleToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseGoogleToolCalls(response: unknown): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    const resp = response as Record<string, unknown>;
    const candidates = resp?.candidates as
      | Array<{ content?: { parts?: unknown[] } }>
      | undefined;
    const parts = candidates?.[0]?.content?.parts;

    if (!parts || !Array.isArray(parts)) {
      return toolCalls;
    }

    for (const part of parts) {
      const p = part as {
        functionCall?: { name: string; args?: Record<string, unknown> };
      };

      if (p.functionCall) {
        toolCalls.push({
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        });
      }
    }
  } catch (error) {
    console.error('[plugin-utils] Error parsing Google tool calls:', error);
  }

  return toolCalls;
}

/**
 * Detect the format of a tool call response
 *
 * Analyzes the response structure to determine which provider format it uses.
 *
 * @param response - The raw response from a provider API
 * @returns The detected format, or null if unrecognized
 */
export function detectToolCallFormat(response: unknown): ToolCallFormat | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const resp = response as Record<string, unknown>;

  // OpenAI format: has tool_calls/toolCalls directly or in choices[0].message or choices[0].delta
  if (resp.tool_calls && Array.isArray(resp.tool_calls)) {
    return 'openai';
  }
  if (resp.toolCalls && Array.isArray(resp.toolCalls)) {
    return 'openai';
  }

  const choices = resp.choices as Array<{
    message?: { tool_calls?: unknown[]; toolCalls?: unknown[] };
    delta?: { tool_calls?: unknown[]; toolCalls?: unknown[] };
  }> | undefined;
  if (choices?.[0]?.message?.tool_calls || choices?.[0]?.message?.toolCalls) {
    return 'openai';
  }
  // Check delta for streaming responses (OpenRouter SDK uses this)
  if (choices?.[0]?.delta?.tool_calls || choices?.[0]?.delta?.toolCalls) {
    return 'openai';
  }

  // Anthropic format: has content array with tool_use type
  if (resp.content && Array.isArray(resp.content)) {
    const hasToolUse = (resp.content as Array<{ type?: string }>).some(
      (block) => block.type === 'tool_use'
    );
    if (hasToolUse) {
      return 'anthropic';
    }
  }

  // Google format: has candidates[0].content.parts with functionCall
  const candidates = resp.candidates as
    | Array<{ content?: { parts?: Array<{ functionCall?: unknown }> } }>
    | undefined;
  if (candidates?.[0]?.content?.parts) {
    const hasFunctionCall = candidates[0].content.parts.some((part) => part.functionCall);
    if (hasFunctionCall) {
      return 'google';
    }
  }

  return null;
}

/**
 * Parse tool calls with auto-detection or explicit format
 *
 * A unified parser that can either auto-detect the response format
 * or use a specified format. This is useful when you're not sure
 * which provider's response you're handling.
 *
 * @param response - The raw response from a provider API
 * @param format - The format to use: 'openai', 'anthropic', 'google', or 'auto'
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * // Auto-detect format
 * const toolCalls = parseToolCalls(response, 'auto');
 *
 * // Or specify format explicitly
 * const toolCalls = parseToolCalls(response, 'openai');
 * ```
 */
export function parseToolCalls(
  response: unknown,
  format: ToolCallFormat = 'auto'
): ToolCallRequest[] {
  let actualFormat: ToolCallFormat | null = format;

  if (format === 'auto') {
    actualFormat = detectToolCallFormat(response);
    if (!actualFormat) {
      return [];
    }
  }

  switch (actualFormat) {
    case 'openai':
      return parseOpenAIToolCalls(response);
    case 'anthropic':
      return parseAnthropicToolCalls(response);
    case 'google':
      return parseGoogleToolCalls(response);
    default:
      return [];
  }
}

/**
 * Check if a response contains tool calls
 *
 * Quick check to determine if a response has any tool calls
 * without fully parsing them.
 *
 * @param response - The raw response from a provider API
 * @returns True if the response contains tool calls
 */
export function hasToolCalls(response: unknown): boolean {
  const format = detectToolCallFormat(response);
  return format !== null;
}
