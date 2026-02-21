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
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import { useTheme, useSubsystemInfo } from '@/components/providers/theme-provider'
import { ProfileMenu } from './profile-menu'
import { NavUserMenuThemeContent } from '@/components/dashboard/nav-user-menu-theme'
import { NavUserMenuQuickHideContent, QuickHideIcon } from '@/components/dashboard/nav-user-menu-quick-hide'

/**
 * Foundry icon (anvil/wrench)
 */
function FoundryIcon({ className }: { className?: string }) {
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
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

/**
 * Palette icon (for themes)
 */
function PaletteIcon({ className }: { className?: string }) {
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
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
    </svg>
  )
}

type PopoutMenu = 'themes' | 'quickHide' | null

export function SidebarFooter() {
  const quickHide = useQuickHide()
  const { chats } = useSidebarData()
  const theme = useTheme()
  const foundryInfo = useSubsystemInfo('foundry')
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
  const hasDangerousChats = chats.some(chat => chat.isDangerous)
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
        <a
          href="/foundry"
          className="qt-left-sidebar-item justify-center px-0"
          title={foundryInfo.name}
        >
          <FoundryIcon className="qt-left-sidebar-item-icon w-5 h-5" />
        </a>

        {showThemes && (
          <div ref={themesRef} className="relative">
            <button
              type="button"
              onClick={handleThemeClick}
              className={`qt-left-sidebar-item w-full justify-center px-0 ${openPopout === 'themes' ? 'bg-accent' : ''}`}
              title="Themes"
            >
              <PaletteIcon className="qt-left-sidebar-item-icon w-5 h-5" />
            </button>
            {openPopout === 'themes' && (
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border border-border rounded-lg qt-shadow-lg z-50">
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
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border border-border rounded-lg qt-shadow-lg z-50">
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
