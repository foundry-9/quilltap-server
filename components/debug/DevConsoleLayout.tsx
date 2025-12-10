"use client";

import { useState, useEffect, ReactNode } from 'react';
import { useDevConsoleOptional } from '@/components/providers/dev-console-provider';
import DevConsolePanel from './DevConsolePanel';

// Breakpoint for switching between bottom overlay and side-by-side layout
const SIDE_PANEL_BREAKPOINT = 1200;

// Main content width when DevConsole is open on wide screens
const MAIN_CONTENT_WIDTH = 850;

interface DevConsoleLayoutProps {
  children: ReactNode;
}

/**
 * DevConsoleLayout - Wraps main content and DevConsole in a responsive layout
 *
 * Wide viewport (>= 1200px) with DevConsole open:
 *   - Two-column layout: main content (850px) | DevConsole (remaining)
 *
 * Narrow viewport (< 1200px) with DevConsole open:
 *   - Main content takes full width
 *   - DevConsole overlays as bottom panel
 *
 * DevConsole closed:
 *   - Main content takes full width
 */
export default function DevConsoleLayout({ children }: DevConsoleLayoutProps) {
  const devConsole = useDevConsoleOptional();
  const [isWideViewport, setIsWideViewport] = useState(false);

  // Track viewport width for responsive layout
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkWidth = () => {
      setIsWideViewport(window.innerWidth >= SIDE_PANEL_BREAKPOINT);
    };

    // Initial check
    checkWidth();

    // Listen for resize
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const isOpen = devConsole?.isOpen ?? false;
  const showSidePanel = isOpen && isWideViewport;
  const showBottomPanel = isOpen && !isWideViewport;

  // Wide viewport with DevConsole: two-column layout
  if (showSidePanel) {
    return (
      <div className="flex h-full">
        {/* Main content - fixed width */}
        <div
          className="flex-shrink-0 overflow-y-auto bg-background"
          style={{ width: `${MAIN_CONTENT_WIDTH}px` }}
        >
          {children}
        </div>

        {/* DevConsole panel - takes remaining space */}
        <div className="flex-1 min-w-0 border-l border-border">
          <DevConsolePanel layout="side" />
        </div>
      </div>
    );
  }

  // Narrow viewport or DevConsole closed: full-width main content
  return (
    <>
      <div className={`h-full overflow-y-auto bg-background ${showBottomPanel ? 'pb-[40vh]' : ''}`}>
        {children}
      </div>

      {/* Bottom panel overlay for narrow viewports */}
      {showBottomPanel && <DevConsolePanel layout="bottom" />}
    </>
  );
}
