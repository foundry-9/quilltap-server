"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { DebugProvider, useDebugOptional } from "./debug-provider";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";
import { ContentWidthProvider } from "./content-width-provider";
import { AvatarDisplayProvider } from "./avatar-display-provider";
import { DevConsoleProvider, useDevConsoleOptional } from "./dev-console-provider";
import { ThemeProvider } from "./theme-provider";

/**
 * Syncs DevConsole's isOpen state with DebugProvider's isDebugMode.
 * When DevConsole is open, debug mode is enabled to capture API traffic.
 */
function DebugModeSync() {
  const devConsole = useDevConsoleOptional();
  const debug = useDebugOptional();

  const isDevConsoleOpen = devConsole?.isOpen ?? false;
  const isDebugMode = debug?.isDebugMode ?? false;
  const toggleDebugMode = debug?.toggleDebugMode;

  useEffect(() => {
    // Sync debug mode with DevConsole open state
    if (toggleDebugMode && isDevConsoleOpen !== isDebugMode) {
      toggleDebugMode();
    }
  }, [isDevConsoleOpen, isDebugMode, toggleDebugMode]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <ThemeProvider>
        <DevConsoleProvider>
          <DebugProvider>
            <DebugModeSync />
            <TagStyleProvider>
              <QuickHideProvider>
                <ContentWidthProvider>
                  <AvatarDisplayProvider>
                    {children}
                  </AvatarDisplayProvider>
                </ContentWidthProvider>
              </QuickHideProvider>
            </TagStyleProvider>
          </DebugProvider>
        </DevConsoleProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
