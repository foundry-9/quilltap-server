'use client'

/**
 * SplitLayout - resizable two-pane layout for the salon's Document Mode and
 * Terminal Mode (collectively the "right pane").
 *
 * Layout states (combined across Document + Terminal modes):
 * - normal: chat fills the full width.
 * - split:  chat on the left, right pane on the right (with a draggable divider
 *           between them). The right pane may host the document, the terminal,
 *           or both — when both are present they are stacked top/bottom with a
 *           horizontal divider (RightPaneVerticalSplit).
 * - focus:  the right pane fills the full width and the chat is hidden.
 *
 * @module app/salon/[id]/components/SplitLayout
 */

import { type CSSProperties, type ReactNode } from 'react'
import RightPaneVerticalSplit from './RightPaneVerticalSplit'
import { useResizableDivider } from './useResizableDivider'

interface SplitLayoutProps {
  /** Combined mode derived from documentMode + terminalMode. */
  mode: 'normal' | 'split' | 'focus'
  /** Horizontal divider position as percentage of container width (20-80) */
  dividerPosition: number
  /** Callback when the horizontal divider position changes (on drag end) */
  onDividerPositionChange: (position: number) => void
  /** Vertical divider position (%) for the right pane when both panes are present */
  rightPaneVerticalSplit: number
  onRightPaneVerticalSplitChange: (position: number) => void
  /** Chat content (message list + composer) */
  chatContent: ReactNode
  /** Document pane content. Null when Document Mode is off. */
  documentContent: ReactNode | null
  /** Terminal pane content. Null when Terminal Mode is off. */
  terminalContent: ReactNode | null
}

const DIVIDER_BOUNDS = { min: 20, max: 80 }

function clampDividerPosition(rawPercentage: number, containerWidth: number): number {
  if (containerWidth <= 0) {
    return Math.max(20, Math.min(80, Math.round(rawPercentage)))
  }

  const minChatPercent = (320 / containerWidth) * 100
  const maxChatPercent = 100 - (360 / containerWidth) * 100
  const clamped = Math.max(minChatPercent, Math.min(maxChatPercent, rawPercentage))

  return Math.max(20, Math.min(80, Math.round(clamped)))
}

export default function SplitLayout({
  mode,
  dividerPosition,
  onDividerPositionChange,
  rightPaneVerticalSplit,
  onRightPaneVerticalSplitChange,
  chatContent,
  documentContent,
  terminalContent,
}: SplitLayoutProps) {
  const { containerRef, isDragging, splitPos, handleMouseDown, handleKeyDown: handleDividerKeyDown } = useResizableDivider({
    axis: 'x',
    position: dividerPosition,
    onPositionChange: onDividerPositionChange,
    clamp: clampDividerPosition,
    bounds: DIVIDER_BOUNDS,
    keyboardEnabled: mode === 'split',
  })

  const rightPane: ReactNode = (() => {
    if (documentContent && terminalContent) {
      return (
        <RightPaneVerticalSplit
          position={rightPaneVerticalSplit}
          onPositionChange={onRightPaneVerticalSplitChange}
          topContent={documentContent}
          bottomContent={terminalContent}
        />
      )
    }
    return documentContent ?? terminalContent ?? null
  })()

  // With no right pane there's nothing to split or focus, so the chat fills the
  // width regardless of the requested mode (e.g. Document Mode is "split" but the
  // active document hasn't loaded yet).
  const layoutMode: 'normal' | 'split' | 'focus' = rightPane ? mode : 'normal'

  // The chat pane — and therefore the Lexical composer inside it — must stay
  // mounted in a stable position across every mode change. Unmounting it (as the
  // old per-mode return branches did) destroys the composer's in-memory editor
  // state, so any text the user had typed vanished the moment Document Mode (or
  // Terminal Mode, or a focus toggle) opened. We keep one structure and vary only
  // the chat pane's width/visibility.
  const chatPaneStyle: CSSProperties =
    layoutMode === 'split'
      ? { width: `${splitPos}%` }
      : layoutMode === 'focus'
        ? { display: 'none' }
        : { flex: 1, minWidth: 0 } // normal: fill the available width

  return (
    <div
      ref={containerRef}
      className={`qt-doc-split-layout${layoutMode === 'focus' ? ' qt-doc-focus-mode' : ''}`}
    >
      {/* Chat pane — always mounted to preserve composer/editor state */}
      <div className="qt-doc-chat-pane" style={chatPaneStyle}>
        {chatContent}
      </div>

      {/* Draggable divider — split mode only */}
      {layoutMode === 'split' && (
        <div
          className={`qt-doc-divider ${isDragging ? 'qt-doc-divider-active' : ''}`}
          onMouseDown={handleMouseDown}
          role="separator"
          aria-label="Resize chat and right pane"
          aria-orientation="vertical"
          aria-valuenow={splitPos}
          aria-valuemin={20}
          aria-valuemax={80}
          tabIndex={0}
          onKeyDown={handleDividerKeyDown}
        >
          <div className="qt-doc-divider-grip">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {/* Right pane (document, terminal, or both stacked) */}
      {layoutMode === 'split' && (
        <div className="qt-doc-pane" style={{ width: `${100 - splitPos}%` }}>
          {rightPane}
        </div>
      )}
      {layoutMode === 'focus' && (
        <div className="flex flex-col h-full overflow-hidden flex-1 min-w-0">
          {rightPane}
        </div>
      )}
    </div>
  )
}
