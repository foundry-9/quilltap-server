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
import { Icon } from '@/components/ui/icon'

interface CollapsibleCardProps {
  title: string
  description?: string
  icon?: ReactNode
  defaultOpen?: boolean
  /** Stable, URL-friendly identifier — rendered as the element's id attribute */
  sectionId?: string
  /** When true, forces the card open and scrolls it into view (one-shot per transition) */
  forceOpen?: boolean
  /**
   * Controlled-mode open state. When provided, the card uses this as the source
   * of truth and ignores its internal store. Pair with `onOpenChange` so the
   * parent can drive single-open accordion behavior.
   */
  isOpen?: boolean
  /** Controlled-mode setter. Called with the next desired open state. */
  onOpenChange?: (open: boolean) => void
  /** A small element shown before the title (the settings page's persona badge). */
  badge?: ReactNode
  /** Terms to mark (`<mark>`) in the title and description, case- and accent-insensitively. */
  highlight?: readonly string[]
  children: ReactNode
}

function foldChar(ch: string): string {
  return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Wrap every occurrence of any of `terms` in `<mark>`. Matching folds case and
 * diacritics per character, so offsets in the folded text line up with the
 * original (a precomposed letter folds to one character).
 */
export function highlightText(text: string, terms: readonly string[] | undefined): ReactNode {
  const needles = (terms ?? []).map((t) => t.trim()).filter(Boolean).map((t) => Array.from(t).map(foldChar).join(''))
  if (needles.length === 0 || !text) return text
  const chars = Array.from(text)
  const folded = chars.map(foldChar)
  const marked = new Array<boolean>(chars.length).fill(false)
  for (let i = 0; i < chars.length; i++) {
    for (const needle of needles) {
      const len = Array.from(needle).length
      if (folded.slice(i, i + len).join('') === needle) {
        for (let j = i; j < i + len; j++) marked[j] = true
      }
    }
  }
  const out: ReactNode[] = []
  let run = ''
  let runMarked = marked[0]
  const flush = (key: number) => {
    if (!run) return
    out.push(runMarked ? <mark key={key}>{run}</mark> : run)
    run = ''
  }
  chars.forEach((ch, i) => {
    if (marked[i] !== runMarked) {
      flush(i)
      runMarked = marked[i]
    }
    run += ch
  })
  flush(chars.length)
  return out
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
  isOpen: controlledIsOpen,
  onOpenChange,
  badge,
  highlight,
  children,
}: CollapsibleCardProps) {
  const { isOpen: uncontrolledIsOpen, setOpen, toggle } = useOpenState(defaultOpen || forceOpen)
  const cardRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  const isControlled = controlledIsOpen !== undefined
  const isOpen = isControlled ? controlledIsOpen : uncontrolledIsOpen

  const handleHeaderClick = useCallback(() => {
    if (isControlled) {
      onOpenChange?.(!controlledIsOpen)
    } else {
      toggle()
    }
  }, [isControlled, controlledIsOpen, onOpenChange, toggle])

  // When forceOpen activates, open the card and scroll to it. In controlled
  // mode the parent owns open state, so we only notify via onOpenChange.
  useEffect(() => {
    if (forceOpen) {
      if (isControlled) {
        if (!controlledIsOpen) onOpenChange?.(true)
      } else {
        setOpen(true)
      }
      if (!hasScrolledRef.current) {
        hasScrolledRef.current = true
        requestAnimationFrame(() => {
          cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    } else {
      hasScrolledRef.current = false
    }
  }, [forceOpen, isControlled, controlledIsOpen, onOpenChange, setOpen])

  return (
    <div className="qt-collapsible-card" id={sectionId} ref={cardRef}>
      <button
        type="button"
        className="qt-collapsible-card-header"
        onClick={handleHeaderClick}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && <span className="qt-collapsible-card-icon">{icon}</span>}
          {badge}
          <div className="min-w-0">
            <h3 className="qt-card-title">{highlightText(title, highlight)}</h3>
            {description && <p className="qt-card-description">{highlightText(description, highlight)}</p>}
          </div>
        </div>
        <Icon
          name="chevron-down"
          className={`qt-collapsible-card-chevron ${isOpen ? 'qt-collapsible-card-chevron-open' : ''}`}
        />
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
