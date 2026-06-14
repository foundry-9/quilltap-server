/**
 * Formatting Annotations for Chat Composer
 *
 * Provides utilities for inserting Markdown and roleplay template
 * formatting into the chat textarea.
 *
 * @module lib/chat/annotations
 */

import type { TemplateDelimiter, AnnotationButton, RenderingPattern, NarrationDelimiters, DelimiterAddOns } from '@/lib/schemas/template.types'
import { DEFAULT_TAG_TOKEN_PATTERN } from '@/lib/schemas/template.types'
import { escapeRegex } from '@/lib/utils/regex'

// Re-export for convenience
export type { TemplateDelimiter, AnnotationButton }

// ============================================================================
// MARKDOWN FORMAT CONFIGURATION
// ============================================================================

/**
 * Configuration for a Markdown formatting button
 */
export interface MarkdownFormatConfig {
  /** Label displayed on button (e.g., "B", "I", "H1") */
  label: string
  /** Tooltip text for the button */
  tooltip: string
  /** Unique type identifier */
  type: 'bold' | 'italic' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote'
  /** Opening marker */
  prefix: string
  /** Closing marker (empty for line-start formats) */
  suffix: string
  /** Whether this format needs to be at the start of a line */
  lineStart?: boolean
}

/**
 * Standard Markdown formatting buttons
 */
export const MARKDOWN_FORMATS: MarkdownFormatConfig[] = [
  { label: 'B', tooltip: 'Bold', type: 'bold', prefix: '**', suffix: '**' },
  { label: 'I', tooltip: 'Italic', type: 'italic', prefix: '_', suffix: '_' },
  { label: 'H1', tooltip: 'Heading 1', type: 'h1', prefix: '# ', suffix: '', lineStart: true },
  { label: 'H2', tooltip: 'Heading 2', type: 'h2', prefix: '## ', suffix: '', lineStart: true },
  { label: 'H3', tooltip: 'Heading 3', type: 'h3', prefix: '### ', suffix: '', lineStart: true },
  { label: 'H4', tooltip: 'Heading 4', type: 'h4', prefix: '#### ', suffix: '', lineStart: true },
  { label: 'H5', tooltip: 'Heading 5', type: 'h5', prefix: '##### ', suffix: '', lineStart: true },
  { label: 'H6', tooltip: 'Heading 6', type: 'h6', prefix: '###### ', suffix: '', lineStart: true },
  { label: '• …', tooltip: 'Unordered List', type: 'ul', prefix: '- ', suffix: '', lineStart: true },
  { label: '1. …', tooltip: 'Ordered List', type: 'ol', prefix: '1. ', suffix: '', lineStart: true },
  { label: '\u201C', tooltip: 'Blockquote', type: 'blockquote', prefix: '> ', suffix: '', lineStart: true },
]

// ============================================================================
// DELIMITER UTILITIES
// ============================================================================

/**
 * Convert a TemplateDelimiter to prefix/suffix form for text insertion / tooltips.
 * - `wrap` → its open/close (string ⇒ same on both sides; tuple ⇒ [open, close]).
 * - `linePrefix` → { prefix: marker, suffix: '' }.
 * - `tagPrefix` → { prefix: open, suffix: close }.
 */
export function delimiterToPrefixSuffix(delimiter: TemplateDelimiter): { prefix: string; suffix: string } {
  switch (delimiter.kind) {
    case 'linePrefix':
      return { prefix: delimiter.marker, suffix: '' }
    case 'tagPrefix':
      return { prefix: delimiter.open, suffix: delimiter.close }
    case 'wrap':
    default:
      if (typeof delimiter.delimiters === 'string') {
        return { prefix: delimiter.delimiters, suffix: delimiter.delimiters }
      }
      return { prefix: delimiter.delimiters[0], suffix: delimiter.delimiters[1] }
  }
}

// ============================================================================
// ADD-ON CLASS COMPOSITION
// ============================================================================

/**
 * Map a delimiter's {@link DelimiterAddOns} to the `.qt-rp-*` utility classes that
 * implement them. Composed onto the base `style` class in {@link generateRenderingPatterns}
 * so the renderers stay add-on-agnostic — `RenderingPattern.className` is emitted
 * verbatim into `class="…"` and tolerates a space-separated list.
 */
export function addOnClassesFor(addOns?: DelimiterAddOns): string[] {
  if (!addOns) return []
  const classes: string[] = []
  if (addOns.bold) classes.push('qt-rp-bold')
  if (addOns.italic) classes.push('qt-rp-italic')
  if (addOns.reverse) classes.push('qt-rp-reverse')
  if (addOns.underline === 'single') classes.push('qt-rp-underline')
  else if (addOns.underline === 'double') classes.push('qt-rp-underline-double')
  if (addOns.border === 'solid') classes.push('qt-rp-border')
  else if (addOns.border === 'dashed') classes.push('qt-rp-border-dashed')
  if (addOns.font) classes.push(`qt-rp-font-${addOns.font}`)
  return classes
}

/** Compose a delimiter's base style class with its add-on classes. */
function composeClassName(delimiter: TemplateDelimiter): string {
  return [delimiter.style, ...addOnClassesFor(delimiter.addOns)].join(' ')
}

// ============================================================================
// RENDERING PATTERN AUTO-GENERATION
// ============================================================================

/**
 * Auto-generate rendering patterns from template delimiters and narration delimiters.
 *
 * For each delimiter entry, builds a regex that matches text enclosed in those
 * delimiters and applies the entry's CSS style class. Also generates a pattern
 * for narrationDelimiters if not already covered by a delimiter entry.
 *
 * This is used as a default when a template doesn't have explicit renderingPatterns.
 */
export function generateRenderingPatterns(
  delimiters: TemplateDelimiter[],
  narrationDelimiters?: NarrationDelimiters
): RenderingPattern[] {
  const patterns: RenderingPattern[] = []
  const seen = new Set<string>()

  for (const d of delimiters) {
    const { prefix, suffix } = delimiterToPrefixSuffix(d)
    // Include kind in the dedupe key: a `wrap` [ … ] and a `tagPrefix` [ … ] are
    // distinct rules that happen to share the same prefix/suffix.
    const key = `${d.kind}|${prefix}|${suffix}`
    if (seen.has(key)) continue
    seen.add(key)

    const pattern = buildDelimiterPattern(d)
    if (pattern) {
      patterns.push({
        pattern: pattern.regex,
        className: composeClassName(d),
        ...(pattern.flags ? { flags: pattern.flags } : {}),
        ...(pattern.scope === 'line' ? { scope: 'line' as const } : {}),
        ...(d.hideDelimiter ? { hideDelimiters: true } : {}),
      })
    }
  }

  // Add narration delimiters if not already covered. Narration is always a
  // wrap-style (inline) rule.
  if (narrationDelimiters) {
    const narPrefix = Array.isArray(narrationDelimiters) ? narrationDelimiters[0] : narrationDelimiters
    const narSuffix = Array.isArray(narrationDelimiters) ? narrationDelimiters[1] : narrationDelimiters
    const key = `wrap|${narPrefix}|${narSuffix}`
    if (!seen.has(key)) {
      const pattern = buildWrapPattern(narPrefix, narSuffix)
      if (pattern) {
        patterns.push({
          pattern: pattern.regex,
          className: 'qt-chat-narration',
          ...(pattern.flags ? { flags: pattern.flags } : {}),
        })
      }
    }
  }

  return patterns
}

/** A compiled-pattern descriptor: regex source, optional flags, and render scope. */
interface BuiltPattern {
  regex: string
  flags?: string
  scope: 'inline' | 'line'
}

/**
 * Build a regex pattern for a delimiter, dispatching by kind. Returns null if
 * the delimiter can't form a meaningful pattern.
 *
 * - `wrap` → inline open/close span (see {@link buildWrapPattern}).
 * - `linePrefix` → whole-line marker match (`^marker.+$`, multiline, scope line).
 * - `tagPrefix` → whole-line bracketed-token match (`^open(token)close.*$`,
 *   multiline + unicode, scope line).
 */
function buildDelimiterPattern(delimiter: TemplateDelimiter): BuiltPattern | null {
  switch (delimiter.kind) {
    case 'linePrefix': {
      if (!delimiter.marker) return null
      // Group `rpBody` = the line body after the marker, kept when hiding.
      return { regex: `^${escapeRegex(delimiter.marker)}(?<rpBody>.+)$`, flags: 'm', scope: 'line' }
    }
    case 'tagPrefix': {
      if (!delimiter.open || !delimiter.close) return null
      const token = delimiter.tokenPattern && delimiter.tokenPattern.trim()
        ? delimiter.tokenPattern
        : DEFAULT_TAG_TOKEN_PATTERN
      // Token stays non-capturing; group `rpBody` = the body after the [TAG],
      // kept when hiding. A user token with its own groups can't shift `rpBody`.
      return {
        regex: `^${escapeRegex(delimiter.open)}(?:${token})${escapeRegex(delimiter.close)}(?<rpBody>.*)$`,
        flags: 'mu',
        scope: 'line',
      }
    }
    case 'wrap':
    default: {
      const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
      return buildWrapPattern(prefix, suffix)
    }
  }
}

/**
 * Build an inline wrap regex for a prefix/suffix pair.
 * Returns null if the pair is empty. Scope is always `inline`.
 *
 * The inner content is captured in the named group `rpBody` so the renderer can
 * emit just the content (dropping the delimiters) when a delimiter opts into hide.
 */
function buildWrapPattern(prefix: string, suffix: string): BuiltPattern | null {
  if (!prefix && !suffix) return null

  // Defensive: a wrap with an empty suffix degrades to a line-start prefix.
  // (The migration reclassifies such legacy entries to `linePrefix`.)
  if (prefix && !suffix) {
    return { regex: `^${escapeRegex(prefix)}(?<rpBody>.+)$`, flags: 'm', scope: 'inline' }
  }

  const escapedPrefix = escapeRegex(prefix)
  const escapedSuffix = escapeRegex(suffix)

  if (prefix === suffix) {
    // Same open/close delimiter (e.g., * or +)
    // Match: delimiter + one or more non-delimiter chars + delimiter
    // Avoid matching doubled delimiters (like ** for bold)
    return {
      regex: `(?<!${escapedPrefix})${escapedPrefix}(?<rpBody>[^${escapedPrefix}]+)${escapedSuffix}(?!${escapedSuffix})`,
      scope: 'inline',
    }
  }

  // Different open/close (e.g., [ ] or { })
  // Match: open + one or more non-close chars + close
  // For square brackets, exclude markdown links by adding (?!\()
  const linkExclusion = suffix === ']' ? '(?!\\()' : ''
  return {
    regex: `${escapedPrefix}(?<rpBody>[^${escapedSuffix}]+)${escapedSuffix}${linkExclusion}`,
    scope: 'inline',
  }
}

/**
 * Generate a tooltip for a template delimiter
 *
 * @param delimiter - The template delimiter configuration
 * @returns Tooltip text showing name and delimiter syntax
 */
export function getDelimiterTooltip(delimiter: TemplateDelimiter): string {
  switch (delimiter.kind) {
    case 'linePrefix':
      return `${delimiter.name} (${delimiter.marker}…EOL)`
    case 'tagPrefix':
      return `${delimiter.name} (${delimiter.open}TOKEN${delimiter.close} at line start)`
    case 'wrap':
    default: {
      const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
      const suffixText = suffix || 'EOL'
      return `${delimiter.name} (${prefix}...${suffixText})`
    }
  }
}

