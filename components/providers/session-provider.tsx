"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { TagStyleProvider } from "./tag-style-provider";
import { QuickHideProvider } from "./quick-hide-provider";

import { ContentWidthProvider } from "./content-width-provider";
import { AvatarDisplayProvider } from "./avatar-display-provider";
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
  const [serverNotReady, setServerNotReady] = useState(false);

  const fetchSession = useCallback(async (): Promise<Session | null> => {
    try {
      // In single-user mode, session endpoint always returns the user
      const response = await fetch("/api/v1/session", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 503) {
          // Server not ready (e.g., pepper vault setup needed)
          // Keep status as "loading" so the UI shows a loading state
          // rather than rendering without sidebar. The PepperVaultGate
          // will redirect to /setup if needed, and our retry interval
          // will pick up once the server is ready.
          setSession(null);
          setStatus("loading");
          setServerNotReady(true);
          return null;
        }
        // Other errors - log and retry
        console.error("Failed to fetch session, will retry");
        setStatus("loading");
        return null;
      }
      setServerNotReady(false);

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

  // When server returned 503 (setup needed), retry more frequently
  // so the session resolves quickly after setup completes
  useEffect(() => {
    if (!serverNotReady) return;

    const retryId = setInterval(() => {
      fetchSession();
    }, 5000); // retry every 5 seconds

    return () => clearInterval(retryId);
  }, [serverNotReady, fetchSession]);

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
// PROVIDERS WRAPPER
// ============================================================================

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CustomSessionProvider
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <ThemeProvider>
        <TagStyleProvider>
          <QuickHideProvider>
              <ContentWidthProvider>
                <AvatarDisplayProvider>
                  {children}
                </AvatarDisplayProvider>
              </ContentWidthProvider>
          </QuickHideProvider>
        </TagStyleProvider>
      </ThemeProvider>
    </CustomSessionProvider>
  );
}
