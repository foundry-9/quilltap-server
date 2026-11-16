'use client'

/**
 * Calliope's Atelier — the list of theme drafts.
 *
 * @module components/theme-editor/DraftList
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'
import { showInfoToast } from '@/lib/toast'
import { DeleteDraftDialog, NewDraftDialog } from './DraftDialogs'
import { FileChooser } from './assets/shared'
import { useImportThemeDraft, useThemeDraftList, type DraftDetail, type DraftImportResult } from './use-theme-drafts'

/** What a refused theme file is told: the reason, and each error the archive had. */
export interface ImportRefusal {
  fileName: string
  message: string
  errors: string[]
}

/** The refusal an import's failure amounts to. */
export function importRefusal(fileName: string, err: unknown): ImportRefusal {
  const fallback = 'The atelier could not open that file.'
  if (err instanceof ApiFetchError) {
    const info = err.info as { details?: { errors?: unknown; reason?: unknown } } | undefined
    const listed = Array.isArray(info?.details?.errors) ? info.details.errors.map(String) : []
    const reason = info?.details?.reason
    // A version 1 file is refused with one sentence; the list would only repeat it.
    if (reason === 'refused' && listed.length > 0) return { fileName, message: listed[0], errors: [] }
    if (err.status === 413) return { fileName, message: apiErrorMessage(err, 'That file is larger than a theme may be.'), errors: listed }
    if (listed.length > 0) return { fileName, message: 'This file is not a theme that would install, for these reasons:', errors: listed }
    return { fileName, message: apiErrorMessage(err, fallback), errors: [] }
  }
  return { fileName, message: err instanceof Error ? err.message : fallback, errors: [] }
}

/** Said when an imported draft could not keep the file's own id. */
export function idChangedNotice(result: DraftImportResult): string {
  return `The file calls itself “${result.bundleId}”, and that name was already taken, so this draft is “${result.draft.id}”. Install it and it arrives as “${result.draft.id}” beside the other.`
}

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
  const importDraft = useImportThemeDraft()
  const [refusal, setRefusal] = useState<ImportRefusal | null>(null)

  const openFile = async (file: File) => {
    setRefusal(null)
    try {
      const result = await importDraft.mutateAsync(file)
      if (result.idChanged) showInfoToast(idChangedNotice(result), 12000)
      onCreated(result.draft)
    } catch (err) {
      setRefusal(importRefusal(file.name, err))
    }
  }

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
        <div className="flex gap-2 flex-wrap">
          <FileChooser
            label={importDraft.isPending ? 'Opening the file…' : 'Open a theme file'}
            accept=".qtap-theme,application/zip"
            className="qt-button qt-button-secondary"
            disabled={importDraft.isPending}
            onFiles={(files) => void openFile(files[0])}
          />
          <button type="button" className="qt-button qt-button-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" className="w-4 h-4" />
            <span className="ml-1">New theme</span>
          </button>
        </div>
      </div>

      {refusal && (
        <div className="qt-alert-error flex items-start justify-between gap-3" role="alert">
          <div className="min-w-0">
            <p className="font-medium">
              “{refusal.fileName}” could not be opened. {refusal.message}
            </p>
            {refusal.errors.length > 0 && (
              <ul className="list-disc pl-5 mt-1 qt-text-small">
                {refusal.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="qt-button qt-button-ghost qt-button-sm shrink-0" onClick={() => setRefusal(null)}>
            Dismiss
          </button>
        </div>
      )}

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
