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

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import RightPaneVerticalSplit from './RightPaneVerticalSplit'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(dividerPosition)

  // Track position during drag without persisting until mouseup
  const positionRef = useRef(dividerPosition)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    positionRef.current = dividerPosition
    setCurrentPosition(dividerPosition)
    setIsDragging(true)

    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const containerWidth = containerRect.width

    const onMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - containerRect.left
      const percentage = (relativeX / containerWidth) * 100

      positionRef.current = clampDividerPosition(percentage, containerWidth)
      setCurrentPosition(positionRef.current)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
      onDividerPositionChange(positionRef.current)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [dividerPosition, onDividerPositionChange])

  const handleDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'split') {
      return
    }

    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0
    const basePosition = isDragging ? currentPosition : dividerPosition
    let nextPosition: number | null = null

    switch (event.key) {
      case 'ArrowLeft':
        nextPosition = basePosition - 5
        break
      case 'ArrowRight':
        nextPosition = basePosition + 5
        break
      case 'Home':
        nextPosition = 20
        break
      case 'End':
        nextPosition = 80
        break
      default:
        return
    }

    event.preventDefault()
    const clamped = clampDividerPosition(nextPosition, containerWidth)
    positionRef.current = clamped
    setCurrentPosition(clamped)
    onDividerPositionChange(clamped)
  }, [mode, isDragging, currentPosition, dividerPosition, onDividerPositionChange])

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
  const splitPos = isDragging ? currentPosition : dividerPosition

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
