'use client'

/**
 * Sidebar Section
 *
 * Reusable section container for the left sidebar.
 *
 * @module components/layout/left-sidebar/sidebar-section
 */

import { ReactNode } from 'react'

interface SidebarSectionProps {
  /** Section title */
  title: string
  /** Section content */
  children: ReactNode
  /** Whether this is a placeholder section (coming soon) */
  placeholder?: boolean
  /** Whether this section should grow to fill available space */
  grow?: boolean
  /** Additional class names */
  className?: string
}

export function SidebarSection({
  title,
  children,
  placeholder = false,
  grow = false,
  className = '',
}: SidebarSectionProps) {
  const sectionClasses = [
    'qt-left-sidebar-section',
    placeholder && 'qt-left-sidebar-section-placeholder',
    grow && 'qt-left-sidebar-section-grow',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={sectionClasses}>
      <h3 className="qt-left-sidebar-section-title">{title}</h3>
      <div className="qt-left-sidebar-items">
        {children}
      </div>
    </div>
  )
}
