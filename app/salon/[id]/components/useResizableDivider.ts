'use client'

/**
 * useResizableDivider — the drag and keyboard behaviour of the Salon's pane
 * dividers: the chat / right-pane split ({@link SplitLayout}, horizontal) and
 * the document / terminal split ({@link RightPaneVerticalSplit}, vertical).
 *
 * The position is a percentage of the container along the axis. While a drag
 * runs it is held locally and handed up once, on mouse-up; a key press (arrows
 * by 5, Home and End to the bounds) hands it up at once. Every value passes
 * through the caller's `clamp`, which knows the pane minimums.
 *
 * @module app/salon/[id]/components/useResizableDivider
 */

import { useCallback, useRef, useState } from 'react'

const KEY_STEP = 5

export interface ResizableDividerOptions {
  /** `x` for a column divider (left/right), `y` for a row divider (top/bottom). */
  axis: 'x' | 'y'
  /** The committed position, as a percentage of the container. */
  position: number
  /** Called with the clamped position at drag end and on each key press. */
  onPositionChange: (position: number) => void
  /** Clamp a raw percentage against the container's length along the axis (0 when unmeasured). */
  clamp: (rawPercentage: number, containerLength: number) => number
  /** Where Home and End send the divider (before clamping). */
  bounds: { min: number; max: number }
  /** When false the divider ignores keys. */
  keyboardEnabled?: boolean
}

export function useResizableDivider({
  axis,
  position,
  onPositionChange,
  clamp,
  bounds,
  keyboardEnabled = true,
}: ResizableDividerOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(position)
  // Track position during drag without persisting until mouseup
  const positionRef = useRef(position)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    positionRef.current = position
    setCurrentPosition(position)
    setIsDragging(true)

    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const length = axis === 'x' ? rect.width : rect.height
    const origin = axis === 'x' ? rect.left : rect.top

    const onMouseMove = (moveEvent: MouseEvent) => {
      const offset = (axis === 'x' ? moveEvent.clientX : moveEvent.clientY) - origin
      positionRef.current = clamp((offset / length) * 100, length)
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
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [axis, position, clamp, onPositionChange])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardEnabled) return

    const rect = containerRef.current?.getBoundingClientRect()
    const length = (axis === 'x' ? rect?.width : rect?.height) ?? 0
    const basePosition = isDragging ? currentPosition : position
    const decreaseKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const increaseKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    let nextPosition: number

    switch (event.key) {
      case decreaseKey:
        nextPosition = basePosition - KEY_STEP
        break
      case increaseKey:
        nextPosition = basePosition + KEY_STEP
        break
      case 'Home':
        nextPosition = bounds.min
        break
      case 'End':
        nextPosition = bounds.max
        break
      default:
        return
    }

    event.preventDefault()
    const clamped = clamp(nextPosition, length)
    positionRef.current = clamped
    setCurrentPosition(clamped)
    onPositionChange(clamped)
  }, [axis, keyboardEnabled, isDragging, currentPosition, position, bounds.min, bounds.max, clamp, onPositionChange])

  return {
    containerRef,
    isDragging,
    /** The position to draw: the live drag value while dragging, else the committed one. */
    splitPos: isDragging ? currentPosition : position,
    handleMouseDown,
    handleKeyDown,
  }
}
