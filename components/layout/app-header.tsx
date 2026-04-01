'use client'

/**
 * App Header
 *
 * Simplified header with logo, centered search bar, and action buttons.
 * Used in the new app layout.
 *
 * @module components/layout/app-header
 */

import Link from 'next/link'
import { useEffect } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { NavContentWidthToggle } from '@/components/dashboard/nav-content-width-toggle'
import { useSidebarOptional } from '@/components/providers/sidebar-provider'
import { BrandLogo } from '@/components/ui/brand-logo'
import { clientLogger } from '@/lib/client-logger'

/**
 * Hamburger menu icon
 */
function HamburgerIcon({ className }: { className?: string }) {
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
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export function AppHeader() {
  const sidebar = useSidebarOptional()

  useEffect(() => {
    clientLogger.debug('AppHeader mounted')
  }, [])

  const handleHamburgerClick = () => {
    if (sidebar) {
      sidebar.openMobile()
      clientLogger.debug('Hamburger menu clicked, opening mobile sidebar')
    }
  }

  return (
    <header className="qt-app-header">
      {/* Left section: hamburger (mobile) + logo */}
      <div className="qt-app-header-left">
        {/* Hamburger menu - mobile only */}
        <button
          type="button"
          onClick={handleHamburgerClick}
          className="qt-hamburger"
          aria-label="Open menu"
        >
          <HamburgerIcon className="w-6 h-6" />
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity">
          <BrandLogo size="sm" />
        </Link>
      </div>

      {/* Center section: search bar */}
      <div className="qt-app-header-center">
        <SearchBar />
      </div>

      {/* Right section: actions */}
      <div className="qt-app-header-right">
        <NavContentWidthToggle />
      </div>
    </header>
  )
}
