'use client'

/**
 * FloatingDialog
 *
 * A floating, draggable, resizable dialog component rendered via portal.
 * Used for the help chat dialog. Persists position/size to localStorage.
 */

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DialogGeometry {
  x: number
  y: number
  width: number
  height: number
}

interface FloatingDialogProps {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  storageKey?: string
  initialGeometry?: Partial<DialogGeometry>
  onGeometryChange?: (geometry: DialogGeometry) => void
  minWidth?: number
  minHeight?: number
  headerActions?: ReactNode
}

const DEFAULT_GEOMETRY: DialogGeometry = {
  x: -1,  // -1 means "center on first render"
  y: -1,
  width: 420,
  height: 520,
}

function loadGeometry(storageKey: string, initial?: Partial<DialogGeometry>): DialogGeometry {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_GEOMETRY, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_GEOMETRY, ...initial }
}

function saveGeometry(storageKey: string, geometry: DialogGeometry): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(geometry))
  } catch { /* ignore */ }
}

function constrainToViewport(geo: DialogGeometry, minW: number, minH: number): DialogGeometry {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(minW, Math.min(geo.width, vw - 20))
  const h = Math.max(minH, Math.min(geo.height, vh - 20))
  let x = geo.x
  let y = geo.y

  // Center if -1
  if (x < 0) x = Math.max(10, (vw - w) / 2)
  if (y < 0) y = Math.max(10, (vh - h) / 2)

  // Constrain
  x = Math.max(0, Math.min(x, vw - 40))
  y = Math.max(0, Math.min(y, vh - 40))

  return { x, y, width: w, height: h }
}

export function FloatingDialog({
  isOpen,
  onClose,
  title,
  children,
  storageKey = 'quilltap:help-dialog-geometry',
  initialGeometry,
  onGeometryChange,
  minWidth = 320,
  minHeight = 300,
  headerActions,
}: FloatingDialogProps) {
  const [geometry, setGeometry] = useState<DialogGeometry>(() =>
    constrainToViewport(loadGeometry(storageKey, initialGeometry), minWidth, minHeight)
  )
  const dialogRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  // Update geometry and persist
  const updateGeometry = useCallback((newGeo: DialogGeometry) => {
    const constrained = constrainToViewport(newGeo, minWidth, minHeight)
    setGeometry(constrained)
    saveGeometry(storageKey, constrained)
    onGeometryChange?.(constrained)
  }, [storageKey, minWidth, minHeight, onGeometryChange])

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from title bar, not buttons
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    isDragging.current = true
    dragOffset.current = {
      x: e.clientX - geometry.x,
      y: e.clientY - geometry.y,
    }
  }, [geometry.x, geometry.y])

  // Handle drag
  useEffect(() => {
    if (!isOpen) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      updateGeometry({ ...geometry, x: newX, y: newY })
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isOpen, geometry, updateGeometry])

  // Track resize via ResizeObserver
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return
    const el = dialogRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (Math.abs(width - geometry.width) > 2 || Math.abs(height - geometry.height) > 2) {
          updateGeometry({ ...geometry, width, height })
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [isOpen, geometry, updateGeometry])

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      ref={dialogRef}
      className="qt-floating-dialog"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        minWidth,
        minHeight,
      }}
    >
      <div
        className="qt-floating-dialog-header"
        onMouseDown={handleMouseDown}
      >
        <div className="qt-floating-dialog-title">
          {title}
        </div>
        <div className="qt-floating-dialog-actions">
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            className="qt-floating-dialog-close"
            title="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="qt-floating-dialog-body">
        {children}
      </div>
    </div>,
    document.body
  )
}
