'use client'

/**
 * CollapsibleCard
 *
 * A card with a clickable header that toggles visibility of its children.
 * Uses qt-collapsible-card CSS classes for theming.
 *
 * Supports deep-linking via `sectionId` (sets the element id) and `forceOpen`
 * (opens the card and scrolls it into view on first render or transition).
 *
 * @module components/ui/CollapsibleCard
 */

import { useRef, useEffect, useCallback, useSyncExternalStore, type ReactNode } from 'react'

interface CollapsibleCardProps {
  title: string
  description?: string
  icon?: ReactNode
  defaultOpen?: boolean
  /** Stable, URL-friendly identifier — rendered as the element's id attribute */
  sectionId?: string
  /** When true, forces the card open and scrolls it into view (one-shot per transition) */
  forceOpen?: boolean
  children: ReactNode
}

/**
 * A simple ref-based store to track open/closed state without triggering
 * the lint rule about setState in effects. We use useSyncExternalStore
 * to subscribe to changes.
 */
function useOpenState(defaultOpen: boolean) {
  const stateRef = useRef(defaultOpen)
  const listenersRef = useRef(new Set<() => void>())

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const getSnapshot = useCallback(() => stateRef.current, [])

  const isOpen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setOpen = useCallback((value: boolean) => {
    if (stateRef.current !== value) {
      stateRef.current = value
      listenersRef.current.forEach(l => l())
    }
  }, [])

  const toggle = useCallback(() => {
    stateRef.current = !stateRef.current
    listenersRef.current.forEach(l => l())
  }, [])

  return { isOpen, setOpen, toggle }
}

export function CollapsibleCard({
  title,
  description,
  icon,
  defaultOpen = false,
  sectionId,
  forceOpen = false,
  children,
}: CollapsibleCardProps) {
  const { isOpen, setOpen, toggle } = useOpenState(defaultOpen || forceOpen)
  const cardRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  // When forceOpen activates, open the card and scroll to it
  useEffect(() => {
    if (forceOpen) {
      setOpen(true)
      if (!hasScrolledRef.current) {
        hasScrolledRef.current = true
        requestAnimationFrame(() => {
          cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    } else {
      hasScrolledRef.current = false
    }
  }, [forceOpen, setOpen])

  return (
    <div className="qt-collapsible-card" id={sectionId} ref={cardRef}>
      <button
        type="button"
        className="qt-collapsible-card-header"
        onClick={toggle}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && <span className="qt-collapsible-card-icon">{icon}</span>}
          <div className="min-w-0">
            <h3 className="qt-card-title">{title}</h3>
            {description && <p className="qt-card-description">{description}</p>}
          </div>
        </div>
        <svg
          className={`qt-collapsible-card-chevron ${isOpen ? 'qt-collapsible-card-chevron-open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div className="qt-collapsible-card-divider" />
          <div className="qt-collapsible-card-body">
            {children}
          </div>
        </>
      )}
    </div>
  )
}
