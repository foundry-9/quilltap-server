'use client'

/**
 * RightPaneVerticalSplit
 *
 * Renders the right-pane content of the salon split layout when both Document
 * Mode and Terminal Mode are active. Top child is the document pane, bottom is
 * the terminal pane, with a draggable horizontal divider between them.
 *
 * Mirrors SplitLayout's drag/keyboard logic on the height axis instead of width.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'

const MIN_PANE_PX = 200
const ABSOLUTE_MIN_PCT = 20
const ABSOLUTE_MAX_PCT = 80

interface RightPaneVerticalSplitProps {
  /** Top pane height as a percentage of the right-pane height (20-80). */
  position: number
  /** Called on drag-end with the new clamped position. */
  onPositionChange: (position: number) => void
  topContent: ReactNode
  bottomContent: ReactNode
}

function clampPercentage(rawPercentage: number, containerHeight: number): number {
  if (containerHeight <= 0) {
    return Math.max(ABSOLUTE_MIN_PCT, Math.min(ABSOLUTE_MAX_PCT, Math.round(rawPercentage)))
  }
  const minTopPct = (MIN_PANE_PX / containerHeight) * 100
  const maxTopPct = 100 - (MIN_PANE_PX / containerHeight) * 100
  const lower = Math.max(ABSOLUTE_MIN_PCT, minTopPct)
  const upper = Math.min(ABSOLUTE_MAX_PCT, maxTopPct)
  const clamped = Math.max(lower, Math.min(upper, rawPercentage))
  return Math.round(clamped)
}

export default function RightPaneVerticalSplit({
  position,
  onPositionChange,
  topContent,
  bottomContent,
}: RightPaneVerticalSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(position)
  const positionRef = useRef(position)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    positionRef.current = position
    setCurrentPosition(position)
    setIsDragging(true)

    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const containerHeight = containerRect.height

    const onMouseMove = (moveEvent: MouseEvent) => {
      const relativeY = moveEvent.clientY - containerRect.top
      const percentage = (relativeY / containerHeight) * 100
      positionRef.current = clampPercentage(percentage, containerHeight)
      setCurrentPosition(positionRef.current)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
      onPositionChange(positionRef.current)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [position, onPositionChange])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0
    const basePosition = isDragging ? currentPosition : position
    let nextPosition: number | null = null

    switch (event.key) {
      case 'ArrowUp':
        nextPosition = basePosition - 5
        break
      case 'ArrowDown':
        nextPosition = basePosition + 5
        break
      case 'Home':
        nextPosition = ABSOLUTE_MIN_PCT
        break
      case 'End':
        nextPosition = ABSOLUTE_MAX_PCT
        break
      default:
        return
    }

    event.preventDefault()
    const clamped = clampPercentage(nextPosition, containerHeight)
    positionRef.current = clamped
    setCurrentPosition(clamped)
    onPositionChange(clamped)
  }, [isDragging, currentPosition, position, onPositionChange])

  const splitPos = isDragging ? currentPosition : position

  return (
    <div ref={containerRef} className="qt-doc-vertical-split-layout">
      <div className="qt-doc-vertical-pane qt-doc-vertical-pane-top" style={{ height: `${splitPos}%` }}>
        {topContent}
      </div>

      <div
        className={`qt-doc-vertical-divider ${isDragging ? 'qt-doc-vertical-divider-active' : ''}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-label="Resize document and terminal panes"
        aria-orientation="horizontal"
        aria-valuenow={splitPos}
        aria-valuemin={ABSOLUTE_MIN_PCT}
        aria-valuemax={ABSOLUTE_MAX_PCT}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="qt-doc-vertical-divider-grip">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="qt-doc-vertical-pane qt-doc-vertical-pane-bottom" style={{ height: `${100 - splitPos}%` }}>
        {bottomContent}
      </div>
    </div>
  )
}
