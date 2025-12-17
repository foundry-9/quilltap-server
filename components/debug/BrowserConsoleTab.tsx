"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { useDevConsole, ConsoleLogEntry } from '@/components/providers/dev-console-provider';

// Map console levels to qt-devconsole CSS classes
const levelEntryClasses: Record<ConsoleLogEntry['level'], string> = {
  error: 'qt-log-entry-error',
  warn: 'qt-log-entry-warn',
  info: 'qt-log-entry-info',
  log: 'qt-log-entry-log',
  debug: 'qt-log-entry-debug',
};

const levelLabelClasses: Record<ConsoleLogEntry['level'], string> = {
  error: 'qt-log-level-error',
  warn: 'qt-log-level-warn',
  info: 'qt-log-level-info',
  log: 'qt-log-level-log',
  debug: 'qt-log-level-debug',
};

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function formatArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
  }
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}

function isObjectArg(arg: unknown): boolean {
  return typeof arg === 'object' && arg !== null && !(arg instanceof Error);
}

function ConsoleEntry({ entry }: { entry: ConsoleLogEntry }) {
  const entryClass = levelEntryClasses[entry.level];
  const labelClass = levelLabelClasses[entry.level];

  // Check if any arg is an object (for expandable view)
  const hasObjectArgs = entry.args.some(isObjectArg);

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

        {/* Arguments */}
        <div className="qt-log-message">
          {hasObjectArgs ? (
            <div className="space-y-1">
              {entry.args.map((arg, idx) => {
                if (isObjectArg(arg)) {
                  return (
                    <details key={idx} className="qt-log-context">
                      <summary>
                        {Array.isArray(arg)
                          ? `Array(${(arg as unknown[]).length})`
                          : `Object {${Object.keys(arg as object).slice(0, 3).join(', ')}${Object.keys(arg as object).length > 3 ? '...' : ''}}`
                        }
                      </summary>
                      <pre className="whitespace-pre-wrap">
                        {formatArg(arg)}
                      </pre>
                    </details>
                  );
                }
                return (
                  <span key={idx} className="qt-log-message-text mr-2">
                    {formatArg(arg)}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="qt-log-message-text whitespace-pre-wrap break-words">
              {entry.args.map(formatArg).join(' ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type ConsoleLevel = 'error' | 'warn' | 'info' | 'log' | 'debug';

const ALL_LEVELS: ConsoleLevel[] = ['error', 'warn', 'info', 'log', 'debug'];

export default function BrowserConsoleTab() {
  const { consoleLogs, clearConsoleLogs } = useDevConsole();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [enabledLevels, setEnabledLevels] = useState<Set<ConsoleLevel>>(new Set(ALL_LEVELS));

  // Toggle a log level filter
  const toggleLevel = useCallback((level: ConsoleLevel) => {
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
  const filteredLogs = consoleLogs.filter(log => enabledLevels.has(log.level));

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
  }, [filteredLogs, autoScroll]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If within 50px of bottom, enable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  // Count by level
  const counts = consoleLogs.reduce((acc, log) => {
    acc[log.level] = (acc[log.level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="qt-devconsole">
      {/* Header */}
      <div className="qt-devconsole-header">
        <div className="qt-devconsole-status">
          <span className="qt-devconsole-status-text">
            {filteredLogs.length}{filteredLogs.length !== consoleLogs.length ? `/${consoleLogs.length}` : ''} entries
          </span>
          {counts.error && (
            <span className="qt-badge-destructive">
              {counts.error} errors
            </span>
          )}
          {counts.warn && (
            <span className="qt-badge-warning">
              {counts.warn} warnings
            </span>
          )}
        </div>
        <button
          onClick={clearConsoleLogs}
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
            <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="qt-text-xs">Auto</span>
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
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="qt-devconsole-empty-title">{consoleLogs.length === 0 ? 'No console output yet' : 'No logs match filters'}</p>
              <p className="qt-devconsole-empty-description">{consoleLogs.length === 0 ? 'Browser console.log/warn/error will appear here' : 'Try enabling more log levels'}</p>
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <ConsoleEntry key={entry.id} entry={entry} />
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
            onClick={() => toggleLevel('log')}
            className="qt-log-filter-log"
            data-active={enabledLevels.has('log')}
            title={enabledLevels.has('log') ? 'Hide log' : 'Show log'}
          >
            <span className="qt-log-filter-dot" />
            Log
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
