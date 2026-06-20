'use client'

/**
 * Quick-hide Submenu Content
 *
 * Flyout submenu content for quick-hide tag management within the user menu.
 * Displays available quick-hide tags with toggle controls.
 *
 * @module components/dashboard/nav-user-menu-quick-hide
 */

import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { TagBadge } from '@/components/tags/tag-badge'
import { Icon } from '@/components/ui/icon'

interface NavUserMenuQuickHideContentProps {
  /** Callback when visibility changes (optional, for parent notification) */
  onVisibilityChanged?: () => void
}

/**
 * Quick-hide tag selection content for the user menu submenu flyout.
 */
export function NavUserMenuQuickHideContent({ onVisibilityChanged }: NavUserMenuQuickHideContentProps) {
  const {
    quickHideTags,
    hiddenTagIds,
    hideDangerousChats,
    includeAutonomousRooms,
    toggleTag,
    toggleHideDangerousChats,
    toggleIncludeAutonomousRooms,
    loading,
  } = useQuickHide()

  if (loading) {
    return (
      <div className="p-3 qt-text-small">
        Loading tags...
      </div>
    )
  }

  const handleToggle = (tagId: string, tagName: string, wasHidden: boolean) => {
    toggleTag(tagId)
    onVisibilityChanged?.()
  }

  const handleDangerToggle = () => {
    toggleHideDangerousChats()
    onVisibilityChanged?.()
  }

  const handleAutonomousToggle = () => {
    toggleIncludeAutonomousRooms()
    onVisibilityChanged?.()
  }

  return (
    <div className="space-y-1">
      {/* Quick Hide Tags */}
      {quickHideTags.length > 0 && (
        <div className="qt-navbar-dropdown-section space-y-1">
          <div className="qt-navbar-dropdown-label">
            Quick Hide Tags
          </div>
          {quickHideTags.map(tag => {
            const isHidden = hiddenTagIds.has(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleToggle(tag.id, tag.name, isHidden)}
                className={`qt-navbar-dropdown-item ${isHidden ? 'qt-navbar-dropdown-item-active' : ''}`}
              >
                <TagBadge tag={tag} size="sm" />
                <Icon name={isHidden ? 'eye-off' : 'eye'} className="w-4 h-4 flex-shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {/* Content Filters */}
      <div className="qt-navbar-dropdown-section space-y-1">
        <div className="qt-navbar-dropdown-label">
          Content Filters
        </div>
        <button
          type="button"
          onClick={handleDangerToggle}
          className={`qt-navbar-dropdown-item ${hideDangerousChats ? 'qt-navbar-dropdown-item-active' : ''}`}
        >
          <span className="text-sm">Dangerous Chats</span>
          <Icon name={hideDangerousChats ? 'eye-off' : 'eye'} className="w-4 h-4 flex-shrink-0" />
        </button>

        <button
          type="button"
          onClick={handleAutonomousToggle}
          className={`qt-navbar-dropdown-item ${includeAutonomousRooms ? 'qt-navbar-dropdown-item-active' : ''}`}
          title="Show autonomous character-to-character rooms in the Salon chat list"
        >
          <span className="text-sm">Show Autonomous Rooms</span>
          <Icon name={includeAutonomousRooms ? 'eye' : 'eye-off'} className="w-4 h-4 flex-shrink-0" />
        </button>
      </div>
    </div>
  )
}

/**
 * Eye icon for quick-hide menu item.
 * Open eye when nothing is hidden; struck-through eye when something is hidden.
 */
export function QuickHideIcon({ hasHidden, className }: { hasHidden: boolean; className?: string }) {
  return <Icon name={hasHidden ? 'eye-off' : 'eye'} className={className} />
}
