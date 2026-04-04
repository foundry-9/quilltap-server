'use client'

/**
 * Sidebar Section
 *
 * Reusable section container for the left sidebar.
 * Supports collapsible behavior with persisted state.
 *
 * @module components/layout/left-sidebar/sidebar-section
 */

import { ReactNode } from 'react'
import { useSidebar } from '@/components/providers/sidebar-provider'

/**
 * Chevron icon for collapse toggle
 */
function ChevronIcon({ className, rotated }: { className?: string; rotated?: boolean }) {
  return (
    <svg
      className={`${className || ''} transition-transform duration-200 ${rotated ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

interface SidebarSectionProps {
  /** Unique section identifier for collapse state persistence */
  id?: string
  /** Section title */
  title: string
  /** Section content */
  children: ReactNode
  /** Whether this section can be collapsed (default: true) */
  collapsible?: boolean
  /** Whether this is a placeholder section (coming soon) */
  placeholder?: boolean
  /** Whether this section should grow to fill available space */
  grow?: boolean
  /** Additional class names */
  className?: string
}

export function SidebarSection({
  id,
  title,
  children,
  collapsible = true,
  placeholder = false,
  grow = false,
  className = '',
}: SidebarSectionProps) {
  const { isCollapsed: sidebarCollapsed, sectionCollapsed, toggleSectionCollapsed } = useSidebar()

  // Section is collapsed if it has an id, is collapsible, and the state says so
  const isSectionCollapsed = id && collapsible && sectionCollapsed[id]

  // Don't show collapse toggle when sidebar is collapsed (narrow mode)
  const showCollapseToggle = id && collapsible && !sidebarCollapsed && !placeholder && !grow

  const handleToggle = () => {
    if (id && collapsible) {
      toggleSectionCollapsed(id)
    }
  }

  const sectionClasses = [
    'qt-left-sidebar-section',
    placeholder && 'qt-left-sidebar-section-placeholder',
    grow && 'qt-left-sidebar-section-grow',
    isSectionCollapsed && 'qt-left-sidebar-section-collapsed',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={sectionClasses}>
      <div
        className={`qt-left-sidebar-section-header ${showCollapseToggle ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={showCollapseToggle ? handleToggle : undefined}
        role={showCollapseToggle ? 'button' : undefined}
        tabIndex={showCollapseToggle ? 0 : undefined}
        onKeyDown={showCollapseToggle ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle() } } : undefined}
        aria-expanded={showCollapseToggle ? !isSectionCollapsed : undefined}
      >
        <h3 className="qt-left-sidebar-section-title">{title}</h3>
        {showCollapseToggle && (
          <ChevronIcon
            className="w-3 h-3 qt-text-secondary flex-shrink-0"
            rotated={!isSectionCollapsed}
          />
        )}
      </div>
      <div className="qt-left-sidebar-section-content">
        <div className="qt-left-sidebar-items">
          {children}
        </div>
      </div>
    </div>
  )
}
