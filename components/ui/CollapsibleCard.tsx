'use client'

/**
 * CollapsibleCard
 *
 * A card with a clickable header that toggles visibility of its children.
 * Uses qt-collapsible-card CSS classes for theming.
 *
 * @module components/ui/CollapsibleCard
 */

import { useState, type ReactNode } from 'react'

interface CollapsibleCardProps {
  title: string
  description?: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleCard({
  title,
  description,
  icon,
  defaultOpen = false,
  children,
}: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="qt-collapsible-card">
      <button
        type="button"
        className="qt-collapsible-card-header"
        onClick={() => setIsOpen(prev => !prev)}
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
