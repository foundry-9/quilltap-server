"use client";

import { useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { useDevConsole, ServerLogEntry } from '@/components/providers/dev-console-provider';

// ANSI color code to Tailwind class mapping
const ansiColorMap: Record<number, string> = {
  // Foreground colors
  30: 'text-gray-900 dark:text-gray-100',      // Black
  31: 'text-red-600 dark:text-red-400',        // Red
  32: 'text-green-600 dark:text-green-400',    // Green
  33: 'text-yellow-600 dark:text-yellow-400',  // Yellow
  34: 'text-blue-600 dark:text-blue-400',      // Blue
  35: 'text-purple-600 dark:text-purple-400',  // Magenta
  36: 'text-cyan-600 dark:text-cyan-400',      // Cyan
  37: 'text-gray-700 dark:text-gray-300',      // White
  39: '',                                       // Default foreground
  // Bright foreground colors
  90: 'text-gray-500 dark:text-gray-400',      // Bright Black (Gray)
  91: 'text-red-500 dark:text-red-300',        // Bright Red
  92: 'text-green-500 dark:text-green-300',    // Bright Green
  93: 'text-yellow-500 dark:text-yellow-300',  // Bright Yellow
  94: 'text-blue-500 dark:text-blue-300',      // Bright Blue
  95: 'text-purple-500 dark:text-purple-300',  // Bright Magenta
  96: 'text-cyan-500 dark:text-cyan-300',      // Bright Cyan
  97: 'text-white dark:text-white',            // Bright White
};

// Text style codes
const ansiStyleMap: Record<number, string> = {
  1: 'font-bold',
  2: 'opacity-60',      // Dim
  3: 'italic',
  4: 'underline',
  22: '',               // Normal intensity (reset bold/dim)
  23: '',               // Not italic
  24: '',               // Not underlined
};

interface AnsiSpan {
  text: string;
  classes: string[];
}

/**
 * Parse ANSI escape codes and return styled spans
 */
function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  // Match ANSI escape sequences: ESC[ followed by numbers separated by ; and ending with m
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let currentClasses: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        spans.push({ text: textBefore, classes: [...currentClasses] });
      }
    }

    // Parse the codes
    const codes = match[1].split(';').map(Number).filter(n => !isNaN(n));

    for (const code of codes) {
      if (code === 0) {
        // Reset all styles
        currentClasses = [];
      } else if (ansiColorMap[code] !== undefined) {
        // Remove any existing color class and add new one
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
        if (ansiColorMap[code]) {
          currentClasses.push(ansiColorMap[code]);
        }
      } else if (ansiStyleMap[code] !== undefined) {
        if (code === 22 || code === 23 || code === 24) {
          // Reset specific style
          if (code === 22) currentClasses = currentClasses.filter(c => c !== 'font-bold' && c !== 'opacity-60');
          if (code === 23) currentClasses = currentClasses.filter(c => c !== 'italic');
          if (code === 24) currentClasses = currentClasses.filter(c => c !== 'underline');
        } else if (ansiStyleMap[code]) {
          currentClasses.push(ansiStyleMap[code]);
        }
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), classes: [...currentClasses] });
  }

  return spans;
}

/**
 * Render text with ANSI color codes as styled spans
 */
function AnsiText({ text }: { text: string }): ReactNode {
  // Check if text contains ANSI codes
  if (!text.includes('\x1b[')) {
    return <>{text}</>;
  }

  const spans = parseAnsi(text);

  return (
    <>
      {spans.map((span, idx) => (
        span.classes.length > 0 ? (
          <span key={idx} className={span.classes.join(' ')}>{span.text}</span>
        ) : (
          <span key={idx}>{span.text}</span>
        )
      ))}
    </>
  );
}

// Log level colors
const levelColors: Record<string, { bg: string; text: string; border: string }> = {
  error: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-l-red-500',
  },
  warn: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    text: 'text-yellow-700 dark:text-yellow-400',
    border: 'border-l-yellow-500',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-l-blue-500',
  },
  debug: {
    bg: 'bg-gray-50 dark:bg-slate-800/50',
    text: 'text-gray-600 dark:text-gray-400',
    border: 'border-l-gray-400',
  },
};

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  } catch {
    return timestamp;
  }
}

function LogEntry({ entry }: { entry: ServerLogEntry }) {
  const colors = levelColors[entry.level || 'info'] || levelColors.info;
  const content = entry.content || entry.message || '';

  // Handle raw/info type entries (including stdout messages with ANSI codes)
  if (entry.type === 'raw' || entry.type === 'info') {
    return (
      <div className="px-3 py-1.5 text-xs font-mono text-gray-600 dark:text-gray-300 border-b border-gray-100 dark:border-slate-800">
        <AnsiText text={content} />
      </div>
    );
  }

  return (
    <div className={`border-l-4 ${colors.border} ${colors.bg} px-3 py-2 border-b border-gray-100 dark:border-slate-800`}>
      <div className="flex items-start gap-2">
        {/* Timestamp */}
        <span className="text-xs font-mono text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* Level badge */}
        <span className={`text-xs font-semibold uppercase ${colors.text} flex-shrink-0 w-12`}>
          {entry.level}
        </span>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-gray-800 dark:text-gray-200">
            <AnsiText text={entry.message || ''} />
          </span>

          {/* Context */}
          {entry.context && Object.keys(entry.context).length > 0 && (
            <details className="mt-1">
              <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                Context
              </summary>
              <pre className="mt-1 text-xs font-mono bg-gray-100 dark:bg-slate-800 p-2 rounded overflow-x-auto">
                {JSON.stringify(entry.context, null, 2)}
              </pre>
            </details>
          )}

          {/* Error details */}
          {entry.error && (
            <div className="mt-1 p-2 bg-red-100 dark:bg-red-900/30 rounded text-xs">
              <div className="font-semibold text-red-700 dark:text-red-400">
                {entry.error.name}: {entry.error.message}
              </div>
              {entry.error.stack && (
                <pre className="mt-1 text-xs font-mono text-red-600 dark:text-red-300 whitespace-pre-wrap overflow-x-auto">
                  {entry.error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type ServerLogLevel = 'error' | 'warn' | 'info' | 'debug';

const ALL_LEVELS: ServerLogLevel[] = ['error', 'warn', 'info', 'debug'];

export default function ServerLogsTab() {
  const { serverLogs, clearServerLogs, serverLogConnected } = useDevConsole();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [enabledLevels, setEnabledLevels] = useState<Set<ServerLogLevel>>(new Set(ALL_LEVELS));

  // Toggle a log level filter
  const toggleLevel = useCallback((level: ServerLogLevel) => {
    setEnabledLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) {
        // Don't allow disabling all levels
        if (next.size > 1) {
          next.delete(level);
        }
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  // Filter logs by enabled levels
  const filteredLogs = serverLogs.filter(log => {
    // Always show raw/info type entries
    if (log.type === 'raw' || log.type === 'info') return true;
    // Filter by level
    return enabledLevels.has((log.level || 'info') as ServerLogLevel);
  });

  // Scroll to top
  const scrollToTop = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setAutoScroll(false);
    }
  }, []);

  // Scroll to bottom and enable auto-scroll
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  // Auto-scroll to bottom when new entries arrive (if enabled)
  useEffect(() => {
    if (scrollRef.current && autoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [serverLogs, autoScroll]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If within 50px of bottom, enable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              serverLogConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`}
            title={serverLogConnected ? 'Connected' : 'Disconnected'}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {serverLogConnected ? 'Live' : 'Reconnecting...'}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            ({filteredLogs.length}{filteredLogs.length !== serverLogs.length ? `/${serverLogs.length}` : ''} entries)
          </span>
        </div>
        <button
          onClick={clearServerLogs}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
        >
          Clear
        </button>
      </div>

      {/* Logs container with scroll buttons */}
      <div className="flex-1 relative overflow-hidden">
        {/* Scroll to top button */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={scrollToTop}
            className="absolute top-2 right-2 z-10 p-1.5 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-md shadow-md hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            title="Scroll to top"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}

        {/* Scroll to bottom button (with auto-scroll indicator) */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-2 right-2 z-10 p-1.5 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-md shadow-md hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors flex items-center gap-1"
            title="Scroll to bottom and enable auto-scroll"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-xs text-gray-500 dark:text-gray-400">Auto</span>
          </button>
        )}

        {/* Auto-scroll indicator when enabled */}
        {autoScroll && filteredLogs.length > 0 && (
          <div className="absolute bottom-2 right-2 z-10 px-2 py-1 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-md text-xs text-green-700 dark:text-green-400">
            Auto-scroll
          </div>
        )}

        {/* Logs */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto bg-gray-50 dark:bg-slate-900"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <svg
                className="w-12 h-12 mb-3 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm">{serverLogs.length === 0 ? 'No server logs yet' : 'No logs match filters'}</p>
              <p className="text-xs mt-1">{serverLogs.length === 0 ? 'Logs from combined.log will appear here' : 'Try enabling more log levels'}</p>
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <LogEntry key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>

      {/* Footer - Level filters */}
      <div className="px-4 py-2 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-center gap-2 text-xs">
          <span className="text-gray-400 dark:text-gray-500 mr-1">Filter:</span>
          <button
            onClick={() => toggleLevel('error')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('error')
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('error') ? 'Hide errors' : 'Show errors'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('error') ? 'bg-red-500' : 'bg-gray-400'}`} />
            Error
          </button>
          <button
            onClick={() => toggleLevel('warn')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('warn')
                ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('warn') ? 'Hide warnings' : 'Show warnings'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('warn') ? 'bg-yellow-500' : 'bg-gray-400'}`} />
            Warn
          </button>
          <button
            onClick={() => toggleLevel('info')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('info')
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('info') ? 'Hide info' : 'Show info'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('info') ? 'bg-blue-500' : 'bg-gray-400'}`} />
            Info
          </button>
          <button
            onClick={() => toggleLevel('debug')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('debug')
                ? 'bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-300'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('debug') ? 'Hide debug' : 'Show debug'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('debug') ? 'bg-gray-500' : 'bg-gray-400'}`} />
            Debug
          </button>
        </div>
      </div>
    </div>
  );
}
