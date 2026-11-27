'use client'

/**
 * CharacterCard
 *
 * One portrait on the home page's wall. Clicking it opens the workspace's New
 * Chat dialog (or, outside the workspace, the `/salon/new` page) seeded with
 * this character. Resting on it, or tabbing to it, opens a small card with the
 * character's title and model, a way back into their latest conversation, and
 * the door to their page.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/icon'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import type { HomepageCharacter } from './types'

/** How long the pointer rests before the card opens, so a pass across the wall opens nothing. */
const HOVER_OPEN_DELAY_MS = 180

interface CharacterCardProps {
  character: HomepageCharacter
  /** Which edge of the portrait the card lines up with, so it stays on the page. */
  align?: 'start' | 'end'
  /** Above or below the portrait: chosen so the card never covers the wall. */
  placement?: 'above' | 'below'
}

/** Whether focus arrived by keyboard; engines without `:focus-visible` count every focus. */
function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

export function CharacterCard({ character, align = 'start', placement = 'below' }: CharacterCardProps) {
  const newChat = useNewChatModalOptional()
  const router = useRouter()
  const { shouldHideChat } = useQuickHide()
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])
  useEffect(() => clearHoverTimer, [clearHoverTimer])

  const startChat = () => {
    clearHoverTimer()
    setOpen(false)
    if (newChat) {
      newChat.open({ characterId: character.id, characterName: character.name })
    } else {
      router.push(`/salon/new?characterId=${encodeURIComponent(character.id)}`)
    }
  }

  const { getProfileProvider } = useConnectionProfiles()
  const profileInfo = character.defaultConnectionProfileId
    ? getProfileProvider(character.defaultConnectionProfileId)
    : null

  // For compact card display, strip provider prefix (e.g., "GROK/grok-4.20..." → "grok-4.20...")
  const profileDisplayName = (() => {
    const name = profileInfo?.name || profileInfo?.modelName || ''
    if (!name) return ''
    const provider = profileInfo?.provider || ''
    const prefixes = [`${provider}/`, `${provider.toLowerCase()}/`]
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return name.slice(prefix.length)
    }
    return name
  })()

  // The latest chat is offered only when quick-hide would show that chat.
  const latestChat = character.latestChat && !shouldHideChat({
    characterTags: character.latestChat.characterTags,
    conciergeState: character.latestChat.conciergeState,
  })
    ? character.latestChat
    : null
  const latestHref = latestChat ? `/salon/${latestChat.id}` : null
  const profileHref = `/aurora/${character.id}`

  const handleMouseEnter = () => {
    clearHoverTimer()
    hoverTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS)
  }
  const handleMouseLeave = () => {
    clearHoverTimer()
    setOpen(false)
  }
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      clearHoverTimer()
      setOpen(false)
    }
  }

  return (
    <div
      className="qt-character-card"
      data-favorite={character.isFavorite ? 'true' : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={(event) => {
        // A click focuses the button too, and so does a dialog handing focus
        // back; neither is a request for the card.
        if (isKeyboardFocus(event.target)) setOpen(true)
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        onClick={startChat}
        className="qt-character-card-button"
        aria-label={`Start a chat with ${character.name}`}
        aria-describedby={open ? popoverId : undefined}
      >
        <span className="qt-character-card-portrait">
          <Avatar
            name={character.name}
            src={character}
            size="lg"
          />
          {character.isFavorite && (
            <span className="qt-character-card-favorite" title="Favorite">
              <Icon name="star" className="w-3 h-3" />
            </span>
          )}
        </span>
        <span className="qt-character-card-name">{character.name}</span>
      </button>

      {open && (
        <div id={popoverId} className="qt-character-card-popover" data-align={align} data-placement={placement}>
          <p className="qt-card-title">{character.name}</p>
          {character.title && (
            <p className="qt-card-subtitle italic">{character.title}</p>
          )}
          {profileInfo && (
            <ProviderModelBadge
              provider={profileInfo.provider}
              modelName={profileDisplayName}
              title={`${profileInfo.name || profileInfo.provider}: ${profileInfo.modelName}`}
              size="sm"
              compact
            />
          )}
          <div className="qt-character-card-links">
            {latestChat && latestHref && (
              <Link
                href={latestHref}
                className="qt-character-card-link"
              >
                <Icon name="play" className="w-3.5 h-3.5 shrink-0" />
                <span className="min-w-0">
                  Resume <span className="italic">{latestChat.title}</span>
                </span>
              </Link>
            )}
            <Link
              href={profileHref}
              className="qt-character-card-link"
            >
              <Icon name="profile" className="w-3.5 h-3.5 shrink-0" />
              <span>Open {character.name}&rsquo;s page</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
