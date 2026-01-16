'use client'

/**
 * useSidebarResize Hook
 *
 * Manages drag-to-resize behavior for the left sidebar.
 * Uses mousedown/mousemove/mouseup events to track drag state
 * and updates sidebar width via the sidebar context.
 *
 * @module hooks/useSidebarResize
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSidebar, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from '@/components/providers/sidebar-provider'

interface UseSidebarResizeReturn {
  /** Ref to attach to the resize handle element */
  handleRef: React.RefObject<HTMLDivElement | null>
  /** Whether a resize operation is currently in progress */
  isResizing: boolean
  /** Start resize operation (attach to handle's onMouseDown) */
  startResize: (e: React.MouseEvent) => void
}

export function useSidebarResize(): UseSidebarResizeReturn {
  const { width, setWidth, isCollapsed, isMobile } = useSidebar()
  const handleRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)

  const startResize = useCallback((e: React.MouseEvent) => {
    // Don't resize when collapsed or on mobile
    if (isCollapsed || isMobile) return

    e.preventDefault()
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width

    // Add resizing class to body to prevent text selection
    document.body.classList.add('qt-left-sidebar-resizing')
  }, [isCollapsed, isMobile, width])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidthRef.current + deltaX)
      )
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.classList.remove('qt-left-sidebar-resizing')
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove('qt-left-sidebar-resizing')
    }
  }, [isResizing, setWidth, width])

  return {
    handleRef,
    isResizing,
    startResize,
  }
}
