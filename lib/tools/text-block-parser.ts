/**
 * Text-Block Tool Call Parser
 *
 * Parses [[TOOL_NAME param="value"]]content[[/TOOL_NAME]] markers from LLM responses
 * and converts them to the standard ToolCallRequest format for execution.
 *
 * This is a richer text-based tool invocation format that supports named parameters,
 * content blocks, and ALL tools — unlike the legacy pseudo-tool format which only
 * supports 3 tools via [TOOL:name]argument[/TOOL].
 *
 * Supports:
 * - Content form: [[TOOL_NAME param="value"]]content here[[/TOOL_NAME]]
 * - Self-closing form: [[TOOL_NAME param="value" /]]
 * - Multiple parameters: [[TOOL_NAME a="1" b="2"]]content[[/TOOL_NAME]]
 * - Case-insensitive tool names
 * - No nested text blocks (non-greedy matching)
 */

import { logger } from '@/lib/logger'

/**
 * Parsed text-block tool call from text
 */
export interface ParsedTextBlock {
  /** The tool name as written in the marker (before mapping) */
  toolName: string
  /** Named parameters from the opening tag */
  params: Record<string, string>
  /** Content between opening and closing tags (empty string for self-closing) */
  content: string
  /** The full matched text (for replacement/stripping) */
  fullMatch: string
  /** Start index in the original text */
  startIndex: number
  /** End index in the original text */
  endIndex: number
}

/**
 * Standard tool call request format (re-exported for convenience)
 */
export interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Map text-block tool names to internal tool names.
 * Case-insensitive — all keys are lowercase.
 */
const TEXT_BLOCK_TOOL_NAME_MAP: Record<string, string> = {
  // Direct mappings
  'whisper': 'whisper',
  'search_memories': 'search_memories',
  'generate_image': 'generate_image',
  'search_web': 'search_web',
  'create_note': 'create_note',
  'rng': 'rng',
  'state': 'state',
  'project_info': 'project_info',
  'file_management': 'file_management',
  'help_search': 'help_search',
  'search_help': 'help_search',  // Backward compatibility alias
  'help_settings': 'help_settings',
  'help_navigate': 'help_navigate',
  'navigate': 'help_navigate',  // Common alias

  // Common aliases
  'memory': 'search_memories',
  'search_memory': 'search_memories',
  'memories': 'search_memories',

  'image': 'generate_image',
  'create_image': 'generate_image',

  'search': 'search_web',
  'web_search': 'search_web',

  'note': 'create_note',

  'dice': 'rng',
  'roll': 'rng',
  'random': 'rng',

  'help': 'help_search',
  'settings': 'help_settings',

  'files': 'file_management',
  'file': 'file_management',

  'project': 'project_info',

  // Wardrobe tools
  'list_wardrobe': 'list_wardrobe',
  'wardrobe': 'list_wardrobe',
  'closet': 'list_wardrobe',

  'update_outfit_item': 'update_outfit_item',
  'equip': 'update_outfit_item',
  'wear': 'update_outfit_item',
  'outfit': 'update_outfit_item',

  'create_wardrobe_item': 'create_wardrobe_item',
}

/**
 * Map parameter aliases to canonical parameter names per tool.
 * Format: { toolName: { alias: canonicalName } }
 */
const PARAM_ALIAS_MAP: Record<string, Record<string, string>> = {
  whisper: {
    'to': 'target',
    'recipient': 'target',
    'character': 'target',
    'msg': 'message',
    'text': 'message',
  },
  search_memories: {
    'search': 'query',
    'q': 'query',
    'count': 'limit',
    'max': 'limit',
  },
  generate_image: {
    'description': 'prompt',
    'desc': 'prompt',
  },
  search_web: {
    'search': 'query',
    'q': 'query',
  },
  rng: {
    'dice': 'type',
    'roll': 'type',
  },
  help_search: {
    'search': 'query',
    'q': 'query',
  },
  help_settings: {
    'section': 'category',
    'type': 'category',
  },
  update_outfit_item: {
    'id': 'item_id',
    'title': 'item_title',
    'name': 'item_title',
  },
  create_wardrobe_item: {
    'name': 'title',
    'type': 'types',
    'context': 'appropriateness',
  },
}

/**
 * Map of which parameter receives the content block for each tool.
 * If a tool isn't listed here, content maps to 'content' by default.
 */
const CONTENT_PARAM_MAP: Record<string, string> = {
  whisper: 'message',
  search_memories: 'query',
  generate_image: 'prompt',
  search_web: 'query',
  create_note: 'content',
  help_search: 'query',
}

/**
 * Map a text-block tool name to the internal tool name
 */
export function mapTextBlockToolName(name: string): string {
  const normalized = name.toLowerCase().trim()
  return TEXT_BLOCK_TOOL_NAME_MAP[normalized] || normalized
}

/**
 * Parse named parameters from a tag's attribute string.
 * Supports both double and single quotes: param="value" or param='value'
 * Also handles backslash-escaped quotes: param=\"value\" (common LLM artifact)
 */
function parseTagParams(attrString: string): Record<string, string> {
  const params: Record<string, string> = {}
  // Match param="value", param='value', or param=\"value\" (backslash-escaped quotes)
  const paramPattern = /(\w+)\s*=\s*(?:\\?"([^"\\]*(?:\\.[^"\\]*)*)\\?"|'([^']*)')/g
  let match
  while ((match = paramPattern.exec(attrString)) !== null) {
    const value = match[2] ?? match[3]
    // Unescape any remaining backslash-escaped characters
    params[match[1]] = value ? value.replace(/\\(.)/g, '$1') : value
  }
  return params
}

/**
 * Parse all text-block tool calls from response text.
 *
 * Supports two forms:
 * 1. Content form: [[TOOL_NAME param="value"]]content[[/TOOL_NAME]]
 * 2. Self-closing form: [[TOOL_NAME param="value" /]]
 *
 * @param response - The LLM's text response
 * @returns Array of parsed text-block tool calls
 */
export function parseTextBlockCalls(response: string): ParsedTextBlock[] {
  const results: ParsedTextBlock[] = []

  // Content form: [[TOOL_NAME params]]content[[/TOOL_NAME]]
  // Tool name: word characters (letters, digits, underscore)
  // Non-greedy content match to prevent spanning across blocks
  // Supports both normal quotes and backslash-escaped quotes (LLM artifact)
  const contentPattern = /\[\[(\w+)((?:\s+\w+\s*=\s*(?:\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"|'[^']*'))*)\s*\]\]([\s\S]*?)\[\[\/\1\]\]/gi
  let match
  while ((match = contentPattern.exec(response)) !== null) {
    const toolName = match[1]
    const attrString = match[2]
    const content = match[3].trim()

    results.push({
      toolName,
      params: parseTagParams(attrString),
      content,
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }

  // Self-closing form: [[TOOL_NAME params /]]
  const selfClosingPattern = /\[\[(\w+)((?:\s+\w+\s*=\s*(?:\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"|'[^']*'))*)\s*\/\]\]/gi
  while ((match = selfClosingPattern.exec(response)) !== null) {
    // Skip if this overlaps with a content-form match
    const startIdx = match.index
    const endIdx = match.index + match[0].length
    const overlaps = results.some(r =>
      (startIdx >= r.startIndex && startIdx < r.endIndex) ||
      (endIdx > r.startIndex && endIdx <= r.endIndex)
    )
    if (overlaps) continue

    results.push({
      toolName: match[1],
      params: parseTagParams(match[2]),
      content: '',
      fullMatch: match[0],
      startIndex: startIdx,
      endIndex: endIdx,
    })
  }

  // Sort by position
  results.sort((a, b) => a.startIndex - b.startIndex)

  return results
}

/**
 * Resolve parameter aliases for a given tool.
 * Returns a new params object with canonical parameter names.
 */
function resolveParamAliases(toolName: string, params: Record<string, string>): Record<string, string> {
  const aliases = PARAM_ALIAS_MAP[toolName]
  if (!aliases) return { ...params }

  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    const canonical = aliases[key.toLowerCase()] || key
    resolved[canonical] = value
  }
  return resolved
}

/**
 * Convert a parsed text-block to the standard ToolCallRequest format.
 *
 * Maps tool name aliases, parameter aliases, and content to the appropriate
 * tool argument using per-tool mappings.
 */
export function convertTextBlockToToolCallRequest(parsed: ParsedTextBlock): ToolCallRequest {
  const internalName = mapTextBlockToolName(parsed.toolName)
  const resolvedParams = resolveParamAliases(internalName, parsed.params)

  // Build arguments from resolved params
  const args: Record<string, unknown> = { ...resolvedParams }

  // Map content to the tool-specific content parameter
  if (parsed.content) {
    const contentParam = CONTENT_PARAM_MAP[internalName] || 'content'
    // Only set if not already provided as a named param
    if (!args[contentParam]) {
      args[contentParam] = parsed.content
    }
  }

  // Convert numeric-looking values
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      if (value === 'true') {
        args[key] = true
      } else if (value === 'false') {
        args[key] = false
      } else {
        const num = Number(value)
        if (!isNaN(num) && value.trim() !== '' && key !== 'query' && key !== 'message' && key !== 'prompt' && key !== 'content' && key !== 'target') {
          args[key] = num
        }
      }
    }
  }

  return {
    name: internalName,
    arguments: args,
  }
}

/**
 * Strip all text-block markers from response text for display.
 *
 * Removes both content-form and self-closing text blocks so the displayed
 * response is clean. Tool execution status is shown separately in the UI.
 */
export function stripTextBlockMarkers(response: string): string {
  let stripped = response

  // Remove content-form blocks: [[TOOL]]content[[/TOOL]] (including backslash-escaped quotes)
  stripped = stripped.replace(/\[\[\w+(?:\s+\w+\s*=\s*(?:\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"|'[^']*'))*\s*\]\][\s\S]*?\[\[\/\w+\]\]/gi, '')

  // Remove self-closing blocks: [[TOOL params /]] (including backslash-escaped quotes)
  stripped = stripped.replace(/\[\[\w+(?:\s+\w+\s*=\s*(?:\\?"[^"\\]*(?:\\.[^"\\]*)*\\?"|'[^']*'))*\s*\/\]\]/gi, '')

  // Clean up whitespace artifacts
  stripped = stripped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim()

  return stripped
}

/**
 * Check if a response contains any text-block markers.
 * Quick check before doing full parsing.
 */
export function hasTextBlockMarkers(response: string): boolean {
  // Look for opening text-block tags: [[WORD with optional params]]
  // Must contain word chars (not just any bracket content) to avoid false positives
  // Also matches backslash-escaped quotes: [[WORD param=\"value\"]]
  return /\[\[\w+[\s\w="'\\\/]*\]\]/i.test(response)
}
