'use client';

import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';
import { Terminal } from './Terminal';
import { useTerminalSession } from '@/hooks/useTerminalSession';
import { showErrorToast } from '@/lib/toast';

interface TerminalEmbedProps {
  sessionId: string;
  label?: string | null;
  chatId: string;
}

/**
 * Inline terminal message wrapper for Salon chat bubbles
 *
 * Renders a collapsible terminal with header controls (pop-out, kill).
 * Collapse state persists in localStorage.
 */
export function TerminalEmbed({ sessionId, label, chatId }: TerminalEmbedProps) {
  const router = useRouter();
  const session = useTerminalSession(sessionId);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(`terminalEmbed:${sessionId}:collapsed`) === 'true';
  });

  // Persist collapse state
  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      const key = `terminalEmbed:${sessionId}:collapsed`;
      localStorage.setItem(key, String(next));
      return next;
    });
  }, [sessionId]);

  const handleKill = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/terminals/${sessionId}?action=kill`, {
        method: 'POST',
      });

      if (!res.ok) {
        showErrorToast('Failed to terminate session');
      }
    } catch (err) {
      showErrorToast('Failed to terminate session');
      console.error('Kill session error:', err);
    }
  }, [sessionId]);

  const handlePopOut = useCallback(() => {
    router.push(`/salon/${chatId}/terminal/${sessionId}`);
  }, [router, chatId, sessionId]);

  const title = label || (session.meta ? `Terminal — ${session.meta.shell}` : 'Terminal');

  return (
    <div className="qt-embed-terminal border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={toggleCollapse}
            className="qt-icon-button p-1"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </button>
          <h3 className="text-sm font-medium">{title}</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePopOut}
            className="qt-button-icon text-sm"
            title="Pop out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4m-4-6l6-6m0 0V4m0-2h2"
              />
            </svg>
          </button>

          {session.state !== 'exited' && (
            <button
              onClick={handleKill}
              className="qt-button-icon text-sm text-red-600 hover:text-red-700"
              title="Kill session"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Terminal Body */}
      {!collapsed && (
        <div className="bg-black" style={{ height: '360px' }}>
          <Terminal
            sessionId={sessionId}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}
