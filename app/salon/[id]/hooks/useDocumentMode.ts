'use client'

/**
 * useDocumentMode - State management for Document Mode (Scriptorium Phase 3.5)
 *
 * Manages the three-state layout system (normal/split/focus),
 * document associations, autosave, and LLM edit coordination.
 *
 * @module app/salon/[id]/hooks/useDocumentMode
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatAutosaveNotification } from '@/lib/doc-edit/unified-diff'
import { showErrorToast } from '@/lib/toast'
import type { Chat, Message } from '../types'
import {
  closeDocumentForChat,
  deleteDocumentForChat,
  fetchActiveDocumentRecord,
  fetchChatDocumentState,
  openDocumentForChat,
  persistChatDocumentState,
  readDocumentContentForChat,
  renameDocumentForChat,
  requestDocumentWrite,
  toActiveDocument,
} from './documentModeApi'

export interface ActiveDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle: string
  content: string
  mtime?: number
}

export type DocumentMode = 'normal' | 'split' | 'focus'

export interface FocusRequest {
  anchor?: string
  highlight?: string
  line?: number
  clear_focus?: boolean
}

interface UseDocumentModeParams {
  chatId: string
  chat: Chat | null
  /** Called when the server posts a Librarian announcement (document open or save) so the UI can append it to the chat */
  onLibrarianMessage?: (message: Message) => void
}

interface UseDocumentModeReturn {
  documentMode: DocumentMode
  activeDocument: ActiveDocument | null
  dividerPosition: number
  isDirty: boolean
  isSaving: boolean
  isLLMEditing: boolean
  openDocument: (params: OpenDocumentParams) => Promise<ActiveDocument | null>
  closeDocument: () => Promise<void>
  renameDocument: (newTitle: string) => Promise<void>
  deleteDocument: () => Promise<void>
  toggleFocusMode: () => void
  setDividerPosition: (position: number) => void
  handleContentChange: (content: string) => void
  handleLLMEditStart: () => void
  handleLLMEditEnd: () => Promise<void>
  saveDocument: () => Promise<void>
  flushSave: () => void
  /** Reload document state from server (after LLM opens/closes via tool) */
  reloadFromServer: () => Promise<void>
  /** Increments on each external content load to force editor remount */
  contentVersion: number
  /** Scroll position persistence keyed by file path */
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  /** Pixel offset (from content top) where the AI attention eye sits; null when unset */
  attentionTop: number | null
  setAttentionTop: (top: number | null) => void
  focusRequest: FocusRequest | null
  handleDocFocus: (result: FocusRequest) => void
  clearFocusRequest: () => void
  /** The document content as of the last save */
  baselineContent: string
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

const AUTOSAVE_DEBOUNCE_MS = 30000

function isMarkdownDocument(document: Pick<ActiveDocument, 'filePath'>): boolean {
  const dot = document.filePath.lastIndexOf('.')
  if (dot < 0) return false
  const ext = document.filePath.slice(dot).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

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
 * message. The server returns a JSON body whose `error` field is the raw
 * message; if parsing fails, we fall back to the original text.
 */
function friendlyOpenDocumentError(
  rawMessage: string,
  filePath: string | undefined,
  title: string | undefined,
): string {
  let serverMessage = rawMessage
  try {
    const parsed = JSON.parse(rawMessage) as { error?: string }
    if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
      serverMessage = parsed.error
    }
  } catch {
    // rawMessage isn't JSON — leave it alone.
  }

  if (/^File not found/i.test(serverMessage)) {
    const target = filePath || title
    return target
      ? `Couldn't open "${target}" — file not found. It may have been deleted or renamed.`
      : "Couldn't open document — file not found."
  }
  return serverMessage || "Couldn't open document."
}

export function useDocumentMode({ chatId, chat, onLibrarianMessage }: UseDocumentModeParams): UseDocumentModeReturn {
  const [documentMode, setDocumentMode] = useState<DocumentMode>('normal')
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null)
  const [dividerPosition, setDividerPositionState] = useState(45)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLLMEditing, setIsLLMEditing] = useState(false)
  // Bumps on every external content load (LLM edit, reload) to force Lexical remount
  const [contentVersion, setContentVersion] = useState(0)

  const [attentionTop, setAttentionTop] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<string>('')
  // Tracks the last-saved content so we can distinguish real edits from Lexical re-sync
  const savedContentRef = useRef<string>('')
  const onLibrarianMessageRef = useRef(onLibrarianMessage)
  // Mirrors isLLMEditing so memoized callbacks can read the latest value without resubscribing
  const isLLMEditingRef = useRef(false)
  // When true, the next handleContentChange is treated as Lexical's post-remount
  // re-serialization (which may not byte-match the disk content, e.g. whitespace)
  // and adopted as the new saved baseline rather than flagging dirty.
  const absorbNextContentChangeRef = useRef(false)
  // Scroll position map keyed by file path — persists across document re-opens
  const scrollPositionsRef = useRef(new Map<string, number>())

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const applyChatState = useCallback((source: Partial<{ documentMode: DocumentMode; dividerPosition: number }> | null | undefined) => {
    const { mode, dividerPosition } = getDocumentModeState(source)
    setDocumentMode(mode)
    setDividerPositionState(dividerPosition)
    return mode
  }, [])

  const applyDocumentState = useCallback((document: ActiveDocument | null, incrementVersion = true) => {
    setActiveDocument(document)

    const content = document?.content || ''
    contentRef.current = content
    savedContentRef.current = content
    setIsDirty(false)

    if (incrementVersion) {
      // Lexical will remount (key={contentVersion}) and re-serialize the loaded
      // markdown. Its normalized output may differ from the disk content in
      // trivial ways (whitespace, list spacing), so absorb that first change as
      // the new baseline instead of flagging the doc as dirty. Non-markdown
      // files render in a plain textarea that has no re-serialization step,
      // so there is nothing to absorb — the user's first keystroke is real.
      absorbNextContentChangeRef.current = document ? isMarkdownDocument(document) : false
      setContentVersion(v => v + 1)
    }
  }, [])

  const persistChatState = useCallback(async (updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>) => {
    try {
      await persistChatDocumentState(chatId, updates)
    } catch (error) {
      console.error('[DocumentMode] Failed to persist chat document state', error)
    }
  }, [chatId])

  const readDocumentContent = useCallback(async (
    filePath: string,
    scope: ActiveDocument['scope'],
    mountPoint?: string | null,
  ) => {
    return readDocumentContentForChat(chatId, {
      filePath,
      scope,
      mountPoint,
    })
  }, [chatId])

  useEffect(() => {
    onLibrarianMessageRef.current = onLibrarianMessage
  }, [onLibrarianMessage])

  // Load the active document for this chat from the API
  const loadActiveDocument = useCallback(async () => {
    try {
      const data = await fetchActiveDocumentRecord(chatId)
      if (!data.document) {
        setDocumentMode('normal')
        applyDocumentState(null, false)
        return
      }

      const contentData = await readDocumentContent(
        data.document.filePath,
        data.document.scope,
        data.document.mountPoint,
      )

      applyDocumentState(
        toActiveDocument(
          data.document,
          contentData.content || '',
          contentData.mtime,
        ),
      )
    } catch (error) {
      console.error('[DocumentMode] Failed to load active document', error)
    }
  }, [applyDocumentState, chatId, readDocumentContent])

  // Initialize from chat data when it loads
  useEffect(() => {
    if (chat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
      const mode = applyChatState(chat)

      // If the chat has an active document association, load it
      if (mode !== 'normal') {
        loadActiveDocument()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyChatState, chat?.documentMode, chat?.dividerPosition])

  const persistMode = useCallback((mode: DocumentMode) => {
    void persistChatState({ documentMode: mode })
  }, [persistChatState])

  const persistDividerPosition = useCallback((position: number) => {
    void persistChatState({ dividerPosition: position })
  }, [persistChatState])

  // Save the document content
  const saveDocument = useCallback(async () => {
    if (!activeDocument || !isDirty) return

    setIsSaving(true)
    try {
      // Generate the diff client-side so the server can post a single Librarian save announcement
      // with the human-readable diff in the same round-trip.
      const oldContentForDiff = savedContentRef.current
      const newContentForDiff = contentRef.current
      const diffContent = oldContentForDiff !== newContentForDiff
        ? formatAutosaveNotification(
            oldContentForDiff,
            newContentForDiff,
            activeDocument.displayTitle || activeDocument.filePath,
          ) || undefined
        : undefined

      const res = await requestDocumentWrite(chatId, {
        filePath: activeDocument.filePath,
        scope: activeDocument.scope,
        mountPoint: activeDocument.mountPoint,
        content: contentRef.current,
        mtime: activeDocument.mtime,
        diffContent,
      })

      if (res.status === 409) {
        // Someone (likely the LLM) wrote the file while we had it open. Re-read
        // the current disk content. If the user has no actual pending edits,
        // silently adopt the server version; otherwise leave the unsaved
        // content alone and just refresh mtime so the next save can succeed.
        const localContent = contentRef.current
        const hadLocalEdits = localContent !== savedContentRef.current
        try {
          const latest = await readDocumentContent(
            activeDocument.filePath,
            activeDocument.scope,
            activeDocument.mountPoint,
          )
          if (!hadLocalEdits) {
            applyDocumentState({
              ...activeDocument,
              content: latest.content || '',
              mtime: latest.mtime,
            })
          } else {
            setActiveDocument(prev => prev ? { ...prev, mtime: latest.mtime } : null)
          }
          console.warn('[DocumentMode] Document changed on disk during save; reloaded mtime', {
            filePath: activeDocument.filePath,
            hadLocalEdits,
          })
        } catch (reloadError) {
          console.warn('[DocumentMode] Failed to reload document after save conflict', reloadError)
        }
        return
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        console.warn('[DocumentMode] Failed to save document', { status: res.status, body: bodyText })
        return
      }

      const data = await res.json()
      const newContent = contentRef.current
      savedContentRef.current = newContent
      setIsDirty(false)
      setActiveDocument(prev => prev ? { ...prev, mtime: data.mtime } : null)

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to save document', error)
    } finally {
      setIsSaving(false)
    }
  }, [chatId, activeDocument, isDirty, readDocumentContent, applyDocumentState])

  // Handle content changes with debounced autosave
  const handleContentChange = useCallback((content: string) => {
    contentRef.current = content
    setActiveDocument(prev => prev ? { ...prev, content } : null)

    // First change after an external state load (initial open, LLM edit refetch,
    // server reload) is Lexical's normalized re-serialization of the just-loaded
    // content. Adopt it as the saved baseline so the status reads "Saved" and
    // future byte-exact comparisons work.
    if (absorbNextContentChangeRef.current) {
      absorbNextContentChangeRef.current = false
      savedContentRef.current = content
      setIsDirty(false)
      return
    }

    // Only mark dirty if content actually differs from what was last saved/loaded
    if (content === savedContentRef.current) {
      setIsDirty(false)
      return
    }

    setIsDirty(true)

    // While the LLM is actively editing, don't schedule an autosave — it would
    // race the LLM's disk write and fail with an mtime conflict. handleLLMEditEnd
    // re-reads the file and we'll pick up any real user edits on the next change
    // after it finishes.
    if (isLLMEditingRef.current) {
      clearAutosaveTimer()
      return
    }

    // Debounce autosave
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(() => {
      saveDocument()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [clearAutosaveTimer, saveDocument])

  // Flush: cancel any pending debounce and save immediately if dirty
  const flushSave = useCallback(() => {
    clearAutosaveTimer()
    if (isDirty) {
      saveDocument()
    }
  }, [clearAutosaveTimer, isDirty, saveDocument])

  // Open a document — returns the ActiveDocument on success, null on failure
  const openDocument = useCallback(async (params: OpenDocumentParams): Promise<ActiveDocument | null> => {
    // Save current document if dirty
    if (isDirty && activeDocument) {
      await saveDocument()
    }

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

      const doc: ActiveDocument = toActiveDocument(
        data.document,
        data.content || '',
        data.mtime,
      )

      applyDocumentState(doc)
      setDocumentMode(targetMode)

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }

      return doc
    } catch (error) {
      // Surface the error to the user as a toast and log without console.error
      // so we don't trigger Next's red-screen dev overlay for what is usually
      // a recoverable miss (e.g., a file the picker pointed at has since been
      // deleted from the vault).
      const rawMessage = error instanceof Error ? error.message : String(error)
      const toastMessage = friendlyOpenDocumentError(rawMessage, params.filePath, params.title)
      showErrorToast(toastMessage)
      console.warn('[DocumentMode] Failed to open document', { rawMessage, params })
      return null
    }
  }, [applyDocumentState, chatId, isDirty, activeDocument, saveDocument])

  // Close the document
  const closeDocument = useCallback(async () => {
    // Save if dirty before closing
    if (isDirty && activeDocument) {
      await saveDocument()
    }

    try {
      await closeDocumentForChat(chatId)
    } catch (error) {
      console.error('[DocumentMode] Failed to close document', error)
    }

    applyDocumentState(null, false)
    setDocumentMode('normal')
    await persistMode('normal')
  }, [applyDocumentState, chatId, isDirty, activeDocument, saveDocument, persistMode])

  // Rename the active document's underlying file. The server validates the
  // new name, moves the file, and returns the updated record. We flush any
  // pending save first so the rename operates on the latest content.
  const renameDocument = useCallback(async (newTitle: string) => {
    if (!activeDocument) return
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === activeDocument.displayTitle) return

    if (isDirty) {
      await saveDocument()
    }

    try {
      const data = await renameDocumentForChat(chatId, trimmed)
      setActiveDocument(prev => prev ? {
        ...prev,
        filePath: data.document.filePath,
        displayTitle: data.document.displayTitle || data.document.filePath,
      } : null)

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to rename document', error)
    }
  }, [activeDocument, chatId, isDirty, saveDocument])

  // Delete the active document's underlying file. Cancels any pending autosave
  // so it cannot fire against a file that's about to vanish, deactivates the
  // chat's document association, and appends the Librarian's announcement to
  // the transcript so present characters know the volume is gone.
  const deleteDocument = useCallback(async () => {
    if (!activeDocument) return

    clearAutosaveTimer()

    try {
      const data = await deleteDocumentForChat(chatId)

      applyDocumentState(null, false)
      setDocumentMode('normal')

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to delete document', error)
    }
  }, [activeDocument, applyDocumentState, chatId, clearAutosaveTimer])

  // Toggle between split and focus modes
  const toggleFocusMode = useCallback(() => {
    const newMode = documentMode === 'focus' ? 'split' : 'focus'
    setDocumentMode(newMode)
    persistMode(newMode)
  }, [documentMode, persistMode])

  // Update divider position and persist
  const setDividerPosition = useCallback((position: number) => {
    setDividerPositionState(position)
    persistDividerPosition(position)
  }, [persistDividerPosition])

  // LLM edit coordination
  const handleLLMEditStart = useCallback(() => {
    isLLMEditingRef.current = true
    setIsLLMEditing(true)
    // Cancel any pending autosave — letting it fire while the LLM is writing to
    // disk would produce an mtime conflict.
    clearAutosaveTimer()
  }, [clearAutosaveTimer])

  const handleLLMEditEnd = useCallback(async () => {
    isLLMEditingRef.current = false
    setIsLLMEditing(false)
    // Refetch document content after LLM edits
    if (activeDocument) {
      try {
        const data = await readDocumentContent(
          activeDocument.filePath,
          activeDocument.scope,
          activeDocument.mountPoint,
        )

        applyDocumentState({
          ...activeDocument,
          content: data.content || '',
          mtime: data.mtime,
        })
      } catch (error) {
        console.warn('[DocumentMode] Failed to refetch document after LLM edit', error)
      }
    }
  }, [applyDocumentState, activeDocument, readDocumentContent])

  // Reload document state from server — used when LLM opens/closes a document via tools
  const reloadFromServer = useCallback(async () => {
    try {
      const chatData = await fetchChatDocumentState(chatId)
      const mode = applyChatState(chatData.chat)

      if (mode !== 'normal') {
        await loadActiveDocument()
      } else {
        applyDocumentState(null, false)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to reload from server', error)
    }
  }, [applyChatState, applyDocumentState, chatId, loadActiveDocument])

  // Scroll position helpers
  const getScrollPosition = useCallback((filePath: string): number => {
    return scrollPositionsRef.current.get(filePath) ?? 0
  }, [])

  const setScrollPosition = useCallback((filePath: string, pos: number): void => {
    scrollPositionsRef.current.set(filePath, pos)
  }, [])

  // Focus/attention helpers
  const handleDocFocus = useCallback((result: FocusRequest): void => {
    console.debug('[useDocumentMode] handleDocFocus called', result)
    if (result.clear_focus) {
      setAttentionTop(null)
      setFocusRequest(null)
    } else {
      // Don't eagerly set attentionTop here — the DocumentFocusPlugin
      // resolves the target and calls setAttentionTop after scrolling
      setFocusRequest(result)
    }
  }, [])

  const clearFocusRequest = useCallback((): void => {
    setFocusRequest(null)
  }, [])

  // Cleanup autosave timer on unmount
  useEffect(() => {
    return () => {
      clearAutosaveTimer()
    }
  }, [clearAutosaveTimer])

  return {
    documentMode,
    activeDocument,
    dividerPosition,
    isDirty,
    isSaving,
    isLLMEditing,
    openDocument,
    closeDocument,
    renameDocument,
    deleteDocument,
    toggleFocusMode,
    setDividerPosition,
    handleContentChange,
    handleLLMEditStart,
    handleLLMEditEnd,
    saveDocument,
    flushSave,
    reloadFromServer,
    contentVersion,
    getScrollPosition,
    setScrollPosition,
    attentionTop,
    setAttentionTop,
    focusRequest,
    handleDocFocus,
    clearFocusRequest,
    get baselineContent() { return savedContentRef.current },
  }
}
