'use client'

/**
 * Calliope's Atelier — the theme-editor workspace tab.
 *
 * The list of drafts, or one draft open for editing. The panel wears the
 * house default theme (`data-theme="default"`) and its own light/dark class,
 * so the editor stays legible while the rest of Quilltap previews the draft.
 * Re-opening the tab with a draft id in its payload opens that draft.
 *
 * @module app/calliope/ThemeEditorView
 */

import { useState } from 'react'
import { useTheme } from '@/components/providers/theme-provider'
import { DraftEditor } from '@/components/theme-editor/DraftEditor'
import { DraftList } from '@/components/theme-editor/DraftList'
import type { EditorMode } from '@/components/theme-editor/model'
import { useThemeDraft } from '@/components/theme-editor/use-theme-drafts'
import { apiErrorMessage } from '@/lib/query/fetcher'
import type { ThemeEditorTabPayload } from '@/lib/workspace/types'

interface ThemeEditorViewProps {
  payload?: ThemeEditorTabPayload
}

function OpenDraft({ id, mode, onModeChange, onBack }: { id: string; mode: EditorMode; onModeChange: (m: EditorMode) => void; onBack: () => void }) {
  const { data, isLoading, error } = useThemeDraft(id)
  if (isLoading) return <p className="p-4 qt-text-small qt-text-muted">Unrolling the draft…</p>
  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-3">
        <p role="alert" className="qt-text-small qt-text-destructive">{apiErrorMessage(error, 'That draft could not be found.')}</p>
        <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onBack}>All drafts</button>
      </div>
    )
  }
  return <DraftEditor detail={data} mode={mode} onModeChange={onModeChange} onBack={onBack} />
}

export function ThemeEditorView({ payload }: ThemeEditorViewProps) {
  const { resolvedColorMode } = useTheme()
  const requested = payload?.draftId ?? null
  const [selected, setSelected] = useState<string | null>(requested)
  const [seenRequest, setSeenRequest] = useState<string | null>(requested)
  const [editMode, setEditMode] = useState<EditorMode | null>(null)

  // A re-open with another draft id (the tab is a singleton) opens that draft.
  if (requested !== seenRequest) {
    setSeenRequest(requested)
    if (requested) setSelected(requested)
  }

  const globalMode: EditorMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const mode = selected ? editMode ?? globalMode : globalMode

  return (
    <div data-theme="default" className={`${mode} h-full overflow-y-auto qt-bg-default qt-text`} data-testid="theme-editor-panel" data-editor-scroll>
      {selected ? (
        <OpenDraft key={selected} id={selected} mode={mode} onModeChange={setEditMode} onBack={() => setSelected(null)} />
      ) : (
        <DraftList onOpen={setSelected} onCreated={(draft) => setSelected(draft.id)} />
      )}
    </div>
  )
}
