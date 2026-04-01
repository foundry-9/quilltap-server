'use client'

import { useRef, useEffect, useCallback, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface SlideOverPanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
  className?: string
  ariaLabel?: string
  headerActions?: ReactNode
}

/**
 * A reusable slide-over panel that slides in from the right edge of the viewport.
 * Portal-based, matching BaseModal's rendering pattern.
 *
 * Uses qt-slide-over-overlay/qt-slide-over-panel/qt-slide-over-header CSS classes
 * for full theme compatibility.
 */
export function SlideOverPanel({
  isOpen,
  onClose,
  title,
  children,
  width = 'min(480px, 85vw)',
  className = '',
  ariaLabel,
  headerActions,
}: SlideOverPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Save and restore focus
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement
      // Focus the panel on open for keyboard accessibility
      requestAnimationFrame(() => {
        panelRef.current?.focus()
      })
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [isOpen])

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Click scrim to close
  const handleScrimClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  // Focus trap: cycle focus within the panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Scrim backdrop */}
      <div
        className="qt-slide-over-overlay"
        data-open={isOpen}
        onClick={handleScrimClick}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`qt-slide-over-panel ${className}`}
        data-open={isOpen}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="qt-slide-over-header">
          <h2 className="text-base font-semibold qt-text truncate">{title}</h2>
          <div className="flex items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label="Close panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {children}
      </div>
    </>,
    document.body
  )
}

export default SlideOverPanel
