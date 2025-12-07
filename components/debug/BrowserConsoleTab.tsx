"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { useDevConsole, ConsoleLogEntry } from '@/components/providers/dev-console-provider';

// Log level colors
const levelColors: Record<ConsoleLogEntry['level'], { bg: string; text: string; border: string }> = {
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
  log: {
    bg: 'bg-gray-50 dark:bg-slate-800/50',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-l-gray-400',
  },
  debug: {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    text: 'text-purple-700 dark:text-purple-400',
    border: 'border-l-purple-400',
  },
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
  const colors = levelColors[entry.level];

  // Check if any arg is an object (for expandable view)
  const hasObjectArgs = entry.args.some(isObjectArg);

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

        {/* Arguments */}
        <div className="flex-1 min-w-0">
          {hasObjectArgs ? (
            <div className="space-y-1">
              {entry.args.map((arg, idx) => {
                if (isObjectArg(arg)) {
                  return (
                    <details key={idx} className="group">
                      <summary className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white">
                        {Array.isArray(arg)
                          ? `Array(${(arg as unknown[]).length})`
                          : `Object {${Object.keys(arg as object).slice(0, 3).join(', ')}${Object.keys(arg as object).length > 3 ? '...' : ''}}`
                        }
                      </summary>
                      <pre className="mt-1 text-xs font-mono bg-gray-100 dark:bg-slate-800 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                        {formatArg(arg)}
                      </pre>
                    </details>
                  );
                }
                return (
                  <span key={idx} className="text-sm text-gray-800 dark:text-gray-200 mr-2">
                    {formatArg(arg)}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {filteredLogs.length}{filteredLogs.length !== consoleLogs.length ? `/${consoleLogs.length}` : ''} entries
          </span>
          {counts.error && (
            <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded">
              {counts.error} errors
            </span>
          )}
          {counts.warn && (
            <span className="text-xs px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 rounded">
              {counts.warn} warnings
            </span>
          )}
        </div>
        <button
          onClick={clearConsoleLogs}
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
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">{consoleLogs.length === 0 ? 'No console output yet' : 'No logs match filters'}</p>
              <p className="text-xs mt-1">{consoleLogs.length === 0 ? 'Browser console.log/warn/error will appear here' : 'Try enabling more log levels'}</p>
            </div>
          ) : (
            filteredLogs.map((entry) => (
              <ConsoleEntry key={entry.id} entry={entry} />
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
            onClick={() => toggleLevel('log')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('log')
                ? 'bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-300'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('log') ? 'Hide log' : 'Show log'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('log') ? 'bg-gray-500' : 'bg-gray-400'}`} />
            Log
          </button>
          <button
            onClick={() => toggleLevel('debug')}
            className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              enabledLevels.has('debug')
                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500 opacity-50'
            }`}
            title={enabledLevels.has('debug') ? 'Hide debug' : 'Show debug'}
          >
            <span className={`w-2 h-2 rounded-full ${enabledLevels.has('debug') ? 'bg-purple-500' : 'bg-gray-400'}`} />
            Debug
          </button>
        </div>
      </div>
    </div>
  );
}
