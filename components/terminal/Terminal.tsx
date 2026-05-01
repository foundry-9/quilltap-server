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

  const session = useTerminalSession(sessionId);
  const [initialized, setInitialized] = useState(false);

  // Initialize xterm on mount (lazy import to avoid SSR)
  useEffect(() => {
    if (initialized || !containerRef.current) {
      return;
    }

    (async () => {
      const { Terminal: XTermTerminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      const { SerializeAddon } = await import('@xterm/addon-serialize');

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

      term.open(containerRef.current!);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Setup ResizeObserver for responsive fitting
      resizeObserverRef.current = new ResizeObserver(() => {
        if (fitAddonRef.current && termRef.current) {
          try {
            fitAddonRef.current.fit();
            session.resize(termRef.current.cols, termRef.current.rows);
          } catch {
            // Ignore resize errors during layout thrashing
          }
        }
      });

      resizeObserverRef.current.observe(containerRef.current!);

      setInitialized(true);
    })();
  }, [initialized, rows, cols, fontSize, session]);

  // Wire session output to terminal
  useEffect(() => {
    if (!initialized || !termRef.current) {
      return;
    }

    const unsubscribe = session.onData((chunk) => {
      termRef.current.write(chunk);
    });

    return unsubscribe;
  }, [initialized, session]);

  // Wire terminal input to session
  useEffect(() => {
    if (!initialized || !termRef.current) {
      return;
    }

    const disposable = termRef.current.onData((data: string) => {
      session.send(data);
    });

    return () => {
      disposable.dispose();
    };
  }, [initialized, session]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (termRef.current) {
        termRef.current.dispose();
      }
    };
  }, []);

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
