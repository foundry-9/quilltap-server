'use client'

/**
 * Profile Menu
 *
 * User profile dropdown for the sidebar footer.
 *
 * @module components/layout/left-sidebar/profile-menu
 */

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/providers/session-provider'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useClickOutside } from '@/hooks/useClickOutside'

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
 * Sign out icon
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
 * Info/About icon
 */
function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

/**
 * Chevron up icon
 */
function ChevronUpIcon({ className }: { className?: string }) {
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
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

export function ProfileMenu() {
  const { data: session } = useSession()
  const { isCollapsed, closeMobile, isMobile } = useSidebar()
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [authDisabled, setAuthDisabled] = useState(false)

  const user = session?.user

  // Check if auth is disabled
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

  // Close menu when clicking outside
  useClickOutside(menuRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  })

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  const handleProfileClick = () => {
    setIsOpen(false)
    if (isMobile) closeMobile()
    router.push('/profile')
  }

  const handleAboutClick = () => {
    setIsOpen(false)
    if (isMobile) closeMobile()
    router.push('/about')
  }

  const handleSignOut = async () => {
    setIsOpen(false)
    if (isMobile) closeMobile()
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      console.error('Sign out failed', error)
    }
    // Force a full page reload to clear all React state and session data
    // Using window.location.href instead of router.push ensures:
    // - All React state is cleared
    // - SessionProvider re-initializes from scratch
    // - No stale UI elements remain (sidebar, etc.)
    window.location.href = '/'
  }

  if (!user) {
    return null
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile trigger */}
      <button
        type="button"
        onClick={handleToggle}
        className="qt-left-sidebar-profile w-full"
        title={isCollapsed ? 'Profile' : undefined}
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || 'User'}
            className="qt-left-sidebar-profile-avatar object-cover"
          />
        ) : (
          <div className="qt-left-sidebar-profile-avatar flex items-center justify-center">
            <ProfileIcon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}

        {!isCollapsed && (
          <>
            <div className="qt-left-sidebar-profile-info">
              <span className="qt-left-sidebar-profile-name">{user.name || 'User'}</span>
              <span className="qt-left-sidebar-profile-email">{user.email}</span>
            </div>
            <ChevronUpIcon className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${isOpen ? '' : 'rotate-180'}`} />
          </>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className={`absolute bottom-full mb-2 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 ${isCollapsed ? 'left-0 w-48' : 'left-0 right-0'}`}>
          <div className="p-2 space-y-1">
            {/* Profile link */}
            <button
              type="button"
              onClick={handleProfileClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              <ProfileIcon className="w-4 h-4" />
              Profile
            </button>

            {/* About link */}
            <button
              type="button"
              onClick={handleAboutClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              <InfoIcon className="w-4 h-4" />
              About
            </button>

            {/* Divider */}
            {!authDisabled && <div className="border-t border-border my-1" />}

            {/* Sign out */}
            {!authDisabled && (
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
              >
                <SignOutIcon className="w-4 h-4" />
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
