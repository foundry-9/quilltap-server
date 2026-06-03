/**
 * Formatting Annotations for Chat Composer
 *
 * Provides utilities for inserting Markdown and roleplay template
 * formatting into the chat textarea.
 *
 * @module lib/chat/annotations
 */

import type { TemplateDelimiter, AnnotationButton, RenderingPattern, NarrationDelimiters } from '@/lib/schemas/template.types'
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
 * Convert a TemplateDelimiter to prefix/suffix format for text insertion
 */
export function delimiterToPrefixSuffix(delimiter: TemplateDelimiter): { prefix: string; suffix: string } {
  if (typeof delimiter.delimiters === 'string') {
    return { prefix: delimiter.delimiters, suffix: delimiter.delimiters }
  }
  return { prefix: delimiter.delimiters[0], suffix: delimiter.delimiters[1] }
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
    const key = `${prefix}|${suffix}`
    if (seen.has(key)) continue
    seen.add(key)

    const pattern = buildDelimiterPattern(prefix, suffix)
    if (pattern) {
      patterns.push({
        pattern: pattern.regex,
        className: d.style,
        ...(pattern.flags ? { flags: pattern.flags } : {}),
      })
    }
  }

  // Add narration delimiters if not already covered
  if (narrationDelimiters) {
    const narPrefix = Array.isArray(narrationDelimiters) ? narrationDelimiters[0] : narrationDelimiters
    const narSuffix = Array.isArray(narrationDelimiters) ? narrationDelimiters[1] : narrationDelimiters
    const key = `${narPrefix}|${narSuffix}`
    if (!seen.has(key)) {
      const pattern = buildDelimiterPattern(narPrefix, narSuffix)
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

/**
 * Build a regex pattern for a given prefix/suffix delimiter pair.
 * Returns null if the delimiter is empty or can't form a meaningful pattern.
 */
function buildDelimiterPattern(
  prefix: string,
  suffix: string
): { regex: string; flags?: string } | null {
  if (!prefix && !suffix) return null

  // Line-start prefix with no suffix (e.g., "// " for OOC)
  if (prefix && !suffix) {
    return {
      regex: `^${escapeRegex(prefix)}.+$`,
      flags: 'm',
    }
  }

  const escapedPrefix = escapeRegex(prefix)
  const escapedSuffix = escapeRegex(suffix)

  if (prefix === suffix) {
    // Same open/close delimiter (e.g., * or +)
    // Match: delimiter + one or more non-delimiter chars + delimiter
    // Avoid matching doubled delimiters (like ** for bold)
    return {
      regex: `(?<!${escapedPrefix})${escapedPrefix}[^${escapedPrefix}]+${escapedSuffix}(?!${escapedSuffix})`,
    }
  }

  // Different open/close (e.g., [ ] or { })
  // Match: open + one or more non-close chars + close
  // For square brackets, exclude markdown links by adding (?!\()
  const linkExclusion = suffix === ']' ? '(?!\\()' : ''
  return {
    regex: `${escapedPrefix}[^${escapedSuffix}]+${escapedSuffix}${linkExclusion}`,
  }
}

/**
 * Generate a tooltip for a template delimiter
 *
 * @param delimiter - The template delimiter configuration
 * @returns Tooltip text showing name and delimiter syntax
 */
export function getDelimiterTooltip(delimiter: TemplateDelimiter): string {
  const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
  const suffixText = suffix || 'EOL'
  return `${delimiter.name} (${prefix}...${suffixText})`
}

