'use client'

/**
 * TerminalPane - the right-side wrapper for Terminal Mode in the salon.
 *
 * Shape mirrors DocumentPane: header with focus-toggle / hide-pane / kill,
 * body is the xterm terminal sized to fill the pane.
 */

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/terminal/Terminal'
import { useTerminalSession } from '@/hooks/useTerminalSession'
import type { TerminalMode } from '../hooks/useTerminalMode'

interface TerminalPaneProps {
  sessionId: string
  chatId: string
  mode: TerminalMode
  onToggleFocusMode: () => void
  /** Hide the pane but leave the PTY alive (the inline embed becomes interactive again). */
  onHidePane: () => void | Promise<void>
  /** Kill the PTY and close the pane. */
  onKill: () => void | Promise<void>
}

export function TerminalPane({
  sessionId,
  chatId: _chatId,
  mode,
  onToggleFocusMode,
  onHidePane,
  onKill,
}: TerminalPaneProps) {
  const session = useTerminalSession(sessionId)
  const [confirmKill, setConfirmKill] = useState(false)

  // Reset the kill-confirm state when the session changes — local UI state only,
  // not a cascading render in any meaningful sense.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting transient UI state when the bound session changes
    setConfirmKill(false)
  }, [sessionId])

  const title = session.meta
    ? `Terminal — ${session.meta.shell}${session.meta.label ? ` (${session.meta.label})` : ''}`
    : 'Terminal'

  const handleKillClick = () => {
    if (!confirmKill) {
      setConfirmKill(true)
      // Auto-cancel the confirm after a few seconds so it doesn't linger.
      window.setTimeout(() => setConfirmKill(false), 4000)
      return
    }
    void onKill()
  }

  return (
    <div className="qt-doc-pane-inner flex flex-col h-full overflow-hidden qt-bg-surface">
      <div className="qt-doc-header flex items-center justify-between gap-2 px-3 py-2 border-b qt-border-default">
        <div className="qt-doc-title min-w-0 truncate text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleFocusMode}
            className="qt-icon-button p-1"
            title={mode === 'focus' ? 'Restore split layout' : 'Maximize terminal'}
            aria-label={mode === 'focus' ? 'Restore split layout' : 'Maximize terminal'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mode === 'focus' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V5H5m14 0h-4v4M5 15v4h4m6 0h4v-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M16 4h4v4M4 16v4h4m12-4v4h-4" />
              )}
            </svg>
          </button>

          <button
            type="button"
            onClick={() => void onHidePane()}
            className="qt-icon-button p-1"
            title="Close pane (terminal stays alive)"
            aria-label="Close terminal pane"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleKillClick}
            className={`qt-icon-button p-1 ${confirmKill ? 'qt-text-destructive' : 'text-red-600 hover:text-red-700'}`}
            title={confirmKill ? 'Click again to confirm: kill terminal and close pane' : 'Kill terminal and close pane'}
            aria-label="Kill terminal and close pane"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-black">
        <Terminal sessionId={sessionId} className="h-full w-full" />
      </div>
    </div>
  )
}
