'use client'

/**
 * GreenRoomPanel — the Green Room, in the Salon itself.
 *
 * While a chat opens (or a character joins with the operator watching) the
 * panel sits above the transcript and narrates: a headline, a panel
 * per character choosing their outfit that resolves into what they put on,
 * what each packed, and a running activity log. When the opening is done it
 * folds to a single "Opened" line; its disclosure keeps the record of who
 * chose what for the rest of the session. The greeting streams beneath it as
 * an ordinary turn.
 *
 * @module app/salon/[id]/components/GreenRoomPanel
 */

import { useEffect, useId, useRef, useState } from 'react'
import { OutfitSlotsPreview } from '@/components/wardrobe/OutfitSlotsPreview'
import type { GreenRoomState } from '../hooks/useGreenRoom'

function logColor(level: 'info' | 'warn' | 'error'): string {
  if (level === 'error') return 'qt-text-danger'
  if (level === 'warn') return 'qt-text-warning'
  return 'qt-text-secondary'
}

export function GreenRoomPanel({ state }: { state: GreenRoomState }) {
  const [expanded, setExpanded] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs])

  if (state.idle) return null

  const hasRecord = state.wardrobe.length > 0 || state.packed.length > 0 || state.logs.length > 0
  const open = state.running || expanded

  return (
    <section className="qt-card qt-green-room" aria-label={state.title}>
      {state.running ? (
        <div className="qt-green-room-headline" role="status" aria-live="polite">
          <span className="qt-green-room-pulse" aria-hidden="true" />
          <span className="qt-green-room-title">{state.title}</span>
          <span className="qt-green-room-status">{state.status || 'Setting the stage…'}</span>
        </div>
      ) : (
        <button
          type="button"
          className="qt-green-room-disclosure"
          aria-expanded={expanded}
          aria-controls={bodyId}
          disabled={!hasRecord}
          onClick={() => setExpanded((v) => !v)}
        >
          <span aria-hidden="true">{hasRecord ? (expanded ? '▾' : '▸') : '•'}</span>
          <span className="qt-green-room-title">{state.title}</span>
          <span>— the curtain is up.</span>
        </button>
      )}

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
