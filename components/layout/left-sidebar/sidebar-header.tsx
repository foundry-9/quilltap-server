'use client'

/**
 * Sidebar Header
 *
 * Header area with brand logo and collapse toggle button.
 * Shows just the quill icon when collapsed, full logo when expanded.
 *
 * @module components/layout/left-sidebar/sidebar-header
 */

import Link from 'next/link'
import Image from 'next/image'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { BrandLogo } from '@/components/ui/brand-logo'

/**
 * Chevron left icon (for collapsing)
 */
function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

/**
 * Chevron right icon (for expanding)
 */
function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function SidebarHeader() {
  const { isCollapsed, toggleCollapse } = useSidebar()

  const brandLink = (
    <Link href="/" className="qt-left-sidebar-brand" title="Home">
      {isCollapsed ? (
        <Image
          src="/quill.svg"
          alt="Quilltap"
          width={24}
          height={24}
          className="qt-left-sidebar-brand-icon"
          aria-hidden="true"
        />
      ) : (
        <BrandLogo size="sm" />
      )}
    </Link>
  )

  const toggleButton = (
    <button
      type="button"
      onClick={toggleCollapse}
      className="qt-left-sidebar-toggle"
      title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!isCollapsed}
    >
      {isCollapsed ? (
        <ChevronRightIcon className="w-5 h-5" />
      ) : (
        <ChevronLeftIcon className="w-5 h-5" />
      )}
    </button>
  )

  return (
    <div className="qt-left-sidebar-header">
      {/* When collapsed: toggle first, then brand. When expanded: brand first, then toggle */}
      {isCollapsed ? (
        <>
          {toggleButton}
          {brandLink}
        </>
      ) : (
        <>
          {brandLink}
          {toggleButton}
        </>
      )}
    </div>
  )
}
