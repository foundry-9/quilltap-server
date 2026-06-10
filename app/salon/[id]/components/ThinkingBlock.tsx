'use client'

import MessageContent from '@/components/chat/MessageContent'
import { Icon } from '@/components/ui/icon'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface ThinkingBlockProps {
  /** The reasoning ("thinking") text to display. DISPLAY ONLY. */
  content: string
  /** Start collapsed (the global `thinkingDisplay.defaultCollapsed` default).
   *  Ignored while streaming, where the block is always open so the user can
   *  watch the model think. */
  collapsedByDefault?: boolean
  /** True while the reasoning is still streaming in — forces the block open and
   *  marks the label as in-progress. */
  streaming?: boolean
  /** Roleplay rendering patterns, threaded through so the reasoning's Markdown
   *  renders consistently with the surrounding prose. */
  renderingPatterns?: RenderingPattern[]
  /** Dialogue detection for paragraph-level styling. */
  dialogueDetection?: DialogueDetection | null
}

/**
 * A collapsible, dimmed, italic block showing a thinking model's
 * chain-of-thought, offset to the right to read as "temporary reasoning, not
 * the final answer." The body renders through the shared Markdown renderer
 * (`MessageContent`) so lists, emphasis, and code in the reasoning display
 * properly. Theme-aware via the `qt-chat-thinking-*` tokens (which fall back to
 * the silent-message tokens). DISPLAY ONLY — never fed back to any model.
 */
export function ThinkingBlock({
  content,
  collapsedByDefault = true,
  streaming = false,
  renderingPatterns,
  dialogueDetection,
}: ThinkingBlockProps) {
  if (!content || content.trim().length === 0) return null

  return (
    <div className="qt-chat-thinking">
      <details className="qt-chat-thinking-details group" open={streaming || !collapsedByDefault}>
        <summary className="qt-chat-thinking-summary">
          <Icon
            name="chevron-right"
            className="qt-chat-thinking-chevron transition-transform group-open:rotate-90"
          />
          <span className="qt-chat-thinking-label">{streaming ? 'Thinking…' : 'Thinking'}</span>
        </summary>
        <div className="qt-chat-thinking-body">
          <MessageContent
            content={content}
            renderingPatterns={renderingPatterns}
            dialogueDetection={dialogueDetection}
          />
        </div>
      </details>
    </div>
  )
}
