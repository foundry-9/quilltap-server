'use client'

/**
 * RightPaneVerticalSplit
 *
 * Renders the right-pane content of the salon split layout when both Document
 * Mode and Terminal Mode are active. Top child is the document pane, bottom is
 * the terminal pane, with a draggable horizontal divider between them.
 *
 * Shares SplitLayout's drag/keyboard logic (useResizableDivider) on the height axis.
 */

import { type ReactNode } from 'react'
import { useResizableDivider } from './useResizableDivider'

const MIN_PANE_PX = 200
const ABSOLUTE_MIN_PCT = 20
const ABSOLUTE_MAX_PCT = 80
const VERTICAL_BOUNDS = { min: ABSOLUTE_MIN_PCT, max: ABSOLUTE_MAX_PCT }

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
  const { containerRef, isDragging, splitPos, handleMouseDown, handleKeyDown } = useResizableDivider({
    axis: 'y',
    position,
    onPositionChange,
    clamp: clampPercentage,
    bounds: VERTICAL_BOUNDS,
  })

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
