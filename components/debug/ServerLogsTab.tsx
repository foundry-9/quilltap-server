"use client";

import { useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { useDevConsole, ServerLogEntry } from '@/components/providers/dev-console-provider';

// ANSI color code to Tailwind class mapping
const ansiColorMap: Record<number, string> = {
  // Foreground colors
  30: 'text-gray-900',      // Black
  31: 'text-red-600',        // Red
  32: 'text-green-600',    // Green
  33: 'text-yellow-600',  // Yellow
  34: 'text-blue-600',      // Blue
  35: 'text-purple-600',  // Magenta
  36: 'text-cyan-600',      // Cyan
  37: 'text-gray-700',      // White
  39: '',                                       // Default foreground
  // Bright foreground colors
  90: 'text-gray-500',      // Bright Black (Gray)
  91: 'text-red-500',        // Bright Red
  92: 'text-green-500',    // Bright Green
  93: 'text-yellow-500',  // Bright Yellow
  94: 'text-blue-500',      // Bright Blue
  95: 'text-purple-500',  // Bright Magenta
  96: 'text-cyan-500',      // Bright Cyan
  97: 'text-white',            // Bright White
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

// Map log levels to qt-devconsole CSS classes
const levelEntryClasses: Record<string, string> = {
  error: 'qt-log-entry-error',
  warn: 'qt-log-entry-warn',
  info: 'qt-log-entry-info',
  debug: 'qt-log-entry-debug',
};

const levelLabelClasses: Record<string, string> = {
  error: 'qt-log-level-error',
  warn: 'qt-log-level-warn',
  info: 'qt-log-level-info',
  debug: 'qt-log-level-debug',
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
  const level = entry.level || 'info';
  const entryClass = levelEntryClasses[level] || 'qt-log-entry-info';
  const labelClass = levelLabelClasses[level] || 'qt-log-level-info';
  const content = entry.content || entry.message || '';

  // Handle raw/info type entries (including stdout messages with ANSI codes)
  if (entry.type === 'raw' || entry.type === 'info') {
    return (
      <div className="qt-log-entry-raw">
        <AnsiText text={content} />
      </div>
    );
  }

  return (
    <div className={entryClass}>
      <div className="qt-log-entry-row">
        {/* Timestamp */}
        <span className="qt-log-timestamp">
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* Level badge */}
        <span className={labelClass}>
          {entry.level}
        </span>

        {/* Message */}
        <div className="qt-log-message">
          <span className="qt-log-message-text">
            <AnsiText text={entry.message || ''} />
          </span>

          {/* Context */}
          {entry.context && Object.keys(entry.context).length > 0 && (
            <details className="qt-log-context">
              <summary>Context</summary>
              <pre>{JSON.stringify(entry.context, null, 2)}</pre>
            </details>
          )}

          {/* Error details */}
          {entry.error && (
            <div className="qt-log-error-details">
              <div className="qt-log-error-details-title">
                {entry.error.name}: {entry.error.message}
              </div>
              {entry.error.stack && (
                <pre>{entry.error.stack}</pre>
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
    <div className="qt-devconsole">
      {/* Header */}
      <div className="qt-devconsole-header">
        <div className="qt-devconsole-status">
          <span
            className={`qt-devconsole-status-dot ${
              serverLogConnected ? 'qt-devconsole-status-dot-connected' : 'qt-devconsole-status-dot-disconnected'
            }`}
            title={serverLogConnected ? 'Connected' : 'Disconnected'}
          />
          <span className="qt-devconsole-status-text">
            {serverLogConnected ? 'Live' : 'Reconnecting...'}
          </span>
          <span className="qt-devconsole-status-text">
            ({filteredLogs.length}{filteredLogs.length !== serverLogs.length ? `/${serverLogs.length}` : ''} entries)
          </span>
        </div>
        <button
          onClick={clearServerLogs}
          className="qt-button qt-button-ghost qt-button-sm"
        >
          Clear
        </button>
      </div>

      {/* Logs container with scroll buttons */}
      <div className="qt-devconsole-content">
        {/* Scroll to top button */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={scrollToTop}
            className="qt-devconsole-scroll-btn qt-devconsole-scroll-top qt-button qt-button-icon border border-border shadow-md"
            title="Scroll to top"
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}

        {/* Scroll to bottom button (with auto-scroll indicator) */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="qt-devconsole-scroll-btn qt-devconsole-scroll-bottom qt-button qt-button-icon border border-border shadow-md flex items-center gap-1"
            title="Scroll to bottom and enable auto-scroll"
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="text-xs text-muted-foreground">Auto</span>
          </button>
        )}

        {/* Auto-scroll indicator when enabled */}
        {autoScroll && filteredLogs.length > 0 && (
          <div className="qt-devconsole-autoscroll qt-alert-success">
            Auto-scroll
          </div>
        )}

        {/* Logs */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="qt-devconsole-logs"
        >
          {filteredLogs.length === 0 ? (
            <div className="qt-devconsole-empty">
              <svg
                className="qt-devconsole-empty-icon"
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
              <p className="qt-devconsole-empty-title">{serverLogs.length === 0 ? 'No server logs yet' : 'No logs match filters'}</p>
              <p className="qt-devconsole-empty-description">{serverLogs.length === 0 ? 'Logs from combined.log will appear here' : 'Try enabling more log levels'}</p>
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <LogEntry key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>

      {/* Footer - Level filters */}
      <div className="qt-devconsole-footer">
        <div className="qt-log-filters">
          <span className="qt-log-filters-label">Filter:</span>
          <button
            onClick={() => toggleLevel('error')}
            className="qt-log-filter-error"
            data-active={enabledLevels.has('error')}
            title={enabledLevels.has('error') ? 'Hide errors' : 'Show errors'}
          >
            <span className="qt-log-filter-dot" />
            Error
          </button>
          <button
            onClick={() => toggleLevel('warn')}
            className="qt-log-filter-warn"
            data-active={enabledLevels.has('warn')}
            title={enabledLevels.has('warn') ? 'Hide warnings' : 'Show warnings'}
          >
            <span className="qt-log-filter-dot" />
            Warn
          </button>
          <button
            onClick={() => toggleLevel('info')}
            className="qt-log-filter-info"
            data-active={enabledLevels.has('info')}
            title={enabledLevels.has('info') ? 'Hide info' : 'Show info'}
          >
            <span className="qt-log-filter-dot" />
            Info
          </button>
          <button
            onClick={() => toggleLevel('debug')}
            className="qt-log-filter-debug"
            data-active={enabledLevels.has('debug')}
            title={enabledLevels.has('debug') ? 'Hide debug' : 'Show debug'}
          >
            <span className="qt-log-filter-dot" />
            Debug
          </button>
        </div>
      </div>
    </div>
  );
}
