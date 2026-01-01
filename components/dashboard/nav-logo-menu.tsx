'use client';

/**
 * Navigation Logo Menu
 *
 * A responsive component that displays the Quilltap logo.
 * When collapsed, the logo becomes a dropdown trigger for navigation menu items.
 *
 * @module components/dashboard/nav-logo-menu
 */

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/ui/brand-logo';
import { clientLogger } from '@/lib/client-logger';
import { useClickOutside } from '@/hooks/useClickOutside';

export interface NavMenuItem {
  href: string;
  label: string;
}

interface NavLogoMenuProps {
  /** Whether the navbar is in collapsed mode */
  isCollapsed: boolean;
  /** Menu items to show in the dropdown */
  menuItems: NavMenuItem[];
}

/**
 * Logo component that becomes a dropdown menu when the navbar is collapsed.
 */
export function NavLogoMenu({ isCollapsed, menuItems }: NavLogoMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside or pressing escape
  useClickOutside(dropdownRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  });

  const handleToggle = () => {
    clientLogger.debug('NavLogoMenu: toggle dropdown', { wasOpen: isOpen, isCollapsed });
    setIsOpen(!isOpen);
  };

  const handleItemClick = (href: string) => {
    clientLogger.debug('NavLogoMenu: item clicked', { href });
    setIsOpen(false);
  };

  // When not collapsed, just render a simple link to dashboard
  if (!isCollapsed) {
    return (
      <Link href="/" className="text-foreground">
        <BrandLogo size="md" />
      </Link>
    );
  }

  // When collapsed, render as a dropdown trigger
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="qt-navbar-button flex items-center gap-1"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Navigation menu"
      >
        <BrandLogo size="md" />
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
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

      {/* Dropdown menu */}
      {isOpen && (
        <div className="qt-navbar-dropdown qt-navbar-dropdown-left w-48">
          <div className="qt-navbar-dropdown-section space-y-1">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="qt-navbar-dropdown-item"
                onClick={() => handleItemClick(item.href)}
              >
                <span className="text-sm">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
