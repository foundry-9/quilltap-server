'use client'

/**
 * Profile Menu
 *
 * User profile dropdown for the sidebar footer.
 *
 * @module components/layout/left-sidebar/profile-menu
 */

import { useState, useRef } from 'react'
import { useSession } from '@/components/providers/session-provider'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { Icon } from '@/components/ui/icon'

export function ProfileMenu() {
  const { data: session } = useSession()
  // Keep-alive-safe: inside the workspace this opens Profile/About as tabs in
  // place; elsewhere it falls back to a normal route push.
  const navigate = useWorkspaceNavigate()
  const menuRef = useRef<HTMLDivElement>(null)

  const [isOpen, setIsOpen] = useState(false)

  const user = session?.user

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
    navigate('/profile')
  }

  const handleAboutClick = () => {
    setIsOpen(false)
    navigate('/about')
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
        title="Profile"
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
            <Icon name="profile" className="w-4 h-4 qt-text-secondary" />
          </div>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 qt-bg-popover border qt-border-default rounded-lg qt-shadow-lg overflow-hidden z-50 left-0 w-48">
          <div className="p-2 space-y-1">
            {/* Profile link */}
            <button
              type="button"
              onClick={handleProfileClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:qt-bg-muted transition-colors"
            >
              <Icon name="profile" className="w-4 h-4" />
              Profile
            </button>

            {/* About link */}
            <button
              type="button"
              onClick={handleAboutClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:qt-bg-muted transition-colors"
            >
              <Icon name="info" className="w-4 h-4" />
              About
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
