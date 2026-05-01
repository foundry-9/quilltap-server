'use client'

/**
 * TerminalSessionPicker - choose a live terminal session to bind to
 * Terminal Mode, or spawn a new one.
 *
 * Shown only when there are existing live sessions for this chat. If there
 * are none, the salon page skips the picker and spawns directly.
 */

import { BaseModal } from '@/components/ui/BaseModal'
import type { TerminalSessionMeta } from '../hooks/terminalModeApi'

interface TerminalSessionPickerProps {
  isOpen: boolean
  sessions: TerminalSessionMeta[]
  onAttach: (sessionId: string) => void
  onSpawnNew: () => void
  onClose: () => void
}

function formatStartedAt(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleString()
  } catch {
    return iso
  }
}

export default function TerminalSessionPicker({
  isOpen,
  sessions,
  onAttach,
  onSpawnNew,
  onClose,
}: Readonly<TerminalSessionPickerProps>) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Open Terminal Mode" maxWidth="md" showCloseButton>
      <div className="flex flex-col gap-3">
        <p className="text-sm qt-text-secondary">
          Pick a running terminal to bring into Terminal Mode, or fire up a fresh one.
        </p>

        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onAttach(session.id)}
                className="qt-list-row w-full text-left flex flex-col gap-0.5 px-3 py-2 rounded border qt-border-default hover:qt-bg-muted"
              >
                <span className="text-sm font-medium truncate">
                  {session.label || `Terminal — ${session.shell}`}
                </span>
                <span className="text-xs qt-text-secondary truncate">
                  {session.cwd}
                </span>
                <span className="text-xs qt-text-secondary">
                  Started {formatStartedAt(session.startedAt)}
                </span>
              </button>
            </li>
          ))}

          <li>
            <button
              type="button"
              onClick={onSpawnNew}
              className="qt-list-row w-full text-left flex items-center gap-2 px-3 py-2 rounded border qt-border-default hover:qt-bg-muted"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium">New terminal</span>
            </button>
          </li>
        </ul>
      </div>
    </BaseModal>
  )
}
