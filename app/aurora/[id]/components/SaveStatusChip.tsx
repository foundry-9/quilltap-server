'use client'

/**
 * The page's one save status (§4 of the unification spec): *All changes saved*
 * · *Saving…* · *Could not save Personality — Retry*. Polite live region, so a
 * screen reader hears the change without being interrupted.
 *
 * @module app/aurora/[id]/components/SaveStatusChip
 */

import type { AutosaveEngine } from '@/lib/autosave/autosave-engine'
import { useAutosaveStatus } from '../hooks/useCharacterAutosave'

export function SaveStatusChip({ engine }: { engine: AutosaveEngine }) {
  const status = useAutosaveStatus(engine)
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        status.state === 'error'
          ? 'qt-border-destructive qt-text-destructive'
          : 'qt-border-default qt-text-secondary'
      }`}
      data-save-state={status.state}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          status.state === 'error'
            ? 'qt-bg-destructive'
            : status.state === 'saved'
              ? 'qt-bg-success'
              : 'qt-bg-muted-foreground'
        }`}
      />
      {status.state === 'saved' && 'All changes saved'}
      {status.state === 'editing' && 'Editing — saved when you leave the field'}
      {status.state === 'saving' && 'Saving…'}
      {status.state === 'error' && (
        <>
          Could not save {status.label} —{' '}
          <button type="button" onClick={() => void engine.retry()} className="underline font-semibold">
            Retry
          </button>
        </>
      )}
    </span>
  )
}
