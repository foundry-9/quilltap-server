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

interface NavUserMenuQuickHideContentProps {
  /** Callback when visibility changes (optional, for parent notification) */
  onVisibilityChanged?: () => void
}

/**
 * Quick-hide tag selection content for the user menu submenu flyout.
 */
export function NavUserMenuQuickHideContent({ onVisibilityChanged }: NavUserMenuQuickHideContentProps) {
  const { quickHideTags, hiddenTagIds, hideDangerousChats, toggleTag, toggleHideDangerousChats, loading } = useQuickHide()

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
                {isHidden ? (
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M1 1l22 22" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
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
          {hideDangerousChats ? (
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M1 1l22 22" />
            </svg>
          ) : (
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * Eye icon for quick-hide menu item
 * Returns open or closed eye based on hidden state
 */
export function QuickHideIcon({ hasHidden, className }: { hasHidden: boolean; className?: string }) {
  if (hasHidden) {
    // Closed eye icon (something is hidden)
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M1 1l22 22" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      </svg>
    )
  }

  // Open eye icon (nothing hidden)
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
