'use client'

import Avatar from '@/components/ui/Avatar'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { RouteTrailBadge } from '@/components/ui/RouteTrailBadge'
import { Tooltip } from '@/components/ui/Tooltip'
import { InventoryGlyph } from '@/components/inventory/inventory-glyph'
import { useChatCarriedItems } from '@/lib/hooks/use-inventory'
import { inventoryDisplayName } from '@/lib/inventory/resolve'
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
  /** The chat, for what the avatar's character carries in it. */
  chatId?: string
  /** Open the picture full size (the Salon's image viewer). */
  onImageClick?: (filepath: string, filename: string, fileId?: string) => void
}

/** The glyphs of what the avatar's character carries in this chat, each with its name and description on hover. */
function CarriedGlyphs({ chatId, characterId }: { chatId?: string; characterId?: string | null }) {
  const carried = useChatCarriedItems(chatId, characterId)
  if (carried.length === 0) return null
  return (
    <ul className="flex flex-wrap justify-center gap-1 w-32 mt-1" aria-label="Carrying" data-testid="salon-avatar-carried">
      {carried.map((item) => {
        const name = inventoryDisplayName(item)
        return (
          <li key={item.id}>
            <Tooltip
              placement="bottom"
              className="max-w-xs"
              content={
                <span className="block">
                  <span className="block font-semibold">{name}</span>
                  {item.description && <span className="block mt-1 whitespace-pre-line">{item.description}</span>}
                </span>
              }
            >
              <span tabIndex={0} role="img" aria-label={name} className="inline-flex">
                <InventoryGlyph item={item} size="sm" fallback="abbreviation" />
              </span>
            </Tooltip>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The left/right column avatar shown beside a desktop message row. Assistant
 * rows pass a `badge` (and may light up `dangerous`); user rows pass neither.
 * A character's avatar also shows what they carry in the chat, between the
 * title and the badge.
 */
export function MessageDesktopAvatar({ messageAvatar, dangerous, badge, chatId, onImageClick }: MessageDesktopAvatarProps) {
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
        onImageClick={onImageClick
          ? (src) => onImageClick(src, messageAvatar.name, messageAvatar.defaultImage?.id)
          : undefined}
      />
      <CarriedGlyphs chatId={chatId} characterId={messageAvatar.characterId} />
      {badge && (
        badge.routeTrail && badge.routeTrail.length > 0
          ? <RouteTrailBadge routeTrail={badge.routeTrail} size="xs" />
          : <ProviderModelBadge provider={badge.provider} modelName={badge.modelName} size="xs" />
      )}
    </div>
  )
}
