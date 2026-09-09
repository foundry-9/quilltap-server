'use client'

import Avatar from '@/components/ui/Avatar'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { RouteTrailBadge } from '@/components/ui/RouteTrailBadge'
import type { RouteAttempt } from '@/lib/schemas/chat.types'
import type { MessageAvatarInfo } from './types'

interface MessageDesktopAvatarProps {
  messageAvatar: MessageAvatarInfo
  /** Apply the dangerous-chat ring (assistant side only). */
  dangerous?: boolean
  /** Provider/model badge below the avatar (assistant side only); omit for the user side.
   *  When `routeTrail` is a non-empty array the badge becomes the turn's call sheet —
   *  every profile tried, first at the top — instead of the single answering row. */
  badge?: { provider?: string | null; modelName?: string | null; routeTrail?: RouteAttempt[] | null } | null
}

/**
 * The left/right column avatar shown beside a desktop message row. Assistant
 * rows pass a `badge` (and may light up `dangerous`); user rows pass neither.
 */
export function MessageDesktopAvatar({ messageAvatar, dangerous, badge }: MessageDesktopAvatarProps) {
  return (
    <div className={`flex-shrink-0 qt-chat-desktop-avatar${dangerous ? ' qt-chat-avatar-dangerous' : ''}`}>
      <Avatar
        name={messageAvatar.name}
        title={messageAvatar.title}
        src={messageAvatar}
        size="chat"
        showName
        showTitle
        className="flex flex-col items-center w-32 gap-1"
      />
      {badge && (
        badge.routeTrail && badge.routeTrail.length > 0
          ? <RouteTrailBadge routeTrail={badge.routeTrail} size="xs" />
          : <ProviderModelBadge provider={badge.provider} modelName={badge.modelName} size="xs" />
      )}
    </div>
  )
}
