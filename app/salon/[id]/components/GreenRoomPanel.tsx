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
    <section className="qt-card mx-auto my-3 w-full max-w-3xl p-3" aria-label={state.title}>
      {state.running ? (
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span className="qt-bg-accent inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full" aria-hidden="true" />
          <span className="qt-text-primary text-sm font-semibold">{state.title}</span>
          <span className="qt-text-secondary text-sm">{state.status || 'Setting the stage…'}</span>
        </div>
      ) : (
        <button
          type="button"
          className="qt-text-secondary flex w-full items-center gap-2 text-left text-sm"
          aria-expanded={expanded}
          aria-controls={bodyId}
          disabled={!hasRecord}
          onClick={() => setExpanded((v) => !v)}
        >
          <span aria-hidden="true">{hasRecord ? (expanded ? '▾' : '▸') : '•'}</span>
          <span className="qt-text-primary font-semibold">{state.title}</span>
          <span>— the curtain is up.</span>
        </button>
      )}

      {open && hasRecord && (
        <div id={bodyId} className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
          {state.wardrobe.map((panel) => (
            <div key={panel.characterId} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {panel.slots === null && (
                  <span
                    className="border-t-transparent inline-block h-3 w-3 animate-spin rounded-full border-2 border-current opacity-70"
                    aria-hidden="true"
                  />
                )}
                <span className="qt-text-primary text-sm font-semibold">{panel.characterName}</span>
                <span className="qt-text-secondary text-xs">
                  {panel.slots === null ? 'consulting the wardrobe…' : 'is wearing'}
                </span>
              </div>
              {panel.slots !== null && <OutfitSlotsPreview slots={panel.slots} />}
            </div>
          ))}

          {state.packed.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {state.packed.map((p) => (
                <li key={p.characterId} className="qt-text-secondary">
                  <span className="qt-text-primary font-semibold">{p.characterName}</span>{' '}
                  {p.items.length > 0 ? `carries ${p.items.join(', ')}` : 'carries nothing at all'}
                </li>
              ))}
            </ul>
          )}

          {state.logs.length > 0 && (
            <div className="qt-divider border-t pt-2">
              <div className="qt-text-secondary mb-1 text-xs uppercase tracking-wide">Activity</div>
              <div ref={logRef} className="max-h-40 overflow-y-auto pr-1">
                <ul className="flex flex-col gap-1 text-sm">
                  {state.logs.map((entry, i) => (
                    <li key={`${entry.ts}-${i}`} className={logColor(entry.level)}>
                      <span className="qt-text-secondary mr-2 tabular-nums">
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
