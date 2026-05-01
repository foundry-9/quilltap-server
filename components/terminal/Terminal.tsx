'use client';

import { useEffect, useRef, useState } from 'react';
import { useTerminalSession } from '@/hooks/useTerminalSession';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  className?: string;
  rows?: number;
  cols?: number;
  fontSize?: number;
  onClose?: () => void;
}

/**
 * xterm.js terminal component with WebSocket integration
 *
 * Lazily imports xterm packages to avoid SSR issues. Applies theme from
 * CSS variables (--qt-terminal-bg, --qt-terminal-fg, etc).
 * Manages ResizeObserver for responsive resizing.
 */
export function Terminal({
  sessionId,
  className = '',
  rows = 24,
  cols = 80,
  fontSize = 13,
  onClose,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initStartedRef = useRef(false);

  const session = useTerminalSession(sessionId);
  const [initialized, setInitialized] = useState(false);

  // Keep a ref to the latest session so closures inside long-lived xterm
  // listeners always reach the current callbacks.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Initialize xterm on mount (lazy import to avoid SSR).
  // Ref-guarded so React StrictMode's double-invoke (and any in-flight render)
  // can't double-attach two xterm instances into the same container.
  useEffect(() => {
    if (initStartedRef.current || !containerRef.current) {
      return;
    }
    initStartedRef.current = true;

    let cancelled = false;
    let createdTerm: any = null;
    let createdObserver: ResizeObserver | null = null;

    (async () => {
      const { Terminal: XTermTerminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      const { SerializeAddon } = await import('@xterm/addon-serialize');

      if (cancelled || !containerRef.current) return;

      const theme = getTerminalTheme();

      const term = new XTermTerminal({
        rows,
        cols,
        fontSize,
        theme,
        scrollback: 1000,
        rightClickSelectsWord: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const serializeAddon = new SerializeAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(serializeAddon);

      // Try to load Canvas renderer if available (non-SSR)
      try {
        const { CanvasAddon } = await import('@xterm/addon-canvas');
        if (canvasSupported()) {
          term.loadAddon(new CanvasAddon());
        }
      } catch {
        // Canvas addon not available or not supported — fall back to DOM
      }

      if (cancelled || !containerRef.current) {
        try { term.dispose(); } catch { /* noop */ }
        return;
      }

      term.open(containerRef.current);
      try { fitAddon.fit(); } catch { /* noop */ }
      try { term.focus(); } catch { /* noop */ }

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      createdTerm = term;

      // Setup ResizeObserver for responsive fitting. We avoid closing over
      // `session` here so its identity changes don't matter; the resize call
      // routes through the latest send via the ref-stable callback.
      const observer = new ResizeObserver(() => {
        if (fitAddonRef.current && termRef.current) {
          try {
            fitAddonRef.current.fit();
            sessionRef.current?.resize(termRef.current.cols, termRef.current.rows);
          } catch {
            // Ignore resize errors during layout thrashing
          }
        }
      });
      observer.observe(containerRef.current);
      resizeObserverRef.current = observer;
      createdObserver = observer;

      setInitialized(true);
    })().catch(() => {
      // Swallow init errors — the next mount can retry by clearing the ref
      initStartedRef.current = false;
    });

    return () => {
      cancelled = true;
      if (createdObserver) {
        try { createdObserver.disconnect(); } catch { /* noop */ }
      }
      if (createdTerm) {
        try { createdTerm.dispose(); } catch { /* noop */ }
      }
      if (resizeObserverRef.current === createdObserver) {
        resizeObserverRef.current = null;
      }
      if (termRef.current === createdTerm) {
        termRef.current = null;
      }
      initStartedRef.current = false;
    };
  }, [rows, cols, fontSize]);

  // Wire session output → terminal. Stable: reads the live session via ref.
  useEffect(() => {
    if (!initialized || !termRef.current) return;

    const unsubscribe = sessionRef.current.onData((chunk) => {
      termRef.current?.write(chunk);
    });

    return unsubscribe;
  }, [initialized]);

  // Wire xterm input → session. Stable: reads the live session via ref.
  useEffect(() => {
    if (!initialized || !termRef.current) return;

    const disposable = termRef.current.onData((data: string) => {
      sessionRef.current.send(data);
    });

    return () => {
      try { disposable.dispose(); } catch { /* noop */ }
    };
  }, [initialized]);

  // Refocus xterm once we know it's live so the user can type without an
  // extra click after the prompt streams in.
  useEffect(() => {
    if (initialized && session.state === 'live' && termRef.current) {
      try { termRef.current.focus(); } catch { /* noop */ }
    }
  }, [initialized, session.state]);

  // Handle session exit
  useEffect(() => {
    if (session.state !== 'exited' || !termRef.current) {
      return;
    }

    const code = session.exitInfo?.code ?? 'unknown';
    const signal = session.exitInfo?.signal;
    const line = signal ? `\r\n[session ended — signal ${signal}]\r\n` : `\r\n[session ended — exit code ${code}]\r\n`;

    termRef.current.write(line);

    // Disable input after exit
    if (termRef.current._input) {
      termRef.current._input.disabled = true;
    }
  }, [session.state, session.exitInfo]);

  return (
    <div className={`relative bg-black ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
        data-testid="terminal-container"
      />

      {session.state === 'exited' && onClose && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
          Closed
        </div>
      )}
    </div>
  );
}

function getTerminalTheme() {
  if (typeof document === 'undefined') {
    // SSR fallback
    return {};
  }

  const root = document.documentElement;
  const style = getComputedStyle(root);

  const getColor = (variable: string): string => {
    const val = style.getPropertyValue(variable).trim();
    return val || '#000000';
  };

  return {
    background: getColor('--qt-terminal-bg'),
    foreground: getColor('--qt-terminal-fg'),
    cursor: getColor('--qt-terminal-cursor'),
    selection: getColor('--qt-terminal-selection'),
    black: getColor('--qt-terminal-ansi-black'),
    red: getColor('--qt-terminal-ansi-red'),
    green: getColor('--qt-terminal-ansi-green'),
    yellow: getColor('--qt-terminal-ansi-yellow'),
    blue: getColor('--qt-terminal-ansi-blue'),
    magenta: getColor('--qt-terminal-ansi-magenta'),
    cyan: getColor('--qt-terminal-ansi-cyan'),
    white: getColor('--qt-terminal-ansi-white'),
    brightBlack: getColor('--qt-terminal-ansi-bright-black'),
    brightRed: getColor('--qt-terminal-ansi-bright-red'),
    brightGreen: getColor('--qt-terminal-ansi-bright-green'),
    brightYellow: getColor('--qt-terminal-ansi-bright-yellow'),
    brightBlue: getColor('--qt-terminal-ansi-bright-blue'),
    brightMagenta: getColor('--qt-terminal-ansi-bright-magenta'),
    brightCyan: getColor('--qt-terminal-ansi-bright-cyan'),
    brightWhite: getColor('--qt-terminal-ansi-bright-white'),
  };
}

function canvasSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl') || canvas.getContext('webgl2');
    return ctx !== null;
  } catch {
    return false;
  }
}
