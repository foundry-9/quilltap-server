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

import { useCallback, useRef, useState, type ReactNode } from 'react'
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

  // Normal mode: just render chat content at full width
  if (mode === 'normal' || !rightPane) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {chatContent}
      </div>
    )
  }

  // Focus mode: right pane fills the main area, chat hidden
  if (mode === 'focus') {
    return (
      <div className="qt-doc-focus-mode flex flex-col h-full overflow-hidden">
        {rightPane}
      </div>
    )
  }

  // Split mode: chat + divider + right pane
  const splitPos = isDragging ? currentPosition : dividerPosition

  return (
    <div ref={containerRef} className="qt-doc-split-layout">
      {/* Chat pane */}
      <div
        className="qt-doc-chat-pane"
        style={{ width: `${splitPos}%` }}
      >
        {chatContent}
      </div>

      {/* Draggable divider */}
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

      {/* Right pane (document, terminal, or both stacked) */}
      <div
        className="qt-doc-pane"
        style={{ width: `${100 - splitPos}%` }}
      >
        {rightPane}
      </div>
    </div>
  )
}
