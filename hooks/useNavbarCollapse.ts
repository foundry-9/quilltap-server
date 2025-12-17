"use client";

import { useState, useEffect, useRef, RefObject, useCallback } from 'react';
import { clientLogger } from '@/lib/client-logger';

interface UseNavbarCollapseOptions {
  /** Width reserved for logo area (default: 160) */
  logoWidth?: number;
  /** Extra buffer before collapsing (default: 20) */
  bufferWidth?: number;
}

interface UseNavbarCollapseReturn {
  /** Whether the navbar should show collapsed menu */
  isCollapsed: boolean;
  /** Ref for the main navbar container */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Ref for the menu items container */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Ref for the right section container */
  rightRef: RefObject<HTMLDivElement | null>;
}

/**
 * Hook to detect when navbar menu items overflow and should collapse
 * into a dropdown menu.
 *
 * Uses ResizeObserver for efficient, automatic updates on resize.
 */
export function useNavbarCollapse(options?: UseNavbarCollapseOptions): UseNavbarCollapseReturn {
  const { logoWidth = 160, bufferWidth = 20 } = options || {};

  // Default to false for SSR, will be updated on client
  const [isCollapsed, setIsCollapsed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);

  const checkOverflow = useCallback(() => {
    const container = containerRef.current;
    const menu = menuRef.current;
    const right = rightRef.current;

    if (!container || !menu || !right) {
      return;
    }

    // Get actual widths
    const containerWidth = container.offsetWidth;
    const menuWidth = menu.scrollWidth;
    const rightWidth = right.offsetWidth;

    // Calculate available width for menu items
    // Container padding (px-4 = 16px each side = 32px total)
    // Gap between sections (gap-4 = 16px)
    const containerPadding = 32;
    const sectionGap = 16;

    const availableWidth = containerWidth - logoWidth - rightWidth - containerPadding - (sectionGap * 2) - bufferWidth;

    const shouldCollapse = menuWidth > availableWidth;

    clientLogger.debug('Navbar collapse check', {
      containerWidth,
      menuWidth,
      rightWidth,
      availableWidth,
      shouldCollapse,
    });

    setIsCollapsed(shouldCollapse);
  }, [logoWidth, bufferWidth]);

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') {
      return;
    }

    // Initial check after a brief delay to let layout settle
    const initialTimeout = setTimeout(checkOverflow, 50);

    // Set up ResizeObserver for dynamic updates
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Also observe window resize as a fallback
    window.addEventListener('resize', checkOverflow);

    return () => {
      clearTimeout(initialTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkOverflow);
    };
  }, [checkOverflow]);

  return {
    isCollapsed,
    containerRef,
    menuRef,
    rightRef,
  };
}
