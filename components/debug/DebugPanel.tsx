'use client';

import { useEffect, useRef } from 'react';
import { useDebug } from '@/components/providers/debug-provider';
import { DebugEntryRow } from './DebugEntryRow';

/**
 * Main debug panel component
 * Displays API request/response history with auto-scroll functionality
 * Handles layout, entry management, and basic legend
 */
export default function DebugPanel() {
  const { entries, clearEntries } = useDebug();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="qt-devconsole">
      {/* Header */}
      <div className="qt-devconsole-header">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          <h2 className="text-sm font-semibold text-foreground">
            API Debug
          </h2>
          <span className="qt-text-xs">
            ({entries.length} entries)
          </span>
        </div>
        <button
          onClick={clearEntries}
          className="qt-button qt-button-ghost qt-button-sm"
          title="Clear all entries"
        >
          Clear
        </button>
      </div>

      {/* Entries list */}
      <div
        ref={scrollRef}
        className="qt-devconsole-content overflow-y-auto p-3"
      >
        {entries.length === 0 ? (
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
            <p className="qt-devconsole-empty-title">No API traffic yet</p>
            <p className="qt-devconsole-empty-description">Send a message to see requests and responses</p>
          </div>
        ) : (
          entries.map((entry) => (
            <DebugEntryRow key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {/* Legend */}
      <div className="qt-devconsole-footer">
        <div className="qt-log-filters">
          <span className="flex items-center gap-1">
            <span className="qt-debug-status qt-debug-status-streaming" style={{ animation: 'none' }} /> Outgoing
          </span>
          <span className="flex items-center gap-1">
            <span className="qt-debug-status qt-debug-status-complete" /> Incoming
          </span>
          <span className="flex items-center gap-1">
            <span className="qt-debug-status qt-debug-status-pending" /> Pending
          </span>
        </div>
      </div>
    </div>
  );
}
