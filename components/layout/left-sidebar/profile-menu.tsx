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
import { useDevConsoleOptional } from '@/components/providers/dev-console-provider'
import { useClickOutside } from '@/hooks/useClickOutside'
import { clientLogger } from '@/lib/client-logger'

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
 * DevConsole icon
 */
function DevConsoleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 -0.5 17 17"
      fill="currentColor"
    >
      <path d="M15.732,2.509 L13.495,0.274 C13.064,-0.159 12.346,-0.141 11.892,0.312 C11.848,0.356 11.817,0.411 11.8,0.471 C11.241,2.706 11.253,3.487 11.346,3.794 L5.081,10.059 L3.162,8.142 L0.872,10.432 C0.123,11.18 -0.503,13.91 0.795,15.207 C2.092,16.504 4.819,15.875 5.566,15.128 L7.86,12.836 L5.981,10.958 L12.265,4.675 C12.607,4.752 13.423,4.732 15.535,4.205 C15.595,4.188 15.65,4.158 15.694,4.114 C16.147,3.661 16.163,2.941 15.732,2.509 L15.732,2.509 Z M15.15,3.459 C14.047,3.77 12.765,4.046 12.481,3.992 L12.046,3.557 C11.984,3.291 12.262,1.996 12.576,0.886 C12.757,0.752 12.989,0.748 13.129,0.888 L15.147,2.906 C15.285,3.045 15.281,3.277 15.15,3.459 L15.15,3.459 Z" />
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
  const devConsole = useDevConsoleOptional()
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [authDisabled, setAuthDisabled] = useState(false)

  const user = session?.user

  // Check if auth is disabled
  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        if (data.authDisabled) {
          setAuthDisabled(true)
        }
      })
      .catch(() => {
        // Ignore errors, default to showing sign out
      })

    clientLogger.debug('ProfileMenu mounted')
  }, [])

  // Close menu when clicking outside
  useClickOutside(menuRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  })

  const handleToggle = () => {
    clientLogger.debug('Profile menu toggle', { wasOpen: isOpen })
    setIsOpen(!isOpen)
  }

  const handleProfileClick = () => {
    clientLogger.debug('Navigating to profile from sidebar')
    setIsOpen(false)
    if (isMobile) closeMobile()
    router.push('/profile')
  }

  const handleAboutClick = () => {
    clientLogger.debug('Navigating to about from sidebar')
    setIsOpen(false)
    if (isMobile) closeMobile()
    router.push('/about')
  }

  const handleDevConsoleClick = () => {
    if (devConsole) {
      clientLogger.debug('DevConsole toggle from sidebar', { wasOpen: devConsole.isOpen })
      devConsole.togglePanel()
      setIsOpen(false)
      if (isMobile) closeMobile()
    }
  }

  const handleSignOut = async () => {
    clientLogger.info('User signing out from sidebar')
    setIsOpen(false)
    if (isMobile) closeMobile()
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      router.push('/')
    } catch (error) {
      clientLogger.error('Sign out failed', { error })
      router.push('/')
    }
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
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
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

            {/* DevConsole toggle */}
            {devConsole && (
              <button
                type="button"
                onClick={handleDevConsoleClick}
                className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
              >
                <DevConsoleIcon className="w-4 h-4" />
                <span className="flex-1 text-left">DevConsole</span>
                {devConsole.isOpen && (
                  <span className="text-xs text-primary">On</span>
                )}
              </button>
            )}

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
