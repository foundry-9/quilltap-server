'use client'

/**
 * StandaloneDocumentView — a chat-less Document Mode workspace tab.
 *
 * Renders one {@link DocumentPane} bound to the standalone documents API
 * (`/api/v1/documents?action=…`) instead of a chat's document actions. No
 * chat_documents row exists and no Librarian announcement is posted — the tab's
 * payload is the only record of the open, so saving or closing here never
 * notifies a Salon conversation.
 *
 * Saves through the same per-document save machine as `useDocumentMode`
 * (`DocumentSaver`: 30s autosave debounce, flush on blur,
 * absorb-first-serialization baseline, 409 conflict reload) for a single
 * document.
 *
 * @module components/workspace/StandaloneDocumentView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import DocumentPane from '@/app/salon/[id]/components/DocumentPane'
import { DocumentViewerPane } from '@/app/salon/[id]/components/DocumentViewerPane'
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions'
import { UNSAVED_EDITS_MESSAGE, type ActiveDocument } from '@/app/salon/[id]/hooks/useDocumentMode'
import {
  absorbsFirstChange,
  DocumentSaver,
  documentWriteOutcome,
  refusalMessage,
  type DocumentChangeOrigin,
} from '@/app/salon/[id]/hooks/document-saver'
import type { DocumentStandaloneTabPayload } from '@/lib/workspace/types'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'
import { useTabCloseGuard } from '@/components/workspace/useTabCloseGuard'
import { showErrorToast } from '@/lib/toast'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function postDocumentsAction(action: string, body: unknown): Promise<Response> {
  return fetch(`/api/v1/documents?action=${action}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

/** Pull the server's `error` field out of a failed response, if present. */
async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.error === 'string' && data.error.length > 0) return data.error
  } catch {
    // Non-JSON body — use the fallback.
  }
  return fallback
}

export function StandaloneDocumentView({ payload }: { payload: DocumentStandaloneTabPayload }) {
  const { openTab } = useWorkspace()
  const closeSelf = useCloseSelfTab()

  const [doc, setDoc] = useState<ActiveDocument | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  // Content at open / last save — the dirty comparison and gutter-diff baseline.
  const [baselineContent, setBaselineContent] = useState('')

  // Live mirrors so the memoized save/close callbacks read current values.
  const docRef = useRef<ActiveDocument | null>(null)
  // The pane's text, its last-saved text, the autosave timer and the save in
  // flight; configured with this component's callbacks below.
  const [saver] = useState(() => new DocumentSaver<ActiveDocument, { mtime?: number }>())
  const scrollPositionsRef = useRef(new Map<string, number>())
  // The in-flight open request, shared across effect re-runs (StrictMode runs
  // the mount effect twice in dev — without this, a blank open would CREATE
  // two untitled documents).
  const openRequestRef = useRef<Promise<{
    document: { filePath: string; scope: ActiveDocument['scope']; mountPoint?: string | null; displayTitle?: string }
    content?: string
    mtime?: number
    viewer?: DocumentViewTarget
  }> | null>(null)

  useEffect(() => { docRef.current = doc }, [doc])

  const clearAutosaveTimer = useCallback(() => saver.cancelAutosave(), [saver])

  /** Load (or reload) content into the pane, resetting the dirty baseline. */
  const adoptDocument = useCallback((next: ActiveDocument) => {
    const content = next.content || ''
    saver.reset(content, absorbsFirstChange(next.filePath, content))
    setBaselineContent(content)
    setIsDirty(false)
    setDoc(next)
    setContentVersion(v => v + 1)
  }, [saver])

  useEffect(() => {
    saver.configure({
      logPrefix: '[StandaloneDocument]',
      current: () => docRef.current,
      write: async (current, { content, mtime }) => documentWriteOutcome(await postDocumentsAction('write-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
        content,
        mtime,
      })),
      read: async (current) => {
        const readRes = await postDocumentsAction('read-document', {
          filePath: current.filePath,
          scope: current.scope,
          mountPoint: current.mountPoint ?? undefined,
        })
        return readRes.ok ? readRes.json() : null
      },
      setSaving: setIsSaving,
      onSaved: (content, data, stillDirty) => {
        setBaselineContent(content)
        setIsDirty(stillDirty)
        setDoc(prev => (prev ? { ...prev, mtime: data.mtime } : prev))
      },
      onConflict: (current, latest, hadLocalEdits) => {
        // With no pending edits, silently adopt the stored version; otherwise
        // keep the unsaved content and just refresh mtime.
        if (!hadLocalEdits) {
          adoptDocument({ ...current, content: latest.content || '', mtime: latest.mtime })
        } else {
          setDoc(prev => (prev ? { ...prev, mtime: latest.mtime } : prev))
        }
      },
      onRefused: (current, { body }) => {
        showErrorToast(refusalMessage(body, `"${current.filePath}" could not be saved. Your edits are still in the pane.`))
      },
    })
  }, [saver, adoptDocument])

  /**
   * Refresh this tab's payload/title in the workspace store. Same-identity
   * openTab with `focus: false` updates in place — crucial for blank documents,
   * whose persisted payload must gain the server-picked filePath so a reload
   * reopens the real file instead of minting another untitled one.
   */
  const refreshTab = useCallback((filePath: string, displayTitle: string) => {
    openTab(
      'document-standalone',
      { ...payload, filePath, displayTitle } satisfies DocumentStandaloneTabPayload,
      { focus: false, title: displayTitle },
    )
  }, [openTab, payload])

  // Open (or create) the document once on mount. The tab is kept alive across
  // tab switches, so this runs once per workspace session. The request itself
  // is minted at most once (openRequestRef) so StrictMode's double effect run
  // can't create two blank documents; each run just (re)binds the handlers.
  useEffect(() => {
    let cancelled = false
    if (!openRequestRef.current) {
      openRequestRef.current = (async () => {
        const res = await postDocumentsAction('open-document', {
          filePath: payload.filePath,
          title: payload.displayTitle,
          scope: payload.scope,
          mountPoint: payload.mountPoint ?? undefined,
          targetFolder: payload.targetFolder,
        })
        if (!res.ok) {
          throw new Error(await responseError(res, "Couldn't open document."))
        }
        return res.json()
      })()
    }
    openRequestRef.current
      .then((data) => {
        if (cancelled) return
        adoptDocument({
          id: payload.docKey,
          filePath: data.document.filePath,
          scope: data.document.scope,
          mountPoint: data.document.mountPoint,
          displayTitle: data.document.displayTitle || data.document.filePath,
          content: data.content || '',
          mtime: data.mtime,
          ...(data.viewer ? { viewer: data.viewer } : {}),
        })
        refreshTab(data.document.filePath, data.document.displayTitle || data.document.filePath)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[StandaloneDocument] Failed to open document', { message, payload })
        setLoadError(message)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once on mount; the payload identity is fixed for this tab
  }, [])

  /** Whether the pane holds text that has not been written to the store. */
  const hasUnsavedEdits = useCallback(() => saver.hasUnsavedEdits(), [saver])

  /**
   * Write the pane's unsaved text. Resolves `true` when nothing unsaved
   * remains, `false` when a write was refused (a 409 or any error) and the
   * edits are still only in the pane (#174 / #175 — see DocumentSaver).
   */
  const saveDocument = useCallback((): Promise<boolean> => saver.save(), [saver])

  const handleContentChange = useCallback((content: string, origin?: DocumentChangeOrigin) => {
    setDoc(prev => (prev ? { ...prev, content } : prev))
    const change = saver.change(content, origin)
    // An absorbed change is Lexical's normalized re-serialization of just-loaded
    // content, adopted as the saved baseline so the status reads "Saved".
    if (change === 'absorbed') setBaselineContent(content)
    setIsDirty(change === 'dirty')
  }, [saver])

  const flushSave = useCallback(() => saver.flush(), [saver])

  const handleTitleChange = useCallback(async (newTitle: string) => {
    const current = docRef.current
    if (!current) return
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === current.displayTitle) return

    // Never rename over edits the store refused: the text stays in the pane.
    clearAutosaveTimer()
    if (hasUnsavedEdits() && !(await saveDocument())) {
      showErrorToast(UNSAVED_EDITS_MESSAGE)
      return
    }

    try {
      const res = await postDocumentsAction('rename-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
        newTitle: trimmed,
      })
      if (!res.ok) {
        showErrorToast(await responseError(res, "Couldn't rename document."))
        return
      }
      const data = await res.json()
      const renamed = {
        filePath: data.document.filePath as string,
        displayTitle: (data.document.displayTitle as string) || (data.document.filePath as string),
      }
      // Carry the scroll position across the file-path key change.
      const scrollPos = scrollPositionsRef.current.get(current.filePath)
      if (scrollPos !== undefined) {
        scrollPositionsRef.current.set(renamed.filePath, scrollPos)
      }
      setDoc(prev => (prev ? { ...prev, ...renamed } : prev))
      refreshTab(renamed.filePath, renamed.displayTitle)
    } catch (error) {
      console.error('[StandaloneDocument] Failed to rename document', error)
    }
  }, [saveDocument, refreshTab, clearAutosaveTimer, hasUnsavedEdits])

  /**
   * Settle the pane before it closes: write any unsaved text, and refuse the
   * close (with the Librarian's toast) when the store refuses it. Shared by the
   * pane's own close button and the workspace tab's × (#222).
   */
  const settleBeforeClose = useCallback(async (): Promise<boolean> => {
    clearAutosaveTimer()
    // Never close over edits the store refused: the tab stays open with them.
    if (hasUnsavedEdits() && !(await saveDocument())) {
      showErrorToast(UNSAVED_EDITS_MESSAGE)
      return false
    }
    return true
  }, [clearAutosaveTimer, saveDocument, hasUnsavedEdits])

  // The tab strip's × (and Delete / Ctrl+Alt+W) asks this before closing.
  useTabCloseGuard(settleBeforeClose)

  const handleCloseDocument = useCallback(async () => {
    if (!(await settleBeforeClose())) return
    closeSelf()
  }, [settleBeforeClose, closeSelf])

  const handleDeleteDocument = useCallback(async () => {
    const current = docRef.current
    if (!current) return
    clearAutosaveTimer()
    try {
      const res = await postDocumentsAction('delete-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
      })
      if (!res.ok) {
        showErrorToast(await responseError(res, "Couldn't delete document."))
        return
      }
      closeSelf()
    } catch (error) {
      console.error('[StandaloneDocument] Failed to delete document', error)
    }
  }, [clearAutosaveTimer, closeSelf])

  const getScrollPosition = useCallback((filePath: string): number => {
    return scrollPositionsRef.current.get(filePath) ?? 0
  }, [])

  const setScrollPosition = useCallback((filePath: string, pos: number): void => {
    scrollPositionsRef.current.set(filePath, pos)
  }, [])

  // The workspace hides (never unmounts) inactive tabs, so unmount here means
  // the tab was closed or the workspace was left — flush the timer.
  useEffect(() => () => saver.dispose(), [saver])

  const noop = useCallback(() => {}, [])

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <p className="qt-text-primary font-medium">This document could not be opened.</p>
        <p className="qt-text-secondary text-sm max-w-md">{loadError}</p>
        <button
          type="button"
          className="qt-button-secondary px-3 py-1.5 rounded-md text-sm"
          onClick={() => closeSelf()}
        >
          Close tab
        </button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="qt-text-muted text-sm">Fetching the manuscript…</p>
      </div>
    )
  }

  // A file shown read-only (an image, PDF, .docx…) gets the viewer, not the editor.
  if (doc.viewer) {
    return (
      <DocumentViewerPane displayTitle={doc.displayTitle} viewer={doc.viewer} onCloseDocument={handleCloseDocument} />
    )
  }

  return (
    <DocumentPane
      document={doc}
      mode="split"
      isDirty={isDirty}
      isSaving={isSaving}
      contentVersion={contentVersion}
      baselineContent={baselineContent}
      getScrollPosition={getScrollPosition}
      setScrollPosition={setScrollPosition}
      onContentChange={handleContentChange}
      onBlur={flushSave}
      onFlushSave={flushSave}
      onToggleFocusMode={noop}
      onCloseDocument={handleCloseDocument}
      onDeleteDocument={handleDeleteDocument}
      onTitleChange={handleTitleChange}
    />
  )
}
