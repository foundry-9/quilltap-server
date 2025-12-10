"use client";

import { SessionProvider } from "next-auth/react";
import { DebugProvider } from "./debug-provider";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";
import { DevConsoleProvider } from "./dev-console-provider";
import { ThemeProvider } from "./theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <ThemeProvider>
        <DevConsoleProvider>
          <DebugProvider>
            <TagStyleProvider>
              <QuickHideProvider>
                {children}
              </QuickHideProvider>
            </TagStyleProvider>
          </DebugProvider>
        </DevConsoleProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
