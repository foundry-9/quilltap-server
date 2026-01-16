'use client'

/**
 * User Menu Item Component
 *
 * A reusable menu item for the user dropdown with:
 * - Responsive icon/text behavior
 * - Optional submenu support with left-positioned flyout
 * - Active state styling
 *
 * @module components/dashboard/nav-user-menu-item
 */

import { ReactNode, useState, useRef, useEffect } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'

export interface NavUserMenuItemProps {
  /** Icon element to display */
  icon: ReactNode
  /** Full label text (shown at >= 640px) */
  label: string
  /** Short label text (shown at 480-639px), defaults to label */
  shortLabel?: string
  /** Click handler for simple items (not submenu triggers) */
  onClick?: () => void
  /** Whether this item has a submenu */
  hasSubmenu?: boolean
  /** Submenu content to render in flyout */
  submenuContent?: ReactNode
  /** Whether item is in active/selected state */
  isActive?: boolean
  /** Whether item is disabled */
  disabled?: boolean
  /** Test ID for testing */
  testId?: string
}

/**
 * Chevron icon pointing left (for submenu indicator)
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

export function NavUserMenuItem({
  icon,
  label,
  shortLabel,
  onClick,
  hasSubmenu = false,
  submenuContent,
  isActive = false,
  disabled = false,
  testId,
}: NavUserMenuItemProps) {
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Close submenu when clicking outside or pressing escape
  useClickOutside(itemRef, () => setIsSubmenuOpen(false), {
    enabled: isSubmenuOpen,
    onEscape: () => setIsSubmenuOpen(false),
  })

  const handleClick = () => {
    if (disabled) return

    if (hasSubmenu) {
      setIsSubmenuOpen(!isSubmenuOpen)
    } else if (onClick) {
      onClick()
    }
  }

  const handleMouseEnter = () => {
    if (hasSubmenu && !disabled) {
      // Clear any pending close timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      // Open submenu with slight delay for better UX
      hoverTimeoutRef.current = setTimeout(() => {
        setIsSubmenuOpen(true)
      }, 150)
    }
  }

  const handleMouseLeave = () => {
    if (hasSubmenu) {
      // Clear any pending open timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      // Close submenu with delay to allow moving to submenu
      hoverTimeoutRef.current = setTimeout(() => {
        setIsSubmenuOpen(false)
      }, 300)
    }
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const displayShortLabel = shortLabel ?? label

  return (
    <div
      ref={itemRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`
          qt-navbar-submenu-item
          ${isActive ? 'qt-navbar-submenu-item-active' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
        aria-haspopup={hasSubmenu ? 'menu' : undefined}
      >
        <span className="qt-navbar-menu-item-content">
          <span className="qt-navbar-menu-item-icon">{icon}</span>
          {/* Full label - shown at sm (640px+) */}
          <span className="qt-navbar-menu-item-label-full">{label}</span>
          {/* Short label - shown at 480-639px */}
          <span className="qt-navbar-menu-item-label-short">{displayShortLabel}</span>
        </span>

        {hasSubmenu && (
          <ChevronLeftIcon className="qt-navbar-submenu-arrow" />
        )}
      </button>

      {/* Submenu flyout */}
      {hasSubmenu && isSubmenuOpen && submenuContent && (
        <div className="qt-navbar-submenu">
          {submenuContent}
        </div>
      )}
    </div>
  )
}
