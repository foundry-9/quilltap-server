'use client'

/**
 * Sidebar Footer
 *
 * Footer area with Foundry link, themes, quick-hide, and profile.
 * Sidebar is always collapsed — all items use centered icon styling.
 *
 * @module components/layout/left-sidebar/sidebar-footer
 */

import { useState, useRef, useCallback } from 'react'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useHasDangerousChats } from '@/components/hooks/use-has-dangerous-chats'
import { useTheme } from '@/components/providers/theme-provider'
import { ProfileMenu } from './profile-menu'
import { NavUserMenuThemeContent } from '@/components/dashboard/nav-user-menu-theme'
import { NavUserMenuQuickHideContent, QuickHideIcon } from '@/components/dashboard/nav-user-menu-quick-hide'
import { useHelpChatOptional } from '@/components/providers/help-chat-provider'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { Icon } from '@/components/ui/icon'

// Match a UUID immediately following /salon/. If the user is reading a chat,
// the sidebar's Wardrobe button should pass that chat id along so the dialog
// can show Wearing now / Wear this against the right scope.
const SALON_CHAT_PATH_RE = /^\/salon\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

interface SalonParticipantLite {
  id: string
  controlledBy?: string | null
  displayOrder?: number | null
  character?: { id?: string | null } | null
}

interface MessageLite {
  role?: string | null
  participantId?: string | null
  createdAt?: string | null
}

/**
 * Resolve the wardrobe dialog's default character for a chat. Priority:
 *   1. Most recent assistant message authored by a non-user-controlled participant.
 *   2. First non-user-controlled CHARACTER participant in chat order.
 *   3. null — caller should let the dialog fall back to alphabetical first.
 */
async function resolveDefaultCharacterForChat(
  chatId: string,
): Promise<string | null> {
  try {
    const [chatRes, msgRes] = await Promise.all([
      fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
      fetch(`/api/v1/messages?chatId=${chatId}`, { cache: 'no-store' }),
    ])
    if (!chatRes.ok) return null
    const chatData = (await chatRes.json()) as {
      chat?: { participants?: SalonParticipantLite[] }
    }
    const participants = chatData.chat?.participants ?? []
    const eligible = participants.filter(
      (p) => p.controlledBy !== 'user' && p.character?.id,
    )
    if (eligible.length === 0) return null
    const eligibleIds = new Set(eligible.map((p) => p.character!.id!))

    // Priority 1: most recent assistant message attribution
    if (msgRes.ok) {
      const msgData = (await msgRes.json()) as { messages?: MessageLite[] }
      const messages = msgData.messages ?? []
      // Scan from the end — messages are returned in chronological order.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role !== 'assistant' || !m.participantId) continue
        const p = eligible.find((pp) => pp.id === m.participantId)
        const cid = p?.character?.id
        if (cid && eligibleIds.has(cid)) return cid
      }
    }

    // Priority 2: first non-user-controlled participant in chat order
    const sortedByOrder = [...eligible].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    )
    return sortedByOrder[0]?.character?.id ?? null
  } catch {
    return null
  }
}

type PopoutMenu = 'themes' | 'quickHide' | null

export function SidebarFooter() {
  const quickHide = useQuickHide()
  const { hasDangerousChats } = useHasDangerousChats()
  const theme = useTheme()
  const helpChat = useHelpChatOptional()
  const wardrobeDialog = useWardrobeDialogOptional()
  const pathname = usePathname()
  const [openPopout, setOpenPopout] = useState<PopoutMenu>(null)
  const themesRef = useRef<HTMLDivElement>(null)
  const quickHideRef = useRef<HTMLDivElement>(null)

  // Track if component has mounted (for hydration-safe rendering)
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')

  // Close popout when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (openPopout === 'themes' && themesRef.current && !themesRef.current.contains(target)) {
        setOpenPopout(null)
      }
      if (openPopout === 'quickHide' && quickHideRef.current && !quickHideRef.current.contains(target)) {
        setOpenPopout(null)
      }
    }

    if (openPopout) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openPopout])

  // Show quick-hide button if there are tags, dangerous chats exist, or danger filter is active
  const hasQuickHideFeatures = mounted && (quickHide.quickHideTags.length > 0 || quickHide.hideDangerousChats || hasDangerousChats)
  const hasAnyHidden = mounted && (quickHide.hiddenTagIds.size > 0 || quickHide.hideDangerousChats)
  // Check if theme selector should be shown in nav
  const showThemes = mounted && theme.showNavThemeSelector

  const handleThemeClick = useCallback(() => {
    setOpenPopout(prev => prev === 'themes' ? null : 'themes')
  }, [])

  const handleQuickHideClick = useCallback(() => {
    setOpenPopout(prev => prev === 'quickHide' ? null : 'quickHide')
  }, [])

  const handleThemeSelected = useCallback(() => {
    setOpenPopout(null)
  }, [])

  return (
    <div className="qt-left-sidebar-footer">
      <div className="qt-left-sidebar-footer-actions">
        {helpChat && (
          <button
            type="button"
            onClick={helpChat.openHelpChat}
            disabled={!helpChat.isEligible && !helpChat.eligibilityLoading}
            className={`qt-left-sidebar-item justify-center px-0 ${!helpChat.isEligible && !helpChat.eligibilityLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={helpChat.isEligible ? 'Help' : 'Help (requires a help-enabled character with a tool-capable connection)'}
          >
            <Icon name="help" className="qt-left-sidebar-item-icon w-5 h-5" />
          </button>
        )}
        {wardrobeDialog && (
          <button
            type="button"
            onClick={async () => {
              const chatMatch = pathname?.match(SALON_CHAT_PATH_RE)
              if (!chatMatch) {
                wardrobeDialog.open()
                return
              }
              const chatId = chatMatch[1]
              const characterId = await resolveDefaultCharacterForChat(chatId)
              wardrobeDialog.open(
                characterId ? { chatId, characterId } : { chatId },
              )
            }}
            className="qt-left-sidebar-item justify-center px-0"
            title="Wardrobe"
          >
            <Icon name="wardrobe" className="qt-left-sidebar-item-icon w-5 h-5" />
          </button>
        )}

        <a
          href="/settings"
          className="qt-left-sidebar-item justify-center px-0"
          title="Settings"
        >
          <Icon name="settings" className="qt-left-sidebar-item-icon w-5 h-5" />
        </a>

        {showThemes && (
          <div ref={themesRef} className="relative">
            <button
              type="button"
              onClick={handleThemeClick}
              className={`qt-left-sidebar-item w-full justify-center px-0 ${openPopout === 'themes' ? 'bg-accent' : ''}`}
              title="Themes"
            >
              <Icon name="themes" className="qt-left-sidebar-item-icon w-5 h-5" />
            </button>
            {openPopout === 'themes' && (
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border qt-border-default rounded-lg qt-shadow-lg z-50">
                <NavUserMenuThemeContent onThemeSelected={handleThemeSelected} />
              </div>
            )}
          </div>
        )}

        {hasQuickHideFeatures && (
          <div ref={quickHideRef} className="relative">
            <button
              type="button"
              onClick={handleQuickHideClick}
              className={`qt-left-sidebar-item w-full justify-center px-0 ${openPopout === 'quickHide' ? 'bg-accent' : ''}`}
              title={hasAnyHidden ? 'Show' : 'Hide'}
            >
              <QuickHideIcon hasHidden={hasAnyHidden} className="qt-left-sidebar-item-icon w-5 h-5" />
            </button>
            {openPopout === 'quickHide' && (
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border qt-border-default rounded-lg qt-shadow-lg z-50">
                <NavUserMenuQuickHideContent />
              </div>
            )}
          </div>
        )}
      </div>

      <ProfileMenu />
    </div>
  )
}
