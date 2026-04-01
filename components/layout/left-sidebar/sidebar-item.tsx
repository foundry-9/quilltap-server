'use client'

/**
 * Sidebar Item
 *
 * Navigation item for the left sidebar.
 *
 * @module components/layout/left-sidebar/sidebar-item
 */

import Link from 'next/link'
import { ReactNode, MouseEvent } from 'react'

interface SidebarItemProps {
  /** Item label */
  label: string
  /** Icon element */
  icon?: ReactNode
  /** Link href (if item is a link) */
  href?: string
  /** Click handler (if item is a button) */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Whether this item is currently active */
  active?: boolean
  /** Additional class names */
  className?: string
}

export function SidebarItem({
  label,
  icon,
  href,
  onClick,
  active = false,
  className = '',
}: SidebarItemProps) {
  const itemClasses = [
    'qt-left-sidebar-item',
    active && 'qt-left-sidebar-item-active',
    className,
  ].filter(Boolean).join(' ')

  const content = (
    <>
      {icon && <span className="qt-left-sidebar-item-icon">{icon}</span>}
      <span className="qt-left-sidebar-item-label">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={itemClasses}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={itemClasses}>
      {content}
    </button>
  )
}

/**
 * View All link for section footers
 */
interface ViewAllLinkProps {
  href: string
  label?: string
}

export function ViewAllLink({ href, label = 'View all' }: ViewAllLinkProps) {
  return (
    <Link href={href} className="qt-left-sidebar-view-all">
      {label} &rarr;
    </Link>
  )
}
