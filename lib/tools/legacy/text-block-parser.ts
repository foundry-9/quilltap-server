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
 * Standard tool call request format (used locally by convertTextBlockToToolCallRequest)
 */
interface ToolCallRequest {
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
  'generate_image': 'generate_image',
  'search_web': 'search_web',
  'create_note': 'create_note',
  'rng': 'rng',
  'state': 'state',
  'project_info': 'project_info',
  'help_search': 'help_search',
  'search_help': 'help_search',  // Backward compatibility alias
  'help_settings': 'help_settings',
  'help_navigate': 'help_navigate',
  'navigate': 'help_navigate',  // Common alias

  // Common aliases
  'image': 'generate_image',
  'create_image': 'generate_image',

  'web_search': 'search_web',

  'note': 'create_note',

  'dice': 'rng',
  'roll': 'rng',
  'random': 'rng',

  'help': 'help_search',
  'settings': 'help_settings',

  'project': 'project_info',

  // Wardrobe tools
  'wardrobe_list': 'wardrobe_list',
  'list_wardrobe': 'wardrobe_list',
  'wardrobe': 'wardrobe_list',
  'closet': 'wardrobe_list',

  'wardrobe_read': 'wardrobe_read',
  'read_wardrobe': 'wardrobe_read',
  'inspect': 'wardrobe_read',

  'wardrobe_wear': 'wardrobe_wear',
  'wear': 'wardrobe_wear',
  'equip': 'wardrobe_wear',
  'layer': 'wardrobe_wear',
  'swap': 'wardrobe_wear',
  'set_outfit': 'wardrobe_wear',
  'wear_outfit': 'wardrobe_wear',
  'outfit': 'wardrobe_wear',
  'change_item': 'wardrobe_wear',

  'wardrobe_take_off': 'wardrobe_take_off',
  'take_off': 'wardrobe_take_off',
  'unequip': 'wardrobe_take_off',
  'remove': 'wardrobe_take_off',
  'undress': 'wardrobe_take_off',

  'wardrobe_create': 'wardrobe_create',
  'create_wardrobe_item': 'wardrobe_create',

  'wardrobe_update': 'wardrobe_update',
  'update_wardrobe_item': 'wardrobe_update',
  'edit_wardrobe': 'wardrobe_update',

  'wardrobe_archive': 'wardrobe_archive',
  'archive_wardrobe_item': 'wardrobe_archive',
  'discard': 'wardrobe_archive',

  // Scriptorium search
  'search': 'search',
  'scriptorium': 'search',
  'memory': 'search',
  'memories': 'search',
  'search_memory': 'search',
  'search_memories': 'search',
  'search_scriptorium': 'search',
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
  wardrobe_wear: {
    'id': 'item_id',
    'title': 'item_title',
    'name': 'item_title',
  },
  wardrobe_take_off: {
    'id': 'item_id',
    'title': 'item_title',
    'name': 'item_title',
  },
  wardrobe_read: {
    'id': 'item_id',
    'title': 'item_title',
    'name': 'item_title',
  },
  wardrobe_archive: {
    'id': 'item_id',
    'title': 'item_title',
    'name': 'item_title',
  },
  wardrobe_update: {
    // `id`/`name` locate the item; `title` is the NEW name, so it is NOT aliased.
    'id': 'item_id',
    'name': 'item_title',
    'cue': 'image_prompt',
    'context': 'appropriateness',
  },
  wardrobe_create: {
    'name': 'title',
    'type': 'types',
    'context': 'appropriateness',
    'cue': 'image_prompt',
    'to': 'recipient',
    'for': 'recipient',
    'give_to': 'recipient',
    'gift_to': 'recipient',
    'components': 'component_item_ids',
    'component_ids': 'component_item_ids',
    'component_names': 'component_titles',
  },
  search: {
    'search': 'query',
    'q': 'query',
    'count': 'limit',
    'max': 'limit',
  },
}

/**
 * Map of which parameter receives the content block for each tool.
 * If a tool isn't listed here, content maps to 'content' by default.
 */
const CONTENT_PARAM_MAP: Record<string, string> = {
  whisper: 'message',
  generate_image: 'prompt',
  search_web: 'query',
  create_note: 'content',
  help_search: 'query',
  search: 'query',
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

  // wardrobe_wear / wardrobe_take_off take an `operations` array; the flat
  // text-block syntax expresses a single operation, so wrap the resolved
  // mode/item/slot into a one-element array. (The legacy surface is single-op.)
  if (internalName === 'wardrobe_wear' || internalName === 'wardrobe_take_off') {
    const { mode, item_id, item_title, slot, ...rest } = args
    const op: Record<string, unknown> = {}
    if (mode !== undefined) op.mode = mode
    if (item_id !== undefined) op.item_id = item_id
    if (item_title !== undefined) op.item_title = item_title
    if (slot !== undefined) op.slot = slot
    return {
      name: internalName,
      arguments: { ...rest, operations: [op] },
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
