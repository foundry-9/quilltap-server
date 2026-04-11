/**
 * Text-Based Tool Call Parsers
 *
 * Utility functions for parsing spontaneous XML-style tool calls from LLM
 * text responses. These are for models that emit tool-call-like markup in
 * their output instead of using native function calling APIs.
 *
 * Provider plugins import and compose these utilities to implement their
 * `hasTextToolMarkers`, `parseTextToolCalls`, and `stripTextToolMarkers` methods.
 *
 * @module @quilltap/plugin-utils/tools/text-parsers
 */

import type { ToolCallRequest } from '@quilltap/plugin-types';

/**
 * Parsed text-based tool call from LLM output
 */
export interface ParsedTextTool {
  /** The tool name */
  toolName: string;
  /** Arguments extracted from the markup */
  arguments: Record<string, unknown>;
  /** The full matched markup text (for stripping) */
  fullMatch: string;
  /** Start index in the original text */
  startIndex: number;
  /** End index in the original text */
  endIndex: number;
  /** Which format was detected */
  format: 'deepseek' | 'claude' | 'generic' | 'function_call' | 'tool_use' | 'invoke';
}

/**
 * Common tool name aliases that models use when hallucinating tool calls.
 * Maps common variations to canonical Quilltap tool names.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // Direct mappings
  'search': 'search',
  'generate_image': 'generate_image',
  'search_web': 'search_web',

  // Memory/Search tool aliases
  'memory': 'search',
  'memory_search': 'search',
  'search_memory': 'search',
  'memories': 'search',
  'search_memories': 'search',
  'search_scriptorium': 'search',

  // Image tool aliases
  'image': 'generate_image',
  'create_image': 'generate_image',
  'image_generation': 'generate_image',
  'gen_image': 'generate_image',

  // Web search aliases
  'web_search': 'search_web',
  'websearch': 'search_web',
  'web': 'search_web',

  // Help tool aliases
  'help_search': 'help_search',
  'helpsearch': 'help_search',
  'search_help': 'help_search',
  'help_navigate': 'help_navigate',
  'helpnavigate': 'help_navigate',
};

/**
 * Normalize a tool name from hallucinated markup to the canonical name.
 * Returns the original name if no alias is found (passes through unknown tools).
 */
export function normalizeToolName(name: string): string {
  const normalized = name.toLowerCase().trim();
  return TOOL_NAME_ALIASES[normalized] || name;
}

/**
 * Convert a ParsedTextTool to the standard ToolCallRequest format.
 *
 * For well-known tools, normalizes argument names (e.g., "search" → "query").
 * For unknown tools, passes arguments through as-is.
 */
export function convertToToolCallRequest(parsed: ParsedTextTool): ToolCallRequest {
  switch (parsed.toolName) {
    case 'search':
      return {
        name: 'search',
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || '',
          limit: parsed.arguments.limit,
        },
      };

    case 'generate_image':
      return {
        name: 'generate_image',
        arguments: {
          prompt: parsed.arguments.prompt || parsed.arguments.description || Object.values(parsed.arguments)[0] || '',
        },
      };

    case 'search_web':
      return {
        name: 'search_web',
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || '',
        },
      };

    case 'help_search':
      return {
        name: 'help_search',
        arguments: {
          query: parsed.arguments.query || parsed.arguments.search || Object.values(parsed.arguments)[0] || '',
          limit: parsed.arguments.limit,
        },
      };

    case 'help_navigate':
      return {
        name: 'help_navigate',
        arguments: {
          url: parsed.arguments.url || parsed.arguments.path || Object.values(parsed.arguments)[0] || '',
        },
      };

    default:
      // Pass through unknown tools with their original arguments
      return {
        name: parsed.toolName,
        arguments: parsed.arguments,
      };
  }
}

// ============================================================================
// Individual format parsers
// ============================================================================

/**
 * Parse `<function_calls><invoke name="...">` format (DeepSeek and Claude-style)
 */
export function parseFunctionCallsFormat(response: string): ParsedTextTool[] {
  const results: ParsedTextTool[] = [];

  const functionCallsPattern = /<function_calls>([\s\S]*?)<\/function_calls>/gi;

  let wrapperMatch;
  while ((wrapperMatch = functionCallsPattern.exec(response)) !== null) {
    const wrapperContent = wrapperMatch[1];
    const wrapperStartIndex = wrapperMatch.index;
    const contentOffset = wrapperStartIndex + '<function_calls>'.length;

    const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;

    let invokeMatch;
    while ((invokeMatch = invokePattern.exec(wrapperContent)) !== null) {
      const toolName = invokeMatch[1];
      const paramContent = invokeMatch[2];
      const invokeStartIndex = contentOffset + invokeMatch.index;
      const invokeEndIndex = invokeStartIndex + invokeMatch[0].length;

      const args: Record<string, unknown> = {};
      let format: 'deepseek' | 'claude' = 'claude';

      // DeepSeek format: <parameter name="..." string="...">value</parameter>
      const deepseekParamPattern = /<parameter\s+name=["']([^"']+)["']\s+string=["']([^"']*)["'][^>]*>([^<]*)<\/parameter>/gi;
      let paramMatch;
      while ((paramMatch = deepseekParamPattern.exec(paramContent)) !== null) {
        const paramName = paramMatch[1];
        const stringAttr = paramMatch[2];
        const value = paramMatch[3].trim();

        if (stringAttr === 'false') {
          const numVal = Number(value);
          if (!isNaN(numVal)) {
            args[paramName] = numVal;
          } else if (value === 'true') {
            args[paramName] = true;
          } else if (value === 'false') {
            args[paramName] = false;
          } else {
            args[paramName] = value;
          }
        } else {
          args[paramName] = value;
        }
        format = 'deepseek';
      }

      // Claude format: <parameter name="...">value</parameter>
      if (Object.keys(args).length === 0) {
        const claudeParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
        while ((paramMatch = claudeParamPattern.exec(paramContent)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim();
        }
      }

      // antml:parameter format (Claude Code style)
      const antmlParamPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/antml:parameter>/gi;
      while ((paramMatch = antmlParamPattern.exec(paramContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      results.push({
        toolName: normalizeToolName(toolName),
        arguments: args,
        fullMatch: invokeMatch[0],
        startIndex: invokeStartIndex,
        endIndex: invokeEndIndex,
        format,
      });
    }
  }

  return results;
}

/**
 * Parse `<tool_call>` format (generic XML)
 */
export function parseToolCallFormat(response: string): ParsedTextTool[] {
  const results: ParsedTextTool[] = [];

  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;

  let match;
  while ((match = toolCallPattern.exec(response)) !== null) {
    const content = match[1];
    const startIndex = match.index;

    const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
    if (!nameMatch) continue;

    const toolName = nameMatch[1].trim();
    const args: Record<string, unknown> = {};

    const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1];
      const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
      let argMatch;
      while ((argMatch = argPattern.exec(argsContent)) !== null) {
        args[argMatch[1]] = argMatch[2].trim();
      }
    }

    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'generic',
    });
  }

  return results;
}

/**
 * Parse `<function_call name="...">` format
 */
export function parseFunctionCallFormat(response: string): ParsedTextTool[] {
  const results: ParsedTextTool[] = [];

  const functionCallPattern = /<function_call\s+name=["']([^"']+)["']>([\s\S]*?)<\/function_call>/gi;

  let match;
  while ((match = functionCallPattern.exec(response)) !== null) {
    const toolName = match[1];
    const content = match[2];
    const startIndex = match.index;

    const args: Record<string, unknown> = {};

    const paramPattern = /<param\s+name=["']([^"']+)["']>([^<]*)<\/param>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }

    const parameterPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    while ((paramMatch = parameterPattern.exec(content)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }

    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'function_call',
    });
  }

  return results;
}

/**
 * Parse `<tool_use>` format (Gemini and others)
 *
 * Handles multiple sub-formats:
 * - Bare JSON: `<tool_use>{"name":"fn","input":{...}}</tool_use>`
 * - XML children: `<tool_use><name>fn</name><arguments>...</arguments></tool_use>`
 * - JSON in arguments: `<tool_use><name>fn</name><arguments>{"q":"v"}</arguments></tool_use>`
 * - Attributed: `<tool_use name="fn"><arguments>...</arguments></tool_use>`
 */
export function parseToolUseFormat(response: string): ParsedTextTool[] {
  const results: ParsedTextTool[] = [];

  const toolUsePattern = /<tool_use(?:\s+name=["']([^"']+)["'])?\s*>([\s\S]*?)<\/tool_use>/gi;

  let match;
  while ((match = toolUsePattern.exec(response)) !== null) {
    const attrName = match[1];
    const content = match[2];
    const startIndex = match.index;

    // Try bare JSON first (Gemini's primary format)
    const trimmedContent = content.trim();
    if (trimmedContent.startsWith('{')) {
      try {
        const jsonBlob = JSON.parse(trimmedContent);
        if (typeof jsonBlob === 'object' && jsonBlob !== null && jsonBlob.name) {
          const args = jsonBlob.input || jsonBlob.arguments || jsonBlob.parameters || {};
          results.push({
            toolName: normalizeToolName(jsonBlob.name),
            arguments: typeof args === 'object' && args !== null ? args : {},
            fullMatch: match[0],
            startIndex,
            endIndex: startIndex + match[0].length,
            format: 'tool_use',
          });
          continue;
        }
      } catch {
        // Not valid JSON, fall through
      }
    }

    // Extract name from attribute or child element
    let toolName = attrName;
    if (!toolName) {
      const nameMatch = /<name>([^<]+)<\/name>/i.exec(content);
      if (!nameMatch) continue;
      toolName = nameMatch[1].trim();
    }

    const args: Record<string, unknown> = {};

    // Try <arguments>, <input>, or <parameters>
    const argsMatch = /<(?:arguments|input|parameters)>([\s\S]*?)<\/(?:arguments|input|parameters)>/i.exec(content);
    if (argsMatch) {
      const argsContent = argsMatch[1].trim();

      if (argsContent.startsWith('{')) {
        try {
          const parsed = JSON.parse(argsContent);
          if (typeof parsed === 'object' && parsed !== null) {
            Object.assign(args, parsed);
          }
        } catch {
          // Not valid JSON
        }
      }

      if (Object.keys(args).length === 0) {
        const argPattern = /<(\w+)>([^<]*)<\/\1>/gi;
        let argMatch;
        while ((argMatch = argPattern.exec(argsContent)) !== null) {
          args[argMatch[1]] = argMatch[2].trim();
        }
      }
    }

    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'tool_use',
    });
  }

  return results;
}

/**
 * Parse bare `<invoke name="...">` format (Kimi K2 and similar models)
 *
 * Matches `<invoke>` tags that appear WITHOUT a `<function_calls>` wrapper.
 * IMPORTANT: In composite parsing, this must run AFTER parseFunctionCallsFormat
 * so that wrapped invokes are claimed first and deduplicated by startIndex.
 */
export function parseInvokeFormat(response: string): ParsedTextTool[] {
  const results: ParsedTextTool[] = [];

  const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;

  let match;
  while ((match = invokePattern.exec(response)) !== null) {
    const toolName = match[1];
    const paramContent = match[2];
    const startIndex = match.index;

    const args: Record<string, unknown> = {};

    // Parse <parameter name="...">value</parameter> children
    const paramPattern = /<parameter\s+name=["']([^"']+)["']>([^<]*)<\/parameter>/gi;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(paramContent)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }

    results.push({
      toolName: normalizeToolName(toolName),
      arguments: args,
      fullMatch: match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
      format: 'invoke',
    });
  }

  return results;
}

// ============================================================================
// Composite utilities for plugins
// ============================================================================

/**
 * Parse all known XML tool call formats from response text.
 * Deduplicates by position and sorts by start index.
 *
 * Plugins can call this directly or compose individual format parsers
 * for provider-specific behavior.
 */
export function parseAllXMLFormats(response: string): ParsedTextTool[] {
  const allResults: ParsedTextTool[] = [];

  allResults.push(...parseFunctionCallsFormat(response));
  allResults.push(...parseToolCallFormat(response));
  allResults.push(...parseFunctionCallFormat(response));
  allResults.push(...parseToolUseFormat(response));
  // Bare <invoke> MUST be last — wrapped invokes inside <function_calls> are
  // already claimed above and will be deduplicated by startIndex.
  allResults.push(...parseInvokeFormat(response));

  // Deduplicate by startIndex
  const seen = new Set<number>();
  const deduped = allResults.filter(result => {
    if (seen.has(result.startIndex)) {
      return false;
    }
    seen.add(result.startIndex);
    return true;
  });

  deduped.sort((a, b) => a.startIndex - b.startIndex);
  return deduped;
}

/**
 * Convert parsed text tools to standard ToolCallRequest array.
 * Convenience wrapper for plugins implementing parseTextToolCalls.
 */
export function parseAllXMLAsToolCalls(response: string): ToolCallRequest[] {
  return parseAllXMLFormats(response).map(convertToToolCallRequest);
}

/**
 * Check if text contains any of the known XML tool call patterns.
 * Quick regex check before full parsing.
 */
export function hasAnyXMLToolMarkers(response: string): boolean {
  return (
    /<function_calls>/i.test(response) ||
    /<tool_call>/i.test(response) ||
    /<function_call\s+/i.test(response) ||
    /<tool_use[\s>]/i.test(response) ||
    /<invoke\s+name=/i.test(response)
  );
}

// Individual marker checks for plugins that only care about specific formats

/** Check for `<function_calls>` markers (DeepSeek/Claude-style) */
export function hasFunctionCallsMarkers(response: string): boolean {
  return /<function_calls>/i.test(response);
}

/** Check for `<tool_call>` markers (generic) */
export function hasToolCallMarkers(response: string): boolean {
  return /<tool_call>/i.test(response);
}

/** Check for `<function_call>` markers */
export function hasFunctionCallMarkers(response: string): boolean {
  return /<function_call\s+/i.test(response);
}

/** Check for `<tool_use>` markers (Gemini-style) */
export function hasToolUseMarkers(response: string): boolean {
  return /<tool_use[\s>]/i.test(response);
}

/** Check for bare `<invoke name="...">` markers (Kimi K2-style) */
export function hasInvokeMarkers(response: string): boolean {
  return /<invoke\s+name=/i.test(response);
}

/**
 * Strip all known XML tool call markers from text.
 * Cleans up whitespace left behind.
 */
export function stripAllXMLToolMarkers(response: string): string {
  let stripped = response;

  // <function_calls> MUST be stripped first — it contains <invoke> tags that
  // would otherwise be matched by the bare <invoke> stripper below, leaving
  // empty <function_calls></function_calls> wrappers behind.
  stripped = stripped.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
  stripped = stripped.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  stripped = stripped.replace(/<function_call\s+[^>]*>[\s\S]*?<\/function_call>/gi, '');
  stripped = stripped.replace(/<tool_use[\s>][\s\S]*?<\/tool_use>/gi, '');
  // Bare <invoke> last — only catches unwrapped invoke tags (Kimi K2-style)
  stripped = stripped.replace(/<invoke\s+name=["'][^"']*["']>[\s\S]*?<\/invoke>/gi, '');

  stripped = stripped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();

  return stripped;
}

// Individual strippers for plugins that only handle specific formats

/** Strip `<function_calls>` blocks */
export function stripFunctionCallsMarkers(response: string): string {
  return response.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
}

/** Strip `<tool_call>` blocks */
export function stripToolCallMarkers(response: string): string {
  return response.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
}

/** Strip `<function_call>` blocks */
export function stripFunctionCallMarkers(response: string): string {
  return response.replace(/<function_call\s+[^>]*>[\s\S]*?<\/function_call>/gi, '');
}

/** Strip `<tool_use>` blocks */
export function stripToolUseMarkers(response: string): string {
  return response.replace(/<tool_use[\s>][\s\S]*?<\/tool_use>/gi, '');
}

/** Strip bare `<invoke>` blocks (Kimi K2-style) */
export function stripInvokeMarkers(response: string): string {
  return response.replace(/<invoke\s+name=["'][^"']*["']>[\s\S]*?<\/invoke>/gi, '');
}
