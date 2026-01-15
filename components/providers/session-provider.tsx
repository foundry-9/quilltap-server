"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { DebugProvider, useDebugOptional } from "./debug-provider";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";
import { SidebarDataProvider } from "./sidebar-data-provider";
import { ContentWidthProvider } from "./content-width-provider";
import { AvatarDisplayProvider } from "./avatar-display-provider";
import { DevConsoleProvider, useDevConsoleOptional } from "./dev-console-provider";
import { ThemeProvider } from "./theme-provider";

// ============================================================================
// SESSION TYPES
// ============================================================================

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export interface Session {
  user: SessionUser;
  expires: string;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface SessionContextValue {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
}

// ============================================================================
// SESSION CONTEXT
// ============================================================================

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Hook to access session data
 * Similar API to next-auth/react useSession
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}

/**
 * Optional hook that returns undefined if not in provider
 */
export function useSessionOptional(): SessionContextValue | undefined {
  return useContext(SessionContext);
}

// ============================================================================
// SESSION PROVIDER
// ============================================================================

interface CustomSessionProviderProps {
  children: ReactNode;
  refetchInterval?: number; // seconds
  refetchOnWindowFocus?: boolean;
}

function CustomSessionProvider({
  children,
  refetchInterval = 5 * 60, // 5 minutes default
  refetchOnWindowFocus = false,
}: CustomSessionProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const fetchSession = useCallback(async (): Promise<Session | null> => {
    try {
      const response = await fetch("/api/v1/auth/session", {
        credentials: "include",
      });

      if (!response.ok) {
        setSession(null);
        setStatus("unauthenticated");
        return null;
      }

      const data = await response.json();

      if (data.user) {
        const newSession: Session = {
          user: data.user,
          expires: data.expires,
        };
        setSession(newSession);
        setStatus("authenticated");
        return newSession;
      } else {
        setSession(null);
        setStatus("unauthenticated");
        return null;
      }
    } catch (error) {
      console.error("Failed to fetch session:", error);
      setSession(null);
      setStatus("unauthenticated");
      return null;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Refetch on interval
  useEffect(() => {
    if (refetchInterval > 0) {
      const intervalId = setInterval(() => {
        fetchSession();
      }, refetchInterval * 1000);

      return () => clearInterval(intervalId);
    }
  }, [refetchInterval, fetchSession]);

  // Refetch on window focus
  useEffect(() => {
    if (!refetchOnWindowFocus) return;

    const handleFocus = () => {
      fetchSession();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refetchOnWindowFocus, fetchSession]);

  const value: SessionContextValue = {
    data: session,
    status,
    update: fetchSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ============================================================================
// DEBUG MODE SYNC
// ============================================================================

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

// ============================================================================
// PROVIDERS WRAPPER
// ============================================================================

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CustomSessionProvider
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <ThemeProvider>
        <DevConsoleProvider>
          <DebugProvider>
            <DebugModeSync />
            <TagStyleProvider>
              <QuickHideProvider>
                <SidebarDataProvider>
                  <ContentWidthProvider>
                    <AvatarDisplayProvider>
                      {children}
                    </AvatarDisplayProvider>
                  </ContentWidthProvider>
                </SidebarDataProvider>
              </QuickHideProvider>
            </TagStyleProvider>
          </DebugProvider>
        </DevConsoleProvider>
      </ThemeProvider>
    </CustomSessionProvider>
  );
}
