'use client'

/**
 * User Menu Component
 *
 * Dropdown menu for user-related actions including:
 * - User info display
 * - Theme selection (submenu)
 * - Quick-hide tag management (submenu)
 * - Sign out
 *
 * @module components/dashboard/nav-user-menu
 */

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/theme-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { NavUserMenuItem } from './nav-user-menu-item'
import { NavUserMenuThemeContent, ThemeIcon } from './nav-user-menu-theme'
import { NavUserMenuQuickHideContent, QuickHideIcon } from './nav-user-menu-quick-hide'
import { useClickOutside } from '@/hooks/useClickOutside'

interface NavUserMenuProps {
  user: {
    name?: string | null
    email?: string
    image?: string | null
  }
}

/**
 * User profile icon
 */
function ProfileIcon({ className }: { className?: string }) {
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
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
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

export function NavUserMenu({ user }: NavUserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [authDisabled, setAuthDisabled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const { showNavThemeSelector } = useTheme()
  const { quickHideTags, hiddenTagIds } = useQuickHide()

  const hasAnyHidden = hiddenTagIds.size > 0
  const hasQuickHideTags = quickHideTags.length > 0

  // Check if auth is disabled (no point showing sign out if auto-logged in)
  useEffect(() => {
    fetch('/api/v1/auth/status')
      .then(res => res.json())
      .then(data => {
        if (data.authDisabled) {
          setAuthDisabled(true)
        }
      })
      .catch(() => {
        // Ignore errors, default to showing sign out
      })
  }, [])

  // Close menu when clicking outside or pressing escape
  useClickOutside(menuRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  })

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  const handleProfileClick = () => {
    setIsOpen(false)
    router.push('/profile')
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      router.push('/')
    } catch (error) {
      console.error('Sign out failed', error)
      // Still redirect even if logout fails - cookie will expire anyway
      router.push('/')
    }
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
          // Using img instead of Image because the avatar comes from /api/files
          // which requires auth cookies that Next.js Image optimization can't include
           
          <img
            src={user.image}
            alt={user.name || 'User'}
            className="h-8 w-8 rounded-full object-cover"
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

            {/* Profile link */}
            <NavUserMenuItem
              icon={<ProfileIcon className="w-4 h-4" />}
              label="Profile"
              onClick={handleProfileClick}
              testId="user-menu-profile"
            />

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

            {/* Show divider before sign out (Profile is always above, so always show when sign out is shown) */}
            {!authDisabled && (
              <div className="qt-navbar-dropdown-divider" />
            )}

            {/* Sign Out - hidden when AUTH_DISABLED since user is auto-logged in */}
            {!authDisabled && (
              <NavUserMenuItem
                icon={<SignOutIcon className="w-4 h-4" />}
                label="Sign Out"
                onClick={handleSignOut}
                testId="user-menu-sign-out"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
