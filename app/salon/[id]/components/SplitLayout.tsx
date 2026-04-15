'use client'

/**
 * SplitLayout - Resizable two-pane layout for Document Mode
 *
 * Wraps the chat main area and provides three layout states:
 * - normal: chat fills the full width (no document pane)
 * - split: chat + draggable divider + document pane
 * - focus: document pane fills the full width (chat hidden)
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/SplitLayout
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'

interface SplitLayoutProps {
  /** Current layout mode */
  mode: 'normal' | 'split' | 'focus'
  /** Divider position as percentage of container width (20-80) */
  dividerPosition: number
  /** Callback when divider position changes (on drag end) */
  onDividerPositionChange: (position: number) => void
  /** Chat content (message list + composer) */
  chatContent: ReactNode
  /** Document pane content (editor, header, status bar) */
  documentContent: ReactNode | null
}

export default function SplitLayout({
  mode,
  dividerPosition,
  onDividerPositionChange,
  chatContent,
  documentContent,
}: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(dividerPosition)

  // Track position during drag without persisting until mouseup
  const positionRef = useRef(dividerPosition)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)

    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const containerWidth = containerRect.width

    const onMouseMove = (moveEvent: MouseEvent) => {
      const relativeX = moveEvent.clientX - containerRect.left
      let percentage = (relativeX / containerWidth) * 100

      // Enforce minimum widths: 320px for chat, 360px for document
      const minChatPercent = (320 / containerWidth) * 100
      const maxChatPercent = 100 - (360 / containerWidth) * 100

      percentage = Math.max(minChatPercent, Math.min(maxChatPercent, percentage))
      // Clamp to 20-80 range as well
      percentage = Math.max(20, Math.min(80, percentage))

      positionRef.current = Math.round(percentage)
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
  }, [onDividerPositionChange])

  // Normal mode: just render chat content at full width
  if (mode === 'normal' || !documentContent) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {chatContent}
      </div>
    )
  }

  // Focus mode: document fills the main area, chat hidden
  if (mode === 'focus') {
    return (
      <div className="qt-doc-focus-mode flex flex-col h-full overflow-hidden">
        {documentContent}
      </div>
    )
  }

  // Split mode: chat + divider + document
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
        aria-orientation="vertical"
        aria-valuenow={splitPos}
        aria-valuemin={20}
        aria-valuemax={80}
        tabIndex={0}
      >
        <div className="qt-doc-divider-grip">
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* Document pane */}
      <div
        className="qt-doc-pane"
        style={{ width: `${100 - splitPos}%` }}
      >
        {documentContent}
      </div>
    </div>
  )
}
