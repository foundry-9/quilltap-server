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
import { SearchBar } from '@/components/search/search-bar'
import { NavContentWidthToggle } from '@/components/dashboard/nav-content-width-toggle'
import { BrandLogo } from '@/components/ui/brand-logo'

export function AppHeader() {
  return (
    <header className="qt-app-header">
      {/* Left section: logo */}
      <div className="qt-app-header-left">
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
