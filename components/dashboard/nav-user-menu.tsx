'use client'

/**
 * User Menu Component
 *
 * Dropdown menu for user-related actions including:
 * - User info display
 * - Theme selection (submenu)
 * - Quick-hide tag management (submenu)
 * - DevConsole toggle (dev mode only)
 * - Sign out
 *
 * @module components/dashboard/nav-user-menu
 */

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { signOut } from 'next-auth/react'
import { useTheme } from '@/components/providers/theme-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useDevConsoleOptional } from '@/components/providers/dev-console-provider'
import { NavUserMenuItem } from './nav-user-menu-item'
import { NavUserMenuThemeContent, ThemeIcon } from './nav-user-menu-theme'
import { NavUserMenuQuickHideContent, QuickHideIcon } from './nav-user-menu-quick-hide'
import { clientLogger } from '@/lib/client-logger'
import { useClickOutside } from '@/hooks/useClickOutside'

interface NavUserMenuProps {
  user: {
    name?: string | null
    email?: string
    image?: string | null
  }
}

/**
 * Sign out icon (door with arrow)
 */
function SignOutIcon({ className }: { className?: string }) {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

/**
 * Wrench/tool icon for DevConsole menu item
 */
function DevConsoleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 -0.5 17 17"
      fill="currentColor"
    >
      <path
        d="M15.732,2.509 L13.495,0.274 C13.064,-0.159 12.346,-0.141 11.892,0.312 C11.848,0.356 11.817,0.411 11.8,0.471 C11.241,2.706 11.253,3.487 11.346,3.794 L5.081,10.059 L3.162,8.142 L0.872,10.432 C0.123,11.18 -0.503,13.91 0.795,15.207 C2.092,16.504 4.819,15.875 5.566,15.128 L7.86,12.836 L5.981,10.958 L12.265,4.675 C12.607,4.752 13.423,4.732 15.535,4.205 C15.595,4.188 15.65,4.158 15.694,4.114 C16.147,3.661 16.163,2.941 15.732,2.509 L15.732,2.509 Z M15.15,3.459 C14.047,3.77 12.765,4.046 12.481,3.992 L12.046,3.557 C11.984,3.291 12.262,1.996 12.576,0.886 C12.757,0.752 12.989,0.748 13.129,0.888 L15.147,2.906 C15.285,3.045 15.281,3.277 15.15,3.459 L15.15,3.459 Z"
      />
    </svg>
  )
}

export function NavUserMenu({ user }: NavUserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { showNavThemeSelector } = useTheme()
  const { quickHideTags, hiddenTagIds } = useQuickHide()
  const devConsole = useDevConsoleOptional()

  const hasAnyHidden = hiddenTagIds.size > 0
  const hasQuickHideTags = quickHideTags.length > 0

  // Close menu when clicking outside or pressing escape
  useClickOutside(menuRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  })

  const handleToggle = () => {
    clientLogger.debug('User menu toggle', { wasOpen: isOpen })
    setIsOpen(!isOpen)
  }

  const handleDevConsoleClick = () => {
    if (devConsole) {
      clientLogger.debug('DevConsole toggle from user menu', { wasOpen: devConsole.isOpen })
      devConsole.togglePanel()
      setIsOpen(false)
    }
  }

  const handleSignOut = () => {
    clientLogger.info('User signing out from user menu')
    signOut({ callbackUrl: '/' })
  }

  const handleThemeSelected = () => {
    // Close the main menu after theme selection
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger button */}
      <button
        onClick={handleToggle}
        className="qt-button qt-navbar-button"
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name || 'User'}
            width={32}
            height={32}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <span className="text-sm qt-text-primary">
            {user.name || user.email || 'User'}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="qt-navbar-dropdown">
          <div className="qt-navbar-dropdown-section space-y-2">
            {/* User Info */}
            <div className="qt-navbar-dropdown-header">
              <p className="text-sm qt-text-primary">{user.name}</p>
              <p className="qt-text-xs">{user.email}</p>
            </div>

            {/* Divider */}
            <div className="qt-navbar-dropdown-divider" />

            {/* Theme selector (shown when enabled in settings) */}
            {showNavThemeSelector && (
              <NavUserMenuItem
                icon={<ThemeIcon className="w-4 h-4" />}
                label="Theme"
                hasSubmenu
                submenuContent={<NavUserMenuThemeContent onThemeSelected={handleThemeSelected} />}
                testId="user-menu-theme"
              />
            )}

            {/* Quick-hide (shown when there are quick-hide tags) */}
            {hasQuickHideTags && (
              <NavUserMenuItem
                icon={<QuickHideIcon hasHidden={hasAnyHidden} className="w-4 h-4" />}
                label={hasAnyHidden ? 'Show' : 'Hide'}
                hasSubmenu
                submenuContent={<NavUserMenuQuickHideContent />}
                isActive={hasAnyHidden}
                testId="user-menu-quick-hide"
              />
            )}

            {/* DevConsole (shown in development only) */}
            {devConsole && (
              <NavUserMenuItem
                icon={<DevConsoleIcon className="w-4 h-4" />}
                label="Dev Console"
                shortLabel="DevConsole"
                onClick={handleDevConsoleClick}
                isActive={devConsole.isOpen}
                testId="user-menu-dev-console"
              />
            )}

            {/* Show divider before sign out if there were menu items above */}
            {(showNavThemeSelector || hasQuickHideTags || devConsole) && (
              <div className="qt-navbar-dropdown-divider" />
            )}

            {/* Sign Out */}
            <NavUserMenuItem
              icon={<SignOutIcon className="w-4 h-4" />}
              label="Sign Out"
              onClick={handleSignOut}
              testId="user-menu-sign-out"
            />
          </div>
        </div>
      )}
    </div>
  )
}
