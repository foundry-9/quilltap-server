'use client'

/**
 * useDocumentMode - State management for Document Mode (Scriptorium Phase 3.5)
 *
 * Manages a chat's set of **open documents** — several may be open at once, each
 * surfacing as its own tab in the tabbed workspace — plus per-document autosave,
 * baseline tracking, and LLM-edit reconciliation. The legacy single-pane
 * `/salon/[id]` route drives the same hook through the "focused document"
 * conveniences (`documentMode`, `activeDocument`, `toggleFocusMode`).
 *
 * @module app/salon/[id]/hooks/useDocumentMode
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatAutosaveNotification } from '@/lib/doc-edit/unified-diff'
import { showErrorToast } from '@/lib/toast'
import { apiErrorMessage } from '@/lib/query/fetcher'
import type { Chat, Message } from '../types'
import { absorbsFirstChange, DocumentSaver, documentWriteOutcome, refusalMessage, type DocumentSaverOptions } from './document-saver'
import {
  closeDocumentForChat,
  deleteDocumentForChat,
  fetchOpenDocumentRecords,
  fetchChatDocumentState,
  openDocumentForChat,
  persistChatDocumentState,
  readDocumentContentForChat,
  renameDocumentForChat,
  requestDocumentWrite,
  toActiveDocument,
} from './documentModeApi'
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions'

export interface ActiveDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle: string
  content: string
  mtime?: number
  /** Set for a file shown read-only (an image, PDF, .docx…); `content` is then empty. */
  viewer?: DocumentViewTarget
}

export type DocumentMode = 'normal' | 'split' | 'focus'

export interface FocusRequest {
  anchor?: string
  highlight?: string
  line?: number
  clear_focus?: boolean
}

/**
 * A doc_focus instruction surfaced from the LLM tool result, carrying the
 * identity of the document it targets so the matching pane (and only that one)
 * reacts when several documents are open.
 */
export interface DocFocusTarget extends FocusRequest {
  chatDocumentId?: string
  filePath?: string
  scope?: string
  mountPoint?: string | null
}

/**
 * One open document plus its per-pane editor state. `document.id` is the
 * chat_documents row id and the stable key everything is addressed by.
 */
export interface OpenDocEntry {
  document: ActiveDocument
  isDirty: boolean
  isSaving: boolean
  contentVersion: number
  attentionTop: number | null
  focusRequest: FocusRequest | null
}

interface UseDocumentModeParams {
  chatId: string
  chat: Chat | null
  /** Called when the server posts a Librarian announcement (document open or save) so the UI can append it to the chat */
  onLibrarianMessage?: (message: Message) => void
}

interface OpenDocumentParams {
  filePath?: string
  title?: string
  scope?: 'project' | 'document_store' | 'general'
  mountPoint?: string
  mode?: 'split' | 'focus'
  /**
   * For new blank documents (no filePath), the folder relative to the scope
   * root where the document should be created. Server picks an unused
   * "Untitled Document.md" name inside this folder.
   */
  targetFolder?: string
}

export interface UseDocumentModeReturn {
  // ---- Open-document collection ----
  openDocs: OpenDocEntry[]
  focusedDocId: string | null
  setFocusedDoc: (docId: string) => void
  /** True while any document is open. */
  documentActive: boolean

  // ---- Per-document operations (addressed by chat_documents row id) ----
  openDocument: (params: OpenDocumentParams) => Promise<ActiveDocument | null>
  /** Close one document; omit `docId` to close the focused document (legacy route). */
  closeDocument: (docId?: string) => Promise<void>
  renameDocument: (docId: string, newTitle: string) => Promise<void>
  deleteDocument: (docId: string) => Promise<void>
  handleContentChange: (docId: string, content: string) => void
  flushSave: (docId: string) => void
  /** Resolves false when the store refused the write and edits remain unsaved. */
  saveDocument: (docId: string) => Promise<boolean>
  setDocAttentionTop: (docId: string, top: number | null) => void
  clearDocFocusRequest: (docId: string) => void

  // ---- LLM / server reconciliation ----
  /** Re-read content of every open document after the LLM finishes a turn. */
  handleLLMEditEnd: () => Promise<void>
  /** Reload the open-document set + each document's content from the server. */
  reloadFromServer: () => Promise<void>
  /** Route an LLM doc_focus to the matching open document's pane. */
  handleDocFocus: (target: DocFocusTarget) => void

  // ---- Shared ----
  /** Scroll position persistence keyed by file path. */
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  /** A document's content as of its last save (the diff/changed-line baseline). */
  getBaselineContent: (docId: string) => string

  // ---- Focused-document conveniences (legacy single-pane route + shortcuts) ----
  documentMode: DocumentMode
  activeDocument: ActiveDocument | null
  dividerPosition: number
  setDividerPosition: (position: number) => void
  toggleFocusMode: () => void
}

/** Toast shown when a close or rename is held because the store refused a save. */
export const UNSAVED_EDITS_MESSAGE =
  "The Librarian could not file your latest changes, so the document stays open with them intact. Do try again in a moment."

/** What a chat's `write-document` answers with. */
interface DocumentWriteResponse {
  mtime?: number
  librarianMessage?: Message | null
}

type ChatDocumentSaver = DocumentSaver<ActiveDocument, DocumentWriteResponse>

function getDocumentModeState(
  source: Partial<{ documentMode: DocumentMode; dividerPosition: number }> | null | undefined,
): { mode: DocumentMode; dividerPosition: number } {
  return {
    mode: (source?.documentMode as DocumentMode) || 'normal',
    dividerPosition: source?.dividerPosition ?? 45,
  }
}

/**
 * Map an open-document error from the API into a single-line user-facing
 * message: the server's `{ error }` sentence, made friendlier for a missing
 * file.
 */
function friendlyOpenDocumentError(
  error: unknown,
  filePath: string | undefined,
  title: string | undefined,
): string {
  const serverMessage = apiErrorMessage(error, 'Failed to open document')

  if (/^File not found/i.test(serverMessage)) {
    const target = filePath || title
    return target
      ? `Couldn't open "${target}" — file not found. It may have been deleted or renamed.`
      : "Couldn't open document — file not found."
  }
  return serverMessage || "Couldn't open document."
}

export function useDocumentMode({ chatId, chat, onLibrarianMessage }: UseDocumentModeParams): UseDocumentModeReturn {
  const [openDocs, setOpenDocs] = useState<OpenDocEntry[]>([])
  const [focusedDocId, setFocusedDocId] = useState<string | null>(null)
  const [documentMode, setDocumentMode] = useState<DocumentMode>('normal')
  const [dividerPosition, setDividerPositionState] = useState(45)

  // One save machine per open document, keyed by chat_documents row id: the
  // pane's text, the last-saved text, the autosave timer and the save in flight.
  const savers = useRef(new Map<string, ChatDocumentSaver>())
  // Scroll position map keyed by file path — persists across document re-opens.
  const scrollPositionsRef = useRef(new Map<string, number>())

  // Latest-value mirrors so memoized callbacks can read current state without
  // resubscribing (and stay stable for the per-pane binding components).
  const openDocsRef = useRef<OpenDocEntry[]>([])
  const focusedDocIdRef = useRef<string | null>(null)
  const onLibrarianMessageRef = useRef(onLibrarianMessage)
  const chatIdRef = useRef(chatId)

  useEffect(() => { openDocsRef.current = openDocs }, [openDocs])
  useEffect(() => { focusedDocIdRef.current = focusedDocId }, [focusedDocId])
  useEffect(() => { onLibrarianMessageRef.current = onLibrarianMessage }, [onLibrarianMessage])
  useEffect(() => { chatIdRef.current = chatId }, [chatId])

  const clearTimerFor = useCallback((docId: string) => {
    savers.current.get(docId)?.cancelAutosave()
  }, [])

  const updateEntry = useCallback((docId: string, updater: (e: OpenDocEntry) => OpenDocEntry) => {
    setOpenDocs(prev => prev.map(e => (e.document.id === docId ? updater(e) : e)))
  }, [])

  const persistChatState = useCallback(async (updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>) => {
    try {
      await persistChatDocumentState(chatId, updates)
    } catch (error) {
      console.error('[DocumentMode] Failed to persist chat document state', error)
    }
  }, [chatId])

  const persistMode = useCallback((mode: DocumentMode) => {
    void persistChatState({ documentMode: mode })
  }, [persistChatState])

  const persistDividerPosition = useCallback((position: number) => {
    void persistChatState({ dividerPosition: position })
  }, [persistChatState])

  const applyChatState = useCallback((source: Partial<{ documentMode: DocumentMode; dividerPosition: number }> | null | undefined) => {
    const { mode, dividerPosition } = getDocumentModeState(source)
    setDocumentMode(mode)
    setDividerPositionState(dividerPosition)
    return mode
  }, [])

  const readDocumentContent = useCallback(async (
    filePath: string,
    scope: ActiveDocument['scope'],
    mountPoint?: string | null,
  ) => {
    return readDocumentContentForChat(chatId, { filePath, scope, mountPoint })
  }, [chatId])

  /**
   * Load (or refresh) a document's content into its entry. Mirrors the
   * single-doc `applyDocumentState`: resets the dirty baseline and, when
   * `incrementVersion`, bumps `contentVersion` so the Lexical editor remounts
   * and the first re-serialization is absorbed as the new baseline.
   */
  const applyDocContent = useCallback((doc: ActiveDocument, incrementVersion = true) => {
    const content = doc.content || ''
    let saver = savers.current.get(doc.id)
    if (!saver) {
      const docId = doc.id
      saver = new DocumentSaver(() => saverOptionsRef.current(docId))
      savers.current.set(docId, saver)
    }
    saver.reset(content, incrementVersion ? absorbsFirstChange(doc.filePath, content) : false)

    setOpenDocs(prev => {
      const buildEntry = (existing?: OpenDocEntry): OpenDocEntry => ({
        document: doc,
        isDirty: false,
        isSaving: existing?.isSaving ?? false,
        contentVersion: incrementVersion ? (existing?.contentVersion ?? 0) + 1 : (existing?.contentVersion ?? 0),
        attentionTop: existing?.attentionTop ?? null,
        focusRequest: existing?.focusRequest ?? null,
      })
      if (prev.some(e => e.document.id === doc.id)) {
        return prev.map(e => (e.document.id === doc.id ? buildEntry(e) : e))
      }
      return [...prev, buildEntry()]
    })
  }, [])

  /** Remove a document's entry + refs and repair the focused-document pointer. */
  const removeEntry = useCallback((docId: string) => {
    savers.current.get(docId)?.dispose()
    savers.current.delete(docId)

    const order = openDocsRef.current
    const idx = order.findIndex(e => e.document.id === docId)
    const remaining = order.filter(e => e.document.id !== docId)

    setOpenDocs(prev => prev.filter(e => e.document.id !== docId))

    if (focusedDocIdRef.current === docId) {
      const neighbor = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
      setFocusedDocId(neighbor ? neighbor.document.id : null)
    }
  }, [])

  // ---- Save / edit (per document) ----------------------------------------

  /** Whether the pane holds text that has not been written to the store. */
  const hasUnsavedEdits = useCallback((docId: string) => {
    return savers.current.get(docId)?.hasUnsavedEdits() ?? false
  }, [])

  // What each document's saver writes through and reports to. Every piece is
  // stable but the chat id, which it reads through its ref at the moment of use.
  const saverOptionsRef = useRef((docId: string): DocumentSaverOptions<ActiveDocument, DocumentWriteResponse> => ({
    logPrefix: '[DocumentMode]',
    current: () => openDocsRef.current.find(e => e.document.id === docId)?.document ?? null,
    write: async (doc, { content, saved, mtime }) => {
      // Generate the diff client-side so the server can post a single Librarian
      // save announcement with the human-readable diff in the same round-trip.
      const diffContent = formatAutosaveNotification(saved, content, doc.displayTitle || doc.filePath) || undefined
      const res = await requestDocumentWrite(chatIdRef.current, {
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        content,
        mtime,
        diffContent,
      })
      return documentWriteOutcome<DocumentWriteResponse>(res)
    },
    read: (doc) => readDocumentContentForChat(chatIdRef.current, {
      filePath: doc.filePath,
      scope: doc.scope,
      mountPoint: doc.mountPoint,
    }),
    setSaving: (saving) => {
      setOpenDocs(prev => prev.map(e => (e.document.id === docId ? { ...e, isSaving: saving } : e)))
    },
    onSaved: (_content, data, stillDirty) => {
      updateEntry(docId, e => ({ ...e, isDirty: stillDirty, document: { ...e.document, mtime: data.mtime } }))
      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    },
    onConflict: (doc, latest, hadLocalEdits) => {
      // With no pending edits, silently adopt the stored version; otherwise
      // keep the unsaved content and just refresh mtime.
      if (!hadLocalEdits) {
        applyDocContent({ ...doc, content: latest.content || '', mtime: latest.mtime })
      } else {
        updateEntry(docId, e => ({ ...e, document: { ...e.document, mtime: latest.mtime } }))
      }
    },
    onRefused: (doc, { body }) => {
      showErrorToast(refusalMessage(body, `"${doc.displayTitle || doc.filePath}" could not be saved. Your edits are still in the pane.`))
    },
  }))

  /**
   * Write a document's unsaved text. Resolves `true` when nothing unsaved
   * remains, `false` when a write was refused (a 409 or any error) and the
   * edits are still only in the pane (#174, #175 — see DocumentSaver).
   */
  const saveDocument = useCallback((docId: string): Promise<boolean> => {
    return savers.current.get(docId)?.save() ?? Promise.resolve(true)
  }, [])

  /**
   * Take down panes the server has closed (a character's doc_close_document,
   * or the last document closed server-side), writing each one's unsaved
   * text first (#261). The save targets the file, which a close leaves in
   * place. A pane whose save the store refuses stays open with its text, as
   * an operator's close would, and its id is returned.
   */
  const dropServerClosedDocs = useCallback(async (docIds: string[]): Promise<string[]> => {
    const held: string[] = []
    for (const docId of docIds) {
      clearTimerFor(docId)
      if (hasUnsavedEdits(docId)) {
        console.debug('[DocumentMode] Saving unsaved edits before a server-side close', { docId })
        if (!(await saveDocument(docId))) {
          held.push(docId)
          continue
        }
      }
      removeEntry(docId)
    }
    if (held.length > 0) {
      console.warn('[DocumentMode] Kept server-closed documents open over refused saves', { held })
      showErrorToast(UNSAVED_EDITS_MESSAGE)
    }
    return held
  }, [clearTimerFor, hasUnsavedEdits, saveDocument, removeEntry])

  const handleContentChange = useCallback((docId: string, content: string) => {
    updateEntry(docId, e => ({ ...e, document: { ...e.document, content } }))
    const change = savers.current.get(docId)?.change(content) ?? 'clean'
    // An absorbed change is Lexical's normalized re-serialization of just-loaded
    // content, adopted as the saved baseline so the status reads "Saved".
    updateEntry(docId, e => ({ ...e, isDirty: change === 'dirty' }))
  }, [updateEntry])

  const flushSave = useCallback((docId: string) => {
    savers.current.get(docId)?.flush()
  }, [])

  // ---- Open / close / rename / delete ------------------------------------

  const openDocument = useCallback(async (params: OpenDocumentParams): Promise<ActiveDocument | null> => {
    const targetMode = params.mode || 'split'

    try {
      const data = await openDocumentForChat(chatId, {
        filePath: params.filePath,
        title: params.title,
        scope: params.scope || 'project',
        mountPoint: params.mountPoint,
        mode: targetMode,
        targetFolder: params.targetFolder,
      })

      const doc: ActiveDocument = toActiveDocument(data.document, data.content || '', data.mtime, data.viewer)

      applyDocContent(doc)
      setFocusedDocId(doc.id)
      setDocumentMode(targetMode)

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }

      return doc
    } catch (error) {
      // Surface to the user as a toast and log without console.error so we don't
      // trigger Next's red-screen overlay for a recoverable miss (e.g. the
      // picker pointed at a file since deleted from the vault).
      const rawMessage = error instanceof Error ? error.message : String(error)
      const toastMessage = friendlyOpenDocumentError(error, params.filePath, params.title)
      showErrorToast(toastMessage)
      console.warn('[DocumentMode] Failed to open document', { rawMessage, params })
      return null
    }
  }, [applyDocContent, chatId])

  const closeDocument = useCallback(async (docId?: string) => {
    const targetId = docId ?? focusedDocIdRef.current
    if (!targetId) return

    // Never close over edits the store refused (#175): the pane stays open
    // with its text, and the operator is told why.
    clearTimerFor(targetId)
    if (hasUnsavedEdits(targetId) && !(await saveDocument(targetId))) {
      showErrorToast(UNSAVED_EDITS_MESSAGE)
      return
    }

    try {
      await closeDocumentForChat(chatId, targetId)
    } catch (error) {
      // The server still has it open; keep the pane rather than let the next
      // reconcile bring it back unexplained (#306).
      console.error('[DocumentMode] Failed to close document', error)
      showErrorToast(apiErrorMessage(error, 'The document could not be closed. Please try again.'))
      return
    }

    removeEntry(targetId)

    // documentMode only returns to 'normal' once the last document closes.
    const remaining = openDocsRef.current.filter(e => e.document.id !== targetId)
    if (remaining.length === 0) {
      setDocumentMode('normal')
      await persistMode('normal')
    }
  }, [chatId, saveDocument, removeEntry, persistMode, clearTimerFor, hasUnsavedEdits])

  const renameDocument = useCallback(async (docId: string, newTitle: string) => {
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (!entry) return
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === entry.document.displayTitle) return

    clearTimerFor(docId)
    if (hasUnsavedEdits(docId) && !(await saveDocument(docId))) {
      showErrorToast(UNSAVED_EDITS_MESSAGE)
      return
    }

    try {
      const data = await renameDocumentForChat(chatId, trimmed, docId)
      updateEntry(docId, e => ({
        ...e,
        document: {
          ...e.document,
          filePath: data.document.filePath,
          displayTitle: data.document.displayTitle || data.document.filePath,
        },
      }))

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to rename document', error)
    }
  }, [chatId, saveDocument, updateEntry, clearTimerFor, hasUnsavedEdits])

  const deleteDocument = useCallback(async (docId: string) => {
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (!entry) return

    clearTimerFor(docId)

    try {
      const data = await deleteDocumentForChat(chatId, docId)

      removeEntry(docId)
      const remaining = openDocsRef.current.filter(e => e.document.id !== docId)
      if (remaining.length === 0) {
        setDocumentMode('normal')
      }

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to delete document', error)
    }
  }, [chatId, clearTimerFor, removeEntry])

  // ---- LLM / server reconciliation ---------------------------------------

  /**
   * Reconcile the open-document set against the server: drop documents the
   * server no longer reports open, add ones it newly reports, and refresh the
   * content of those that changed on disk. Unsaved (dirty) panes are left
   * untouched so a background reload never clobbers the user's edits.
   */
  const reconcileOpenDocuments = useCallback(async () => {
    try {
      const openList = await fetchOpenDocumentRecords(chatId)
      const serverDocs = openList.documents
      const serverIds = new Set(serverDocs.map(d => d.id))

      // Remove documents the server no longer reports open, saving their
      // unsaved edits first (#261).
      const held = new Set(await dropServerClosedDocs(
        openDocsRef.current.filter(e => !serverIds.has(e.document.id)).map(e => e.document.id),
      ))

      // Add new documents and refresh changed content.
      for (const rec of serverDocs) {
        const existing = openDocsRef.current.find(e => e.document.id === rec.id)
        if (existing?.isDirty) continue
        const contentData = await readDocumentContent(rec.filePath, rec.scope, rec.mountPoint)
        const fresh = contentData.content || ''
        if (existing && !contentData.viewer === !existing.document.viewer && fresh === (savers.current.get(rec.id)?.savedContent ?? '')) {
          // Unchanged on disk — just refresh mtime/title without a remount.
          updateEntry(rec.id, e => ({
            ...e,
            document: {
              ...e.document,
              mtime: contentData.mtime,
              displayTitle: rec.displayTitle || e.document.displayTitle,
            },
          }))
          continue
        }
        applyDocContent(toActiveDocument(rec, fresh, contentData.mtime, contentData.viewer))
      }

      const focused = focusedDocIdRef.current
      if (!focused || (!serverIds.has(focused) && !held.has(focused))) {
        setFocusedDocId(serverDocs.length ? serverDocs[serverDocs.length - 1].id : null)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to reconcile open documents', error)
    }
  }, [chatId, readDocumentContent, applyDocContent, dropServerClosedDocs, updateEntry])

  const reloadFromServer = useCallback(async () => {
    try {
      const chatData = await fetchChatDocumentState(chatId)
      applyChatState(chatData.chat)
      await reconcileOpenDocuments()
    } catch (error) {
      console.error('[DocumentMode] Failed to reload from server', error)
    }
  }, [chatId, applyChatState, reconcileOpenDocuments])

  // Refetch every open document's content after the LLM finishes a turn. Skips
  // dirty panes so pending user edits aren't lost.
  const handleLLMEditEnd = useCallback(async () => {
    for (const entry of openDocsRef.current) {
      // A viewed file has no text to refetch; its viewer follows the store's
      // realtime events on its own.
      if (entry.isDirty || entry.document.viewer) continue
      const doc = entry.document
      try {
        const data = await readDocumentContent(doc.filePath, doc.scope, doc.mountPoint)
        const fresh = data.content || ''
        if (fresh !== (savers.current.get(doc.id)?.savedContent ?? '')) {
          applyDocContent({ ...doc, content: fresh, mtime: data.mtime })
        } else {
          updateEntry(doc.id, e => ({ ...e, document: { ...e.document, mtime: data.mtime } }))
        }
      } catch (error) {
        console.warn('[DocumentMode] Failed to refetch document after LLM edit', error)
      }
    }
  }, [readDocumentContent, applyDocContent, updateEntry])

  // ---- Focus / attention --------------------------------------------------

  /** Resolve which open document a doc_focus targets, by id then path. */
  const resolveTargetDocId = useCallback((target: DocFocusTarget): string | null => {
    const docs = openDocsRef.current
    if (target.chatDocumentId && docs.some(e => e.document.id === target.chatDocumentId)) {
      return target.chatDocumentId
    }
    if (target.filePath) {
      const match = docs.find(e =>
        e.document.filePath === target.filePath &&
        (target.scope === undefined || e.document.scope === target.scope) &&
        (target.mountPoint === undefined || (e.document.mountPoint ?? null) === (target.mountPoint ?? null)),
      )
      if (match) return match.document.id
    }
    return focusedDocIdRef.current ?? (docs.length ? docs[docs.length - 1].document.id : null)
  }, [])

  const handleDocFocus = useCallback((target: DocFocusTarget): void => {
    const docId = resolveTargetDocId(target)
    if (!docId) return

    if (target.clear_focus) {
      updateEntry(docId, e => ({ ...e, attentionTop: null, focusRequest: null }))
      return
    }

    // Don't eagerly set attentionTop — DocumentFocusPlugin resolves the target
    // and calls back after scrolling. Bring the document to the foreground.
    updateEntry(docId, e => ({
      ...e,
      focusRequest: { anchor: target.anchor, highlight: target.highlight, line: target.line },
    }))
    setFocusedDocId(docId)
  }, [resolveTargetDocId, updateEntry])

  const setDocAttentionTop = useCallback((docId: string, top: number | null): void => {
    updateEntry(docId, e => ({ ...e, attentionTop: top }))
  }, [updateEntry])

  const clearDocFocusRequest = useCallback((docId: string): void => {
    updateEntry(docId, e => ({ ...e, focusRequest: null }))
  }, [updateEntry])

  // ---- Scroll position helpers -------------------------------------------

  const getScrollPosition = useCallback((filePath: string): number => {
    return scrollPositionsRef.current.get(filePath) ?? 0
  }, [])

  const setScrollPosition = useCallback((filePath: string, pos: number): void => {
    scrollPositionsRef.current.set(filePath, pos)
  }, [])

  const getBaselineContent = useCallback((docId: string): string => {
    return savers.current.get(docId)?.savedContent ?? ''
  }, [])

  // ---- Layout (legacy single-pane conveniences) --------------------------

  const setFocusedDoc = useCallback((docId: string) => {
    setFocusedDocId(docId)
  }, [])

  const toggleFocusMode = useCallback(() => {
    const newMode = documentMode === 'focus' ? 'split' : 'focus'
    setDocumentMode(newMode)
    persistMode(newMode)
  }, [documentMode, persistMode])

  const setDividerPosition = useCallback((position: number) => {
    setDividerPositionState(position)
    persistDividerPosition(position)
  }, [persistDividerPosition])

  // ---- Initialization / cleanup ------------------------------------------

  // Initialize from chat data when it loads, and re-reconcile when the server's
  // documentMode changes (e.g. an LLM open/close persisted the flag).
  useEffect(() => {
    if (!chat) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the server chat row into local document-mode state whenever its documentMode changes
    const mode = applyChatState(chat)
    if (mode !== 'normal') {
      void reconcileOpenDocuments()
    } else {
      // The server closed the last document. Save what the panes hold before
      // taking them down (#261); a pane whose save is refused stays, and the
      // view stays split so it can be seen.
      void dropServerClosedDocs(openDocsRef.current.map(e => e.document.id)).then(held => {
        if (held.length > 0) {
          setDocumentMode('split')
          setFocusedDocId(held[held.length - 1])
        } else {
          setFocusedDocId(null)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on chat.documentMode/dividerPosition so a refetched chat object does not re-reconcile; chat, reconcileOpenDocuments and dropServerClosedDocs omitted on purpose
  }, [applyChatState, chat?.documentMode, chat?.dividerPosition])

  // Cleanup all autosave timers on unmount.
  useEffect(() => {
    const open = savers.current
    return () => {
      for (const saver of open.values()) saver.dispose()
    }
  }, [])

  // External qtap:// opens (from non-Salon surfaces) resolve through the API;
  // when they land, reconcile this chat's open-document set and focus the new
  // row so the pane appears immediately without a manual reload.
  useEffect(() => {
    const onQtapDocumentOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string; chatDocumentId?: string }>).detail
      if (!detail || detail.chatId !== chatId) return

      void reconcileOpenDocuments().then(() => {
        if (detail.chatDocumentId) {
          setFocusedDocId(detail.chatDocumentId)
        }
      })
    }

    window.addEventListener('qtap-document-opened', onQtapDocumentOpened as EventListener)
    return () => {
      window.removeEventListener('qtap-document-opened', onQtapDocumentOpened as EventListener)
    }
  }, [chatId, reconcileOpenDocuments])

  const focusedDocument =
    openDocs.find(e => e.document.id === focusedDocId)?.document ?? openDocs[0]?.document ?? null

  const documentActive = openDocs.length > 0

  return useMemo<UseDocumentModeReturn>(() => ({
    openDocs,
    focusedDocId,
    setFocusedDoc,
    documentActive,
    openDocument,
    closeDocument,
    renameDocument,
    deleteDocument,
    handleContentChange,
    flushSave,
    saveDocument,
    setDocAttentionTop,
    clearDocFocusRequest,
    handleLLMEditEnd,
    reloadFromServer,
    handleDocFocus,
    getScrollPosition,
    setScrollPosition,
    getBaselineContent,
    documentMode,
    activeDocument: focusedDocument,
    dividerPosition,
    setDividerPosition,
    toggleFocusMode,
  }), [
    openDocs,
    focusedDocId,
    setFocusedDoc,
    documentActive,
    openDocument,
    closeDocument,
    renameDocument,
    deleteDocument,
    handleContentChange,
    flushSave,
    saveDocument,
    setDocAttentionTop,
    clearDocFocusRequest,
    handleLLMEditEnd,
    reloadFromServer,
    handleDocFocus,
    getScrollPosition,
    setScrollPosition,
    getBaselineContent,
    documentMode,
    focusedDocument,
    dividerPosition,
    setDividerPosition,
    toggleFocusMode,
  ])
}
