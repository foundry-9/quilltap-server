'use client'

/**
 * GreenRoomPanel — the Green Room, in the Salon itself.
 *
 * While a chat opens (or a character joins with the operator watching) the
 * panel is pinned above the transcript and narrates: a headline, a panel per
 * character choosing their outfit that resolves into what they put on, what
 * each packed, and a running activity log. When the opening is done it folds
 * to a single "curtain is up" line.
 *
 * The pinned panel carries a close button. Closing it **docks** the room: the
 * same panel, collapsed, renders inside the transcript at the head of its part
 * of the conversation and scrolls with it, its disclosure still holding the
 * record of who chose what. It is a UI record only — never sent to a model.
 *
 * @module app/salon/[id]/components/GreenRoomPanel
 */

import { useEffect, useId, useRef } from 'react'
import { OutfitSlotsPreview } from '@/components/wardrobe/OutfitSlotsPreview'
import type { GreenRoomState } from '../hooks/useGreenRoom'

function logColor(level: 'info' | 'warn' | 'error'): string {
  if (level === 'error') return 'qt-text-danger'
  if (level === 'warn') return 'qt-text-warning'
  return 'qt-text-secondary'
}

interface GreenRoomPanelProps {
  state: GreenRoomState
  /** Flip the record's disclosure. */
  onToggle: (id: string) => void
  /** Close the pinned panel, docking it in the transcript. Absent on a docked card. */
  onClose?: (id: string) => void
}

export function GreenRoomPanel({ state, onToggle, onClose }: GreenRoomPanelProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs])

  const hasRecord = state.wardrobe.length > 0 || state.packed.length > 0 || state.logs.length > 0
  // A pinned, running room shows its working; a docked one only on request.
  const open = state.expanded || (state.running && !state.docked)

  return (
    <section
      className={`qt-card qt-green-room${state.docked ? ' qt-green-room-docked' : ''}`}
      aria-label={state.title}
    >
      <div className="qt-green-room-header">
        {state.running ? (
          <div className="qt-green-room-headline" role="status" aria-live="polite">
            {state.docked && hasRecord && (
              <button
                type="button"
                className="qt-green-room-toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={open ? 'Hide the Green Room record' : 'Show the Green Room record'}
                onClick={() => onToggle(state.id)}
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
              </button>
            )}
            <span className="qt-green-room-pulse" aria-hidden="true" />
            <span className="qt-green-room-title">{state.title}</span>
            <span className="qt-green-room-status">{state.status || 'Setting the stage…'}</span>
          </div>
        ) : (
          <button
            type="button"
            className="qt-green-room-disclosure"
            aria-expanded={open}
            aria-controls={bodyId}
            disabled={!hasRecord}
            onClick={() => onToggle(state.id)}
          >
            <span aria-hidden="true">{hasRecord ? (open ? '▾' : '▸') : '•'}</span>
            <span className="qt-green-room-title">{state.title}</span>
            <span>— the curtain is up.</span>
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="qt-green-room-close"
            aria-label="Close the Green Room; its record stays in the conversation"
            title="Close — the record stays in the conversation"
            onClick={() => onClose(state.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {open && hasRecord && (
        <div id={bodyId} className="qt-green-room-body">
          {state.wardrobe.map((panel) => (
            <div key={panel.characterId} className="qt-green-room-character">
              <div className="qt-green-room-character-line">
                {panel.slots === null && <span className="qt-green-room-spinner" aria-hidden="true" />}
                <span className="qt-green-room-character-name">{panel.characterName}</span>
                <span className="qt-green-room-character-note">
                  {panel.slots === null ? 'consulting the wardrobe…' : 'is wearing'}
                </span>
              </div>
              {panel.slots !== null && <OutfitSlotsPreview slots={panel.slots} />}
            </div>
          ))}

          {state.packed.length > 0 && (
            <ul className="qt-green-room-packed">
              {state.packed.map((p) => (
                <li key={p.characterId}>
                  <span className="qt-green-room-character-name">{p.characterName}</span>{' '}
                  {p.items.length > 0 ? `carries ${p.items.join(', ')}` : 'carries nothing at all'}
                </li>
              ))}
            </ul>
          )}

          {state.logs.length > 0 && (
            <div className="qt-green-room-activity">
              <div className="qt-green-room-activity-label">Activity</div>
              <div ref={logRef} className="qt-green-room-log">
                <ul className="qt-green-room-log-list">
                  {state.logs.map((entry, i) => (
                    <li key={`${entry.ts}-${i}`} className={logColor(entry.level)}>
                      <span className="qt-green-room-log-time">
                        {new Date(entry.ts).toLocaleTimeString()}
                      </span>
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default GreenRoomPanel
