/**
 * Formatting Annotations for Chat Composer
 *
 * Provides utilities for inserting Markdown and roleplay template
 * formatting into the chat textarea.
 *
 * @module lib/chat/annotations
 */

import type { AnnotationButton } from '@/lib/schemas/template.types'

// Re-export for convenience
export type { AnnotationButton }

// ============================================================================
// MARKDOWN FORMAT CONFIGURATION
// ============================================================================

/**
 * Configuration for a Markdown formatting button
 */
export interface MarkdownFormatConfig {
  /** Label displayed on button (e.g., "B", "I", "H1") */
  label: string
  /** Unique type identifier */
  type: 'bold' | 'italic' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol'
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
  { label: 'B', type: 'bold', prefix: '**', suffix: '**' },
  { label: 'I', type: 'italic', prefix: '_', suffix: '_' },
  { label: 'H1', type: 'h1', prefix: '# ', suffix: '', lineStart: true },
  { label: 'H2', type: 'h2', prefix: '## ', suffix: '', lineStart: true },
  { label: 'H3', type: 'h3', prefix: '### ', suffix: '', lineStart: true },
  { label: 'UL', type: 'ul', prefix: '- ', suffix: '', lineStart: true },
  { label: 'OL', type: 'ol', prefix: '1. ', suffix: '', lineStart: true },
]

// ============================================================================
// FORMAT INSERTION UTILITIES
// ============================================================================

/**
 * Insert formatting around selected text or at cursor position
 *
 * Handles both inline formats (bold, italic) and line-start formats (headers, lists).
 * For inline formats, wraps selected text or inserts empty markers.
 * For line-start formats, ensures the prefix is at the beginning of the line.
 *
 * Note: This function directly manipulates textarea.value because the ChatComposer
 * uses an uncontrolled textarea (defaultValue) for performance. It then syncs
 * the parent state via setInput.
 *
 * @param textarea - The textarea element
 * @param _currentValue - DEPRECATED: We read from textarea.value directly
 * @param config - Format configuration (Markdown or AnnotationButton)
 * @param setInput - Function to update the parent state
 */
export function insertFormat(
  textarea: HTMLTextAreaElement,
  _currentValue: string,
  config: MarkdownFormatConfig | AnnotationButton,
  setInput: (value: string) => void
): void {
  // Read from textarea.value directly (uncontrolled component)
  const currentValue = textarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = currentValue.substring(start, end)

  let newValue: string
  let newCursorPos: number

  // Check if this is a line-start format (headers, lists)
  const isLineStart = 'lineStart' in config && config.lineStart

  if (isLineStart) {
    // For line-start formats, ensure we're at the start of a line
    const lineStart = currentValue.lastIndexOf('\n', start - 1) + 1
    const before = currentValue.substring(0, lineStart)
    const lineContent = selectedText || ''
    const after = currentValue.substring(end)

    newValue = before + config.prefix + lineContent + config.suffix + after
    newCursorPos = lineStart + config.prefix.length + lineContent.length
  } else {
    // For inline formats, wrap selected text or insert empty markers
    const before = currentValue.substring(0, start)
    const after = currentValue.substring(end)
    const wrapped = config.prefix + selectedText + config.suffix

    newValue = before + wrapped + after
    // If text was selected, place cursor after wrapped text
    // If no text selected, place cursor between prefix and suffix
    newCursorPos = selectedText
      ? start + wrapped.length
      : start + config.prefix.length
  }

  // Directly update the textarea DOM value (uncontrolled component)
  textarea.value = newValue

  // Sync parent state
  setInput(newValue)

  // Focus and set cursor position immediately
  textarea.focus()
  textarea.setSelectionRange(newCursorPos, newCursorPos)
}

/**
 * Generate a tooltip for an annotation button
 *
 * @param button - The annotation button configuration
 * @returns Tooltip text showing label and delimiter syntax
 */
export function getAnnotationTooltip(button: AnnotationButton): string {
  const suffixText = button.suffix || 'EOL'
  return `${button.label} (${button.prefix}...${suffixText})`
}
