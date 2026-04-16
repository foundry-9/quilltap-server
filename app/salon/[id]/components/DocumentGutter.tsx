'use client'

/**
 * DocumentGutter - Margin gutter for the Document Mode editor
 *
 * Displays change markers (thin colored bars) beside changed lines and
 * an attention (eye) icon at the pixel offset where doc_focus last pointed.
 * This is a presentational component; all state is passed in as props.
 *
 * Scriptorium Phase 3.6
 *
 * @module app/salon/[id]/components/DocumentGutter
 */

import { useMemo } from 'react'

export interface LinePosition {
  /** Block index (0-based) */
  index: number
  /** Top offset in pixels relative to the scroll container's content */
  top: number
  /** Height of the block element in pixels */
  height: number
}

interface DocumentGutterProps {
  changedLines: Set<number>
  /** Pixel offset from content top where the AI attention eye should sit; null when unset */
  attentionTop: number | null
  linePositions: LinePosition[]
  /** Total content height to match editor height */
  totalHeight: number
}

export default function DocumentGutter({
  changedLines,
  attentionTop,
  linePositions,
  totalHeight,
}: DocumentGutterProps) {
  const markers = useMemo(() => {
    return linePositions
      .filter((pos) => changedLines.has(pos.index))
      .map((pos) => (
        <div
          key={`change-${pos.index}`}
          className="qt-doc-gutter-change"
          style={{ top: pos.top, height: pos.height }}
        />
      ))
  }, [changedLines, linePositions])

  const attentionMarker = useMemo(() => {
    if (attentionTop === null) return null
    return (
      <div
        className="qt-doc-gutter-eye"
        style={{ top: attentionTop }}
        aria-label="AI attention"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      </div>
    )
  }, [attentionTop])

  return (
    <div className="qt-doc-gutter" style={{ height: totalHeight }}>
      {markers}
      {attentionMarker}
    </div>
  )
}
