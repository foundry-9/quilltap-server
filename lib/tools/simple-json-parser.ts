/**
 * Simple JSON Tool Call Parser
 *
 * Parses `<tool_call>{"name":"...","arguments":{...}}</tool_call>` markers from
 * LLM responses. This is the replacement emission surface for the text-block
 * pseudo-tool format on models without native function calling.
 *
 * The parser is lenient and runs in three tiers, escalating only when an
 * earlier tier fails:
 *
 *   1. Strict   — `JSON.parse` on the substring between the tags.
 *   2. Repaired — same substring, run through `jsonrepair`. Handles trailing
 *                 commas, single quotes, unquoted keys, smart quotes.
 *   3. Brace    — balanced-brace walk starting at the first `{` after the
 *                 opening tag, retry `jsonrepair`. Last resort for emissions
 *                 that drop the closing tag entirely.
 *
 * Opening-tag drift is tolerated: `<tool_call>`, `<toolcall>`, `<tool>`,
 * `<call>`, and `<function_call>` are all accepted aliases. The closing tag
 * must match the opening tag's exact form; a missing closing tag is recoverable
 * via tier 3.
 *
 * If all three tiers fail the parser logs at `warn` with the raw payload and
 * returns an empty array. The strategy then degrades gracefully — the user
 * sees the assistant's prose, the tool simply didn't fire.
 *
 * Only the first block in a response is honoured (one tool call per turn).
 */

import { jsonrepair } from 'jsonrepair'

import { logger } from '@/lib/logger'

/** Which tier of the parser produced a result. Surfaced for observability. */
export type SimpleJsonParserTier = 'strict' | 'repaired' | 'brace' | 'fail'

/** A parsed `<tool_call>` block from a response. */
export interface ParsedSimpleJsonCall {
  /** The tool name as written in the JSON `name` field. */
  toolName: string
  /** The JSON `arguments` object. */
  arguments: Record<string, unknown>
  /** Full matched text (for stripping). */
  fullMatch: string
  /** Start index in the original text. */
  startIndex: number
  /** End index in the original text. */
  endIndex: number
  /** Which tier produced the parse. */
  parserTier: SimpleJsonParserTier
}

interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Opening-tag aliases accepted by the parser. Order matters only for
 * disambiguation when a response is malformed; otherwise these are equivalent.
 */
const OPENING_TAG_ALIASES = ['tool_call', 'toolcall', 'tool', 'call', 'function_call'] as const

/**
 * Tool-name aliases. Reused from the text-block parser's behaviour so models
 * fluent in one dialect can call the same tool through the other.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // image
  image: 'generate_image',
  create_image: 'generate_image',
  // web search
  web_search: 'search_web',
  // notes
  note: 'create_note',
  // dice
  dice: 'rng',
  roll: 'rng',
  random: 'rng',
  // help
  help: 'help_search',
  search_help: 'help_search',
  settings: 'help_settings',
  navigate: 'help_navigate',
  // projects
  project: 'project_info',
  // wardrobe
  wardrobe: 'wardrobe_list',
  closet: 'wardrobe_list',
  list_wardrobe: 'wardrobe_list',
  read_wardrobe: 'wardrobe_read',
  inspect: 'wardrobe_read',
  set_outfit: 'wardrobe_wear',
  wear_outfit: 'wardrobe_wear',
  outfit: 'wardrobe_wear',
  wear: 'wardrobe_wear',
  change_item: 'wardrobe_wear',
  equip: 'wardrobe_wear',
  layer: 'wardrobe_wear',
  swap: 'wardrobe_wear',
  take_off: 'wardrobe_take_off',
  unequip: 'wardrobe_take_off',
  remove: 'wardrobe_take_off',
  undress: 'wardrobe_take_off',
  create_wardrobe_item: 'wardrobe_create',
  update_wardrobe_item: 'wardrobe_update',
  edit_wardrobe: 'wardrobe_update',
  archive_wardrobe_item: 'wardrobe_archive',
  discard: 'wardrobe_archive',
  // memory / scriptorium
  scriptorium: 'search',
  memory: 'search',
  memories: 'search',
  search_memory: 'search',
  search_memories: 'search',
  search_scriptorium: 'search',
}

/** Map a tool name as emitted by the LLM to its internal canonical name. */
export function mapSimpleJsonToolName(name: string): string {
  const normalized = name.toLowerCase().trim()
  return TOOL_NAME_ALIASES[normalized] || normalized
}

/**
 * Build the regex that locates a `<tool_call>` (or alias) opening tag,
 * captures everything up to the matching closing tag, and ALSO matches
 * malformed blocks where the closing tag is missing — in which case tier 3
 * picks up the slack.
 */
const TAG_PATTERN = new RegExp(
  `<(${OPENING_TAG_ALIASES.join('|')})\\s*>([\\s\\S]*?)(?:<\\/\\1\\s*>|$)`,
  'i',
)

/** Quick boolean check — runs before the full parser. */
export function hasSimpleJsonMarkers(response: string): boolean {
  for (const tag of OPENING_TAG_ALIASES) {
    if (response.toLowerCase().includes(`<${tag}>`) || response.toLowerCase().includes(`<${tag} `)) {
      return true
    }
  }
  return false
}

/**
 * Walk `text` starting at `startIdx` (which should point at `{`) and return
 * the index immediately after the matching closing `}`. Respects string
 * literals and `\\` escapes. Returns -1 if no balanced object can be found.
 */
function findBalancedBraceEnd(text: string, startIdx: number): number {
  if (text[startIdx] !== '{') return -1

  let depth = 0
  let inString = false
  let stringQuote: '"' | "'" | null = null

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === stringQuote) {
        inString = false
        stringQuote = null
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch as '"' | "'"
      continue
    }

    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
  }

  return -1
}

interface RawParse {
  payload: string
  tier: SimpleJsonParserTier
}

/** Try the three tiers, in order. Returns the parsed object plus the tier hit. */
function parseLenient(rawBody: string, fullBlock: string): { object: Record<string, unknown>; tier: SimpleJsonParserTier } | null {
  // Tier 1 — strict
  const stripped = rawBody.trim()
  if (stripped) {
    try {
      const parsed = JSON.parse(stripped)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { object: parsed as Record<string, unknown>, tier: 'strict' }
      }
    } catch {
      // fall through to tier 2
    }

    // Tier 2 — repaired
    try {
      const repaired = jsonrepair(stripped)
      const parsed = JSON.parse(repaired)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { object: parsed as Record<string, unknown>, tier: 'repaired' }
      }
    } catch {
      // fall through to tier 3
    }
  }

  // Tier 3 — balanced brace walk inside the full block (in case the closing
  // tag was dropped entirely and the body bled past it)
  const braceStart = fullBlock.indexOf('{')
  if (braceStart !== -1) {
    const braceEnd = findBalancedBraceEnd(fullBlock, braceStart)
    if (braceEnd !== -1) {
      const candidate = fullBlock.slice(braceStart, braceEnd)
      try {
        const repaired = jsonrepair(candidate)
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { object: parsed as Record<string, unknown>, tier: 'brace' }
        }
      } catch {
        // give up
      }
    }
  }

  return null
}

/**
 * Parse all `<tool_call>` blocks from a response. Only the FIRST block is
 * actually returned — the spec is "one tool call per turn" and the parser
 * enforces it. Extra blocks are silently dropped.
 */
export function parseSimpleJsonCalls(response: string): ParsedSimpleJsonCall[] {
  if (!response) return []

  const match = response.match(TAG_PATTERN)
  if (!match || match.index === undefined) {
    return []
  }

  const tier1Body = match[2] ?? ''
  const fullMatch = match[0]
  const startIndex = match.index
  const endIndex = startIndex + fullMatch.length

  const parsed = parseLenient(tier1Body, fullMatch)
  if (!parsed) {
    logger.warn('[SimpleJsonParser] All parser tiers failed; dropping tool call', {
      tagPreview: fullMatch.slice(0, 200),
    })
    return []
  }

  const nameRaw = parsed.object.name
  if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
    logger.warn('[SimpleJsonParser] Parsed object missing string `name`; dropping', {
      tier: parsed.tier,
      keys: Object.keys(parsed.object),
    })
    return []
  }

  const argsRaw = parsed.object.arguments
  const args: Record<string, unknown> =
    argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {}

  return [
    {
      toolName: nameRaw.trim(),
      arguments: args,
      fullMatch,
      startIndex,
      endIndex,
      parserTier: parsed.tier,
    },
  ]
}

/** Convert a parsed block to the canonical `{ name, arguments }` request. */
export function convertSimpleJsonToToolCallRequest(parsed: ParsedSimpleJsonCall): ToolCallRequest {
  return {
    name: mapSimpleJsonToolName(parsed.toolName),
    arguments: parsed.arguments,
  }
}

/**
 * Strip all `<tool_call>` (and alias-tag) blocks from a response for display.
 * Idempotent. Cleans up whitespace artifacts left behind by stripping.
 */
export function stripSimpleJsonMarkers(response: string): string {
  if (!response) return response

  let stripped = response

  // Remove well-formed open+close blocks for every alias.
  for (const tag of OPENING_TAG_ALIASES) {
    const closed = new RegExp(`<${tag}\\s*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
    stripped = stripped.replace(closed, '')
  }

  // Remove dangling opening tags + the JSON object that follows (tier-3-shaped).
  for (const tag of OPENING_TAG_ALIASES) {
    const openOnly = new RegExp(`<${tag}\\s*>\\s*\\{[\\s\\S]*$`, 'gi')
    stripped = stripped.replace(openOnly, (open) => {
      // Try to truncate at the matching brace if we can; otherwise drop the
      // whole tail.
      const braceStart = open.indexOf('{')
      if (braceStart === -1) return ''
      const braceEnd = findBalancedBraceEnd(open, braceStart)
      if (braceEnd === -1) return ''
      // Keep whatever comes AFTER the balanced object — usually empty under
      // a stop sequence, but if the model snuck content past the brace, we
      // surface it rather than swallow it.
      return open.slice(braceEnd)
    })
  }

  return stripped.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Escape a string for safe use inside an XML attribute value. Used by the
 * strategy's `formatToolResult` to build `<tool_result name="...">` headers
 * for the continuation slate.
 */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** The canonical stop sequence the strategy passes to providers. */
export const SIMPLE_JSON_STOP_SEQUENCES = ['</tool_call>']
