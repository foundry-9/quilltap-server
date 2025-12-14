"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { clientLogger } from "@/lib/client-logger";
import { useDebugOptional } from "@/components/providers/debug-provider";
import { useDevConsoleOptional } from "@/components/providers/dev-console-provider";
import { useChatContext } from "@/components/providers/chat-context";
import { useQuickHide } from "@/components/providers/quick-hide-provider";
import { TagDropdown } from "@/components/tags/tag-dropdown";
import { TagBadge } from "@/components/tags/tag-badge";
import { SearchBar } from "@/components/search";
import { NavThemeSelector } from "@/components/dashboard/nav-theme-selector";
import { routeSupportsDebug } from "@/lib/navigation/route-flags";
import { BrandLogo } from "@/components/ui/brand-logo";
import { NavLogoMenu, type NavMenuItem } from "@/components/dashboard/nav-logo-menu";
import { useNavbarCollapse } from "@/hooks/useNavbarCollapse";

/** Menu items for the main navigation */
const MENU_ITEMS: NavMenuItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/characters', label: 'Characters' },
  { href: '/personas', label: 'Personas' },
  { href: '/chats', label: 'Chats' },
  { href: '/settings', label: 'Settings' },
  { href: '/tools', label: 'Tools' },
];

interface DashboardNavProps {
  user: {
    name?: string | null;
    email?: string;
    image?: string | null;
  };
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const debug = useDebugOptional();
  const devConsole = useDevConsoleOptional();
  const pathname = usePathname();
  const chat = useChatContext();
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { quickHideTags, hiddenTagIds, toggleTag, clearAllHidden } = useQuickHide();
  const [quickHideDropdownOpen, setQuickHideDropdownOpen] = useState(false);
  const quickHideRef = useRef<HTMLDivElement>(null);
  const hasAnyHidden = hiddenTagIds.size > 0;
  const singleQuickHideTag = quickHideTags.length === 1 ? quickHideTags[0] : null;

  // Responsive navbar collapse detection
  const { isCollapsed, containerRef, menuRef, rightRef } = useNavbarCollapse();

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  // Close quick-hide dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        quickHideRef.current &&
        !quickHideRef.current.contains(event.target as Node)
      ) {
        setQuickHideDropdownOpen(false);
      }
    };

    if (quickHideDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [quickHideDropdownOpen]);

  // Handle eye icon click:
  // - If dropdown is open: just close dropdown
  // - If closed eye (something hidden): clear all hidden tags
  // - If open eye (nothing hidden): open dropdown
  const handleEyeClick = useCallback(() => {
    clientLogger.debug('Quick-hide eye icon clicked', {
      hasAnyHidden,
      tagCount: quickHideTags.length,
      dropdownOpen: quickHideDropdownOpen
    });

    if (quickHideDropdownOpen) {
      // Dropdown is open: just close it
      clientLogger.debug('Closing quick-hide dropdown');
      setQuickHideDropdownOpen(false);
    } else if (hasAnyHidden) {
      // Closed eye: clear all hidden tags
      clientLogger.debug('Clearing all hidden tags via eye icon');
      clearAllHidden();
    } else {
      // Open eye: open dropdown
      clientLogger.debug('Opening quick-hide dropdown');
      setQuickHideDropdownOpen(true);
    }
  }, [hasAnyHidden, quickHideDropdownOpen, clearAllHidden, quickHideTags.length]);

  // Check if we're in a chat conversation
  const isInChat = pathname?.match(/^\/chats\/[^/]+$/);
  const supportsDebugToggle = routeSupportsDebug(pathname);

  return (
    <nav className="qt-navbar nav-header">
      <div className="qt-navbar-container" ref={containerRef}>
        <div className="qt-navbar-section">
          <NavLogoMenu isCollapsed={isCollapsed} menuItems={MENU_ITEMS} />
          {!isCollapsed && (
            <div className="flex space-x-1" ref={menuRef}>
              {MENU_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className="qt-navbar-link">
                  {item.label}
                </Link>
              ))}
            </div>
          )}
          {/* Hidden measurement div - used when collapsed to measure menu width */}
          {isCollapsed && (
            <div
              ref={menuRef}
              className="flex space-x-1 invisible absolute"
              aria-hidden="true"
            >
              {MENU_ITEMS.map((item) => (
                <span key={item.href} className="qt-navbar-link">
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="qt-navbar-section" ref={rightRef}>
            {/* Global search */}
            <SearchBar />
            {/* Theme selector (shown when enabled in settings) */}
            <NavThemeSelector />
            {/* Chat controls - only show when in a chat */}
            {isInChat && chat.chatId && (
              <TagDropdown
                tags={chat.tags}
                isOpen={tagDropdownOpen}
                onToggle={() => setTagDropdownOpen(!tagDropdownOpen)}
                onTagRemove={chat.onTagRemove}
                onTagAdd={chat.onTagAdd}
                loading={chat.tagsLoading}
              />
            )}

            {/* DevConsole toggle button - only shown in development */}
            {devConsole && (
              <button
                onClick={devConsole.togglePanel}
                className={`qt-navbar-toggle ${devConsole.isOpen ? 'qt-navbar-toggle-active' : ''}`}
                title={devConsole.isOpen ? 'Close DevConsole (Ctrl+Shift+D)' : 'Open DevConsole (Ctrl+Shift+D)'}
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 -0.5 17 17"
                  fill="currentColor"
                >
                  <path
                    d="M15.732,2.509 L13.495,0.274 C13.064,-0.159 12.346,-0.141 11.892,0.312 C11.848,0.356 11.817,0.411 11.8,0.471 C11.241,2.706 11.253,3.487 11.346,3.794 L5.081,10.059 L3.162,8.142 L0.872,10.432 C0.123,11.18 -0.503,13.91 0.795,15.207 C2.092,16.504 4.819,15.875 5.566,15.128 L7.86,12.836 L5.981,10.958 L12.265,4.675 C12.607,4.752 13.423,4.732 15.535,4.205 C15.595,4.188 15.65,4.158 15.694,4.114 C16.147,3.661 16.163,2.941 15.732,2.509 L15.732,2.509 Z M15.15,3.459 C14.047,3.77 12.765,4.046 12.481,3.992 L12.046,3.557 C11.984,3.291 12.262,1.996 12.576,0.886 C12.757,0.752 12.989,0.748 13.129,0.888 L15.147,2.906 C15.285,3.045 15.281,3.277 15.15,3.459 L15.15,3.459 Z"
                  />
                </svg>
              </button>
            )}
            {/* Quick-hide controls */}
            {singleQuickHideTag && (
              // Single tag: show toggle button directly
              <button
                type="button"
                onClick={() => toggleTag(singleQuickHideTag.id)}
                aria-pressed={hiddenTagIds.has(singleQuickHideTag.id)}
                className={`qt-button qt-navbar-chip-button ${hiddenTagIds.has(singleQuickHideTag.id) ? 'qt-navbar-chip-button-active' : ''}`}
                title={hiddenTagIds.has(singleQuickHideTag.id) ? 'Show items with this tag' : 'Hide items with this tag'}
              >
                <TagBadge tag={singleQuickHideTag} size="sm" className="pointer-events-none" />
              </button>
            )}
            {quickHideTags.length > 1 && (
              // Multiple tags: show eye icon with dropdown
              <div className="relative" ref={quickHideRef}>
                <button
                  type="button"
                  onClick={handleEyeClick}
                  className={`qt-navbar-toggle ${hasAnyHidden ? 'qt-navbar-toggle-active' : ''}`}
                  title={hasAnyHidden ? 'Click to show all hidden items' : 'Manage hidden tags'}
                  aria-expanded={quickHideDropdownOpen}
                >
                  {hasAnyHidden ? (
                    // Closed eye icon (something is hidden)
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M1 1l22 22" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    </svg>
                  ) : (
                    // Open eye icon (nothing hidden)
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>

                {/* Dropdown menu */}
                {quickHideDropdownOpen && (
                  <div className="qt-navbar-dropdown w-56">
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
                            onClick={() => {
                              clientLogger.debug('Toggling tag from dropdown', { tagId: tag.id, tagName: tag.name, wasHidden: isHidden });
                              toggleTag(tag.id);
                            }}
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
                  </div>
                )}
              </div>
            )}

            {/* User Menu Dropdown */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="qt-button qt-navbar-button"
                aria-label="User menu"
                aria-expanded={userMenuOpen}
              >
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.name || "User"}
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <span className="text-sm font-medium text-foreground">
                    {user.name || user.email || "User"}
                  </span>
                )}
                <svg
                  className={`w-4 h-4 text-muted-foreground transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Dropdown Panel */}
              {userMenuOpen && (
                <div className="qt-navbar-dropdown w-56">
                  <div className="qt-navbar-dropdown-section space-y-3">
                    {/* User Info */}
                    <div className="qt-navbar-dropdown-header">
                      <p className="text-sm font-medium text-foreground">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>

                    {/* Divider */}
                    <div className="qt-navbar-dropdown-divider" />

                    {/* Sign Out Button */}
                    <button
                      onClick={() => signOut({ callbackUrl: "/" })}
                      className="qt-button qt-button-destructive w-full justify-center"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
    </nav>
  );
}
