"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useChatContext } from "@/components/providers/chat-context";
import { TagDropdown } from "@/components/tags/tag-dropdown";
import { SearchBar } from "@/components/search";
import { NavLogoMenu, type NavMenuItem } from "@/components/dashboard/nav-logo-menu";
import { NavContentWidthToggle } from "@/components/dashboard/nav-content-width-toggle";
import { NavUserMenu } from "@/components/dashboard/nav-user-menu";
import { useNavbarCollapse } from "@/hooks/useNavbarCollapse";

/**
 * Menu items for the main navigation
 *
 * Note: 'Personas' removed as part of "Characters Not Personas" feature.
 * Personas are now just characters with controlledBy: 'user'.
 * The migration plugin converts existing personas to characters.
 */
const MENU_ITEMS: NavMenuItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/characters', label: 'Characters' },
  // Personas removed - see characters_not_personas.md feature spec
  { href: '/chats', label: 'Chats' },
  { href: '/settings', label: 'Settings' },
  { href: '/tools', label: 'Tools' },
  { href: '/about', label: 'About' },
];

interface DashboardNavProps {
  user: {
    name?: string | null;
    email?: string;
    image?: string | null;
  };
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const chat = useChatContext();
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  // Responsive navbar collapse detection
  const { isCollapsed, containerRef, menuRef, rightRef } = useNavbarCollapse();

  // Check if we're in a chat conversation
  const isInChat = pathname?.match(/^\/chats\/[^/]+$/);

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

          {/* Content width toggle - only visible at wide viewports */}
          <NavContentWidthToggle />

          {/* User Menu - contains theme, quick-hide, dev console, and sign out */}
          <NavUserMenu user={user} />
        </div>
      </div>
    </nav>
  );
}
