"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type DevConsoleTab = 'server' | 'console' | 'chat-debug';

export interface ServerLogEntry {
  id: string;
  type: 'log' | 'raw' | 'info';
  source?: 'winston' | 'stdout'; // Which log source this came from
  timestamp?: string;
  level?: string;
  message?: string;
  content?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: unknown[];
}

interface DevConsoleContextValue {
  // Panel visibility
  isOpen: boolean;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;

  // Tab management
  activeTab: DevConsoleTab;
  setActiveTab: (tab: DevConsoleTab) => void;

  // Server logs
  serverLogs: ServerLogEntry[];
  clearServerLogs: () => void;
  serverLogConnected: boolean;

  // Browser console
  consoleLogs: ConsoleLogEntry[];
  clearConsoleLogs: () => void;

  // Chat debug available check
  chatDebugAvailable: boolean;
}

const DevConsoleContext = createContext<DevConsoleContextValue | null>(null);

export function useDevConsole() {
  const context = useContext(DevConsoleContext);
  if (!context) {
    throw new Error('useDevConsole must be used within a DevConsoleProvider');
  }
  return context;
}

export function useDevConsoleOptional() {
  return useContext(DevConsoleContext);
}

// Check if we're in development mode (client-side safe)
function isDevelopmentClient(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

let consoleLogIdCounter = 0;
let serverLogIdCounter = 0;

export function DevConsoleProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DevConsoleTab>('server');
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([]);
  const [serverLogConnected, setServerLogConnected] = useState(false);
  const pathname = usePathname();

  // Check if we're on a chat page (for Chat Debug tab)
  const chatDebugAvailable = pathname?.match(/^\/chats\/[^/]+$/) !== null;

  // Toggle panel
  const togglePanel = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const openPanel = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Clear logs
  const clearServerLogs = useCallback(() => {
    setServerLogs([]);
  }, []);

  const clearConsoleLogs = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  // Setup keyboard shortcut (Cmd+Shift+D on macOS, Ctrl+Shift+D on Windows/Linux)
  useEffect(() => {
    if (!isDevelopmentClient()) return;

    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // On macOS: Cmd+Shift+D, on other platforms: Ctrl+Shift+D
      const isModifierPressed = isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);

      if (isModifierPressed && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        togglePanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePanel]);

  // Buffer for batching console log captures to prevent render loops
  const pendingLogsRef = useRef<ConsoleLogEntry[]>([]);
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Flush pending logs to state (batched)
  // Use a ref to hold the flush function to avoid dependency issues in useEffect
  const flushPendingLogsRef = useRef<() => void>(() => {});
  flushPendingLogsRef.current = () => {
    if (pendingLogsRef.current.length === 0) return;

    const logsToAdd = pendingLogsRef.current;
    pendingLogsRef.current = [];

    setConsoleLogs(prev => {
      const updated = [...prev, ...logsToAdd];
      return updated.slice(-500);
    });
  };

  // Setup browser console capture
  useEffect(() => {
    if (!isDevelopmentClient()) return;

    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    const captureLog = (level: ConsoleLogEntry['level']) => {
      return (...args: unknown[]) => {
        // Filter out known harmless warnings from external libraries BEFORE calling original
        // The flushSync warning comes from @tanstack/react-virtual during element measurement
        // Check all arguments for the warning message
        const shouldFilter = args.some(arg => {
          if (typeof arg === 'string') {
            return arg.includes('flushSync was called from inside a lifecycle method');
          }
          // Also check if it's an Error object with the message
          if (arg instanceof Error) {
            return arg.message.includes('flushSync was called from inside a lifecycle method');
          }
          // Check if it's an object with a message property
          if (arg && typeof arg === 'object' && 'message' in arg) {
            const msg = (arg as { message: unknown }).message;
            return typeof msg === 'string' && msg.includes('flushSync was called from inside a lifecycle method');
          }
          return false;
        });

        if (shouldFilter) {
          // Completely suppress this warning - don't even call original
          // This prevents Next.js dev overlay from showing it
          return;
        }

        // Call original
        originalConsole[level](...args);

        // Add to pending buffer instead of updating state directly
        const newEntry: ConsoleLogEntry = {
          id: `console-${++consoleLogIdCounter}-${Date.now()}`,
          timestamp: new Date(),
          level,
          args,
        };
        pendingLogsRef.current.push(newEntry);

        // Schedule flush if not already scheduled
        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(() => {
            flushTimeoutRef.current = null;
            flushPendingLogsRef.current();
          }, 100); // Batch logs every 100ms
        }
      };
    };

    console.log = captureLog('log');
    console.info = captureLog('info');
    console.warn = captureLog('warn');
    console.error = captureLog('error');
    console.debug = captureLog('debug');

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;

      // Clear any pending flush timeout
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
    };
  }, []); // Empty deps - only run once on mount

  // Setup server log SSE connection
  useEffect(() => {
    if (!isDevelopmentClient()) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      eventSource = new EventSource('/api/dev/logs?lines=100');

      eventSource.onopen = () => {
        setServerLogConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setServerLogs(prev => {
            const newEntry: ServerLogEntry = {
              id: `server-${++serverLogIdCounter}-${Date.now()}`,
              ...data,
            };
            // Keep last 1000 entries
            const updated = [...prev, newEntry];
            return updated.slice(-1000);
          });
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.onerror = () => {
        setServerLogConnected(false);
        eventSource?.close();
        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, []);

  // If not in development, render children without the provider functionality
  // This ensures the context is still available but does nothing in production
  if (typeof window !== 'undefined' && !isDevelopmentClient()) {
    return <>{children}</>;
  }

  return (
    <DevConsoleContext.Provider
      value={{
        isOpen,
        togglePanel,
        openPanel,
        closePanel,
        activeTab,
        setActiveTab,
        serverLogs,
        clearServerLogs,
        serverLogConnected,
        consoleLogs,
        clearConsoleLogs,
        chatDebugAvailable,
      }}
    >
      {children}
    </DevConsoleContext.Provider>
  );
}
