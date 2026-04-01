/**
 * Pseudo-Tool Response Parser
 *
 * Parses [TOOL:name]argument[/TOOL] markers from LLM responses and converts
 * them to the standard ToolCallRequest format for execution.
 */

import { logger } from '@/lib/logger'

/**
 * Parsed pseudo-tool call from text
 */
export interface ParsedPseudoTool {
  /** The tool name in our internal format (search_memories, generate_image, search_web) */
  toolName: string
  /** The argument/query passed to the tool */
  argument: string
  /** The full matched marker text (for replacement) */
  fullMatch: string
  /** Start index in the original text */
  startIndex: number
  /** End index in the original text */
  endIndex: number
}

/**
 * Standard tool call request format (matches existing tool executor interface)
 */
export interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Map pseudo-tool marker names to internal tool names
 */
const TOOL_NAME_MAP: Record<string, string> = {
  'memory': 'search_memories',
  'image': 'generate_image',
  'search': 'search_web',
}

/**
 * Parse pseudo-tool markers from response text
 *
 * Supports the format: [TOOL:name]argument[/TOOL]
 * Where name is one of: memory, image, search
 *
 * @param response - The LLM's text response
 * @returns Array of parsed pseudo-tool calls
 */
export function parsePseudoToolCalls(response: string): ParsedPseudoTool[] {
  const results: ParsedPseudoTool[] = []

  // Pattern: [TOOL:name]content[/TOOL]
  // Captures: (1) tool name, (2) argument content
  // Uses non-greedy match for content to handle multiple tools
  const pattern = /\[TOOL:(memory|image|search)\]([\s\S]*?)\[\/TOOL\]/gi

  let match
  while ((match = pattern.exec(response)) !== null) {
    const markerName = match[1].toLowerCase()
    const argument = match[2].trim()
    const internalName = TOOL_NAME_MAP[markerName]

    if (internalName) {
      results.push({
        toolName: internalName,
        argument,
        fullMatch: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      })
    }
  }

  if (results.length > 0) {

  }

  return results
}

/**
 * Convert a parsed pseudo-tool to the standard ToolCallRequest format
 *
 * This allows pseudo-tools to be executed through the same pipeline
 * as native tool calls.
 */
export function convertToToolCallRequest(parsed: ParsedPseudoTool): ToolCallRequest {
  switch (parsed.toolName) {
    case 'search_memories':
      return {
        name: 'search_memories',
        arguments: { query: parsed.argument },
      }

    case 'generate_image':
      return {
        name: 'generate_image',
        arguments: { prompt: parsed.argument },
      }

    case 'search_web':
      return {
        name: 'search_web',
        arguments: { query: parsed.argument },
      }

    default:
      // Fallback for unknown tools
      return {
        name: parsed.toolName,
        arguments: { query: parsed.argument },
      }
  }
}

/**
 * Strip pseudo-tool markers from response text for display
 *
 * Removes all [TOOL:*]...[/TOOL] markers so the displayed response
 * is clean. Tool execution status is shown separately in the UI.
 */
export function stripPseudoToolMarkers(response: string): string {
  // Remove all [TOOL:*]...[/TOOL] markers
  const stripped = response.replace(/\[TOOL:(memory|image|search)\][\s\S]*?\[\/TOOL\]/gi, '')

  // Clean up any double spaces or newlines left behind
  return stripped
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple newlines
    .replace(/  +/g, ' ')        // Collapse multiple spaces
    .trim()
}

/**
 * Check if a response contains any pseudo-tool markers
 */
export function hasPseudoToolMarkers(response: string): boolean {
  return /\[TOOL:(memory|image|search)\]/i.test(response)
}
