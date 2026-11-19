'use client'

/**
 * Profile Menu
 *
 * The profile button at the foot of the rail. Its menu (Profile, About) is
 * the registry's `NAV_PROFILE`, drawn by the rail's flyout like any group.
 *
 * @module components/layout/left-sidebar/profile-menu
 */

import { useSession } from '@/components/providers/session-provider'
import { Icon } from '@/components/ui/icon'
import { NAV_PROFILE } from '@/lib/navigation/registry'
import { useNavRail } from './nav-rail-context'
import { navFlyoutId } from './nav-flyout'

export function ProfileMenu() {
  const { data: session } = useSession()
  const { openMenu, toggleFlyout, openFlyout } = useNavRail()
  const user = session?.user
  if (!user) return null

  const isOpen = openMenu?.id === NAV_PROFILE.id

  return (
    <button
      type="button"
      onClick={() => toggleFlyout(NAV_PROFILE.id, NAV_PROFILE.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          openFlyout(NAV_PROFILE.id, NAV_PROFILE.id, { focusFirst: true })
        }
      }}
      className="qt-left-sidebar-profile w-full"
      data-nav={NAV_PROFILE.id}
      title={NAV_PROFILE.label}
      aria-label="User menu"
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-controls={isOpen ? navFlyoutId(NAV_PROFILE.id) : undefined}
    >
      {user.image ? (
        <img
          src={user.image}
          alt=""
          className="qt-left-sidebar-profile-avatar object-cover"
        />
      ) : (
        <div className="qt-left-sidebar-profile-avatar flex items-center justify-center">
          <Icon name="profile" className="w-4 h-4 qt-text-secondary" />
        </div>
      )}
    </button>
  )
}
