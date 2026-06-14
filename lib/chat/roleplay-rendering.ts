/**
 * Shared roleplay-rendering core.
 *
 * Single source of truth for turning a template's rendering patterns into styled
 * output. Both the client renderer (`components/chat/MessageContent.tsx`, which
 * emits React nodes) and the server renderer
 * (`lib/services/markdown-renderer.service.ts`, which emits an HTML string)
 * derive their behavior from this module, so they can no longer drift apart —
 * a new delimiter kind is implemented here exactly once.
 *
 * Framework-agnostic: no React, no DOM, no ESM-only deps — pure string work, so
 * it imports cleanly into both a `'use client'` component and a server service.
 *
 * @module lib/chat/roleplay-rendering
 */

import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

// ============================================================================
// SHARED DEFAULTS (single copy; both renderers import these)
// ============================================================================

/**
 * Default rendering patterns used when a template doesn't specify any.
 * Includes common patterns from both Standard and Quilltap-style formatting.
 */
export const DEFAULT_RENDERING_PATTERNS: RenderingPattern[] = [
  // OOC: ((comments)) - double parentheses
  { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
  // OOC: // comment - line prefix style
  { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' },
  // Dialogue: "speech" - straight and curly quotes
  { pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
  // Narration: *actions* - single asterisks (not bold **)
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  // Narration: [actions] - square brackets (not links)
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  // Internal monologue: {thoughts} - excludes {{template}} variables
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
]

/**
 * Default dialogue detection for paragraph-level styling.
 * Handles straight and curly quotes.
 */
export const DEFAULT_DIALOGUE_DETECTION: DialogueDetection = {
  openingChars: ['"', '"'],
  closingChars: ['"', '"'],
  className: 'qt-chat-dialogue',
}

// ============================================================================
// COMPILED RULES
// ============================================================================

/** A neutral run of text, optionally tagged with a CSS class. */
export interface Segment {
  text: string
  className?: string
}

/**
 * A compiled rendering rule.
 *
 * - `inline` rules wrap a matched span *within* a line (e.g. `*narration*`).
 * - `line` rules style the WHOLE block they match (e.g. a `// OOC` line or a
 *   `[CAPTAIN]` tag line). Line rules are applied at the block element by each
 *   adapter, never as an inline span — see {@link lineClassFor}.
 */
export interface CompiledRule {
  regex: RegExp
  className: string
  scope: 'inline' | 'line'
}

/**
 * Compile stored {@link RenderingPattern}s into rules.
 *
 * Patterns are compiled WITHOUT the global flag: matching walks the string and
 * advances manually (see {@link tokenizeInline}), so a stateful `lastIndex`
 * would be a bug. Any stored `g` flag is stripped. `scope` falls back to
 * `inline` for legacy patterns that predate the field.
 */
export function compileRenderingPatterns(patterns: RenderingPattern[]): CompiledRule[] {
  return patterns.map((p) => ({
    regex: new RegExp(p.pattern, (p.flags || '').replace('g', '')),
    className: p.className,
    scope: p.scope === 'line' ? 'line' : 'inline',
  }))
}

// ============================================================================
// TOKENIZER (the single match-walk shared by both renderers)
// ============================================================================

/**
 * Walk `text` once, finding the earliest match among the INLINE rules, and emit
 * neutral segments. Unmatched runs become plain `{ text }` segments; matched
 * runs become `{ text, className }`. Line-scoped rules are ignored here — the
 * adapters apply those at the block level via {@link lineClassFor}.
 *
 * Matching the earliest span and advancing past it (rather than running each
 * pattern's `replace` independently) is what prevents a later pattern from
 * matching text already claimed by an earlier one — e.g. dialogue `"…"` matching
 * the quoted `class="…"` attribute of a span an earlier pattern inserted.
 *
 * This is the single implementation of the walk that previously lived twice
 * (`processRoleplayText` in MessageContent and the inner loop of
 * `applyRoleplayPatterns` on the server).
 */
export function tokenizeInline(text: string, rules: CompiledRule[]): Segment[] {
  const inlineRules = rules.filter((r) => r.scope === 'inline')
  const segments: Segment[] = []
  let remaining = text

  while (remaining.length > 0) {
    let earliest: { index: number; length: number; className: string; text: string } | null = null

    // Find the earliest match among all inline rules.
    for (const rule of inlineRules) {
      const match = remaining.match(rule.regex)
      if (match && match.index !== undefined) {
        if (!earliest || match.index < earliest.index) {
          earliest = {
            index: match.index,
            length: match[0].length,
            className: rule.className,
            text: match[0],
          }
        }
      }
    }

    if (earliest) {
      if (earliest.index > 0) {
        segments.push({ text: remaining.substring(0, earliest.index) })
      }
      segments.push({ text: earliest.text, className: earliest.className })
      remaining = remaining.substring(earliest.index + earliest.length)
    } else {
      segments.push({ text: remaining })
      break
    }
  }

  return segments
}

// ============================================================================
// LINE-SCOPED CLASSES (whole-block styling)
// ============================================================================

/**
 * If the whole block of `text` is a single line matching a LINE-scoped rule,
 * return that rule's className. Mirrors how dialogue detection tags a `<p>` from
 * its plain text: the class lands on the block element, not an inline span.
 *
 * The rule's regex is matched against the trimmed block with any multiline flag
 * removed, so it only matches when the ENTIRE block is one matching line. A
 * mixed-content paragraph is left to inline styling / unstyled — authors put a
 * line-prefixed or tag-prefixed line on its own line. Returns `undefined` if
 * nothing matches.
 */
export function lineClassFor(text: string, rules: CompiledRule[]): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  for (const rule of rules) {
    if (rule.scope !== 'line') continue
    // Strip the multiline flag so `^…$` anchor to the whole block, not a sub-line.
    const flags = rule.regex.flags.replace('m', '').replace('g', '')
    const anchored = new RegExp(rule.regex.source, flags)
    const m = trimmed.match(anchored)
    if (m && m.index === 0 && m[0].length === trimmed.length) {
      return rule.className
    }
  }
  return undefined
}

// ============================================================================
// DIALOGUE DETECTION (shared predicate)
// ============================================================================

/**
 * Check whether text content represents dialogue based on configured detection:
 * it starts with an opening quote char and ends with a closing quote char.
 */
export function isDialogueParagraph(text: string, detection: DialogueDetection): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  const firstChar = trimmed[0]
  const lastChar = trimmed[trimmed.length - 1]

  return detection.openingChars.includes(firstChar) && detection.closingChars.includes(lastChar)
}

// ============================================================================
// HTML EMIT (server adapter helper)
// ============================================================================

/**
 * Serialize segments to an HTML string. Matched segments are wrapped in
 * `<span class="…">`; the text is inserted as-is (the server feeds this
 * already-HTML-stringified text from between tags, so it is already escaped —
 * re-escaping here would double-encode entities).
 */
export function segmentsToHtml(segments: Segment[]): string {
  let out = ''
  for (const seg of segments) {
    out += seg.className ? `<span class="${seg.className}">${seg.text}</span>` : seg.text
  }
  return out
}

// ============================================================================
// MARKDOWN ESCAPING (shared verbatim by both renderers)
// ============================================================================

/**
 * Escape markdown syntax characters inside roleplay brackets to prevent the
 * markdown parser from breaking up the segments before they can be styled.
 * This handles cases like `[narration with *emphasis* inside]`.
 *
 * IMPORTANT: preserves fenced code blocks (``` ``` ```) unchanged to avoid
 * corrupting code content with escape sequences.
 */
export function escapeMarkdownInBrackets(content: string, patterns: RenderingPattern[]): string {
  // Characters that trigger markdown parsing
  const markdownChars = /([*_~`])/g

  // Check if patterns include bracket-style narration [...]
  const hasBracketNarration = patterns.some((p) => p.pattern.includes('\\['))
  // Check if patterns include brace-style monologue {...}
  const hasBraceMonologue = patterns.some((p) => p.pattern.includes('\\{'))
  // Check if patterns include single-asterisk narration *...*
  const hasAsteriskNarration = patterns.some(
    (p) => p.pattern.includes('\\*') && p.className === 'qt-chat-narration',
  )

  // If no relevant patterns, return content unchanged
  if (!hasBracketNarration && !hasBraceMonologue && !hasAsteriskNarration) {
    return content
  }

  // Split content by fenced code blocks to preserve them unchanged.
  // Match ``` optionally followed by language, then content, then closing ```
  const codeBlockRegex = /(```[\s\S]*?```)/g
  const parts = content.split(codeBlockRegex)

  // Process only non-code-block parts
  const processedParts = parts.map((part, index) => {
    // Odd indices are code blocks (captured groups from split)
    if (index % 2 === 1) {
      return part // Return code blocks unchanged
    }

    let result = part

    // Escape inside [...] if bracket narration is in patterns
    if (hasBracketNarration) {
      result = result.replace(/\[([^\]]+)\](?!\()/g, (_match, inner) => {
        const escaped = inner.replace(markdownChars, '\\$1')
        return `[${escaped}]`
      })
    }

    // Escape inside {...} if brace monologue is in patterns.
    // Excludes {{template}} variables using lookbehind/lookahead.
    if (hasBraceMonologue) {
      result = result.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (_match, inner) => {
        const escaped = inner.replace(markdownChars, '\\$1')
        return `{${escaped}}`
      })
    }

    // Escape inside *...* if single asterisks are used for narration.
    // Be careful not to double-escape or break bold **...**.
    if (hasAsteriskNarration) {
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, inner) => {
        const escaped = inner.replace(/([_~`])/g, '\\$1')
        return `*${escaped}*`
      })
    }

    return result
  })

  return processedParts.join('')
}
