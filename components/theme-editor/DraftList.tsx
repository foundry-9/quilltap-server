'use client'

/**
 * Calliope's Atelier — the list of theme drafts.
 *
 * @module components/theme-editor/DraftList
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { DeleteDraftDialog, NewDraftDialog } from './DraftDialogs'
import { useThemeDraftList, type DraftDetail } from './use-theme-drafts'

interface DraftListProps {
  onOpen: (id: string) => void
  onCreated: (draft: DraftDetail) => void
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function DraftList({ onOpen, onCreated }: DraftListProps) {
  const { data: drafts, isLoading, error } = useThemeDraftList()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="qt-heading-2">Calliope&rsquo;s Atelier</h1>
          <p className="qt-text-small qt-text-secondary mt-1">
            Where themes are cut and fitted. Every change is worn by the whole of Quilltap at once while you work, and nothing is
            installed until you say so.
          </p>
        </div>
        <button type="button" className="qt-button qt-button-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" className="w-4 h-4" />
          <span className="ml-1">New theme</span>
        </button>
      </div>

      {isLoading && <p className="qt-text-small qt-text-muted">Fetching the pattern books…</p>}
      {error && (
        <p role="alert" className="qt-text-small qt-text-destructive">
          {apiErrorMessage(error, 'The drafts could not be fetched.')}
        </p>
      )}
      {drafts && drafts.length === 0 && (
        <div className="qt-card p-6 text-center">
          <p className="qt-text">The atelier stands empty.</p>
          <p className="qt-text-small qt-text-secondary mt-1">Commission a new theme to begin, from a blank canvas or a copy of one you admire.</p>
        </div>
      )}
      {drafts && drafts.length > 0 && (
        <ul className="space-y-2" aria-label="Theme drafts">
          {drafts.map((draft) => (
            <li key={draft.id} className="qt-card p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium qt-text truncate">{draft.name}</p>
                <p className="qt-text-xs qt-text-secondary">
                  Last changed {formatWhen(draft.updatedAt)} ·{' '}
                  <span className={draft.errorCount > 0 ? 'qt-text-destructive' : undefined}>
                    {draft.errorCount} {draft.errorCount === 1 ? 'error' : 'errors'}
                  </span>
                  {', '}
                  <span className={draft.warningCount > 0 ? 'qt-text-warning' : undefined}>
                    {draft.warningCount} {draft.warningCount === 1 ? 'warning' : 'warnings'}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={() => onOpen(draft.id)}>
                  Open <span className="sr-only">{draft.name}</span>
                </button>
                <button
                  type="button"
                  className="qt-button qt-button-ghost qt-button-sm"
                  aria-label={`Delete ${draft.name}`}
                  onClick={() => setDeleting({ id: draft.id, name: draft.name })}
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NewDraftDialog
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreated={(draft) => {
          setCreating(false)
          onCreated(draft)
        }}
      />
      <DeleteDraftDialog draft={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
    </div>
  )
}
