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
import type { Chat } from '../types'

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
  /** Called after autosave with a diff message to send to the LLM */
  onAutosaveNotify?: (message: string) => void
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
}

const AUTOSAVE_DEBOUNCE_MS = 30000

/**
 * Generate a simple unified diff between two strings.
 * Produces output similar to `git diff` with @@ line markers.
 */
function generateUnifiedDiff(oldText: string, newText: string, filename: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const hunks: string[] = []

  // Simple LCS-based diff: walk both arrays and find changed regions
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++
      j++
      continue
    }

    // Found a difference — collect the hunk
    const hunkStartOld = i + 1
    const hunkStartNew = j + 1
    const removedLines: string[] = []
    const addedLines: string[] = []

    // Collect divergent lines until we find a match again
    const lookAhead = 3 // lines to look ahead for re-sync
    let synced = false
    while (i < oldLines.length || j < newLines.length) {
      // Check if we can re-sync
      if (i < oldLines.length && j < newLines.length) {
        // Look for the current old line in upcoming new lines
        let foundInNew = -1
        for (let k = j; k < Math.min(j + lookAhead, newLines.length); k++) {
          if (oldLines[i] === newLines[k]) { foundInNew = k; break }
        }
        // Look for the current new line in upcoming old lines
        let foundInOld = -1
        for (let k = i; k < Math.min(i + lookAhead, oldLines.length); k++) {
          if (newLines[j] === oldLines[k]) { foundInOld = k; break }
        }

        if (foundInNew === j && foundInOld === i) {
          // Lines match — we've re-synced
          synced = true
          break
        }
        if (foundInNew >= 0 && (foundInOld < 0 || foundInNew - j <= foundInOld - i)) {
          // Old line was removed, new lines were added before it
          while (j < foundInNew) { addedLines.push(newLines[j]); j++ }
          removedLines.push(oldLines[i]); i++
          // Continue to see if more changes follow
          continue
        }
        if (foundInOld >= 0) {
          // New line was added, old lines were removed before it
          while (i < foundInOld) { removedLines.push(oldLines[i]); i++ }
          addedLines.push(newLines[j]); j++
          continue
        }
      }

      // No re-sync found — consume both sides
      if (i < oldLines.length) { removedLines.push(oldLines[i]); i++ }
      if (j < newLines.length) { addedLines.push(newLines[j]); j++ }

      // Check if next lines match
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        synced = true
        break
      }
    }

    if (removedLines.length > 0 || addedLines.length > 0) {
      hunks.push(`@@ -${hunkStartOld},${removedLines.length} +${hunkStartNew},${addedLines.length} @@`)
      for (const line of removedLines) hunks.push(`-${line}`)
      for (const line of addedLines) hunks.push(`+${line}`)
    }
  }

  if (hunks.length === 0) return ''

  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}`
}

export function useDocumentMode({ chatId, chat, onAutosaveNotify }: UseDocumentModeParams): UseDocumentModeReturn {
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
  const onAutosaveNotifyRef = useRef(onAutosaveNotify)
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
      // the new baseline instead of flagging the doc as dirty.
      absorbNextContentChangeRef.current = true
      setContentVersion(v => v + 1)
    }
  }, [])

  const persistChatState = useCallback(async (updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>) => {
    try {
      await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: updates }),
      })
    } catch (error) {
      console.error('[DocumentMode] Failed to persist chat document state', error)
    }
  }, [chatId])

  const readDocumentContent = useCallback(async (
    filePath: string,
    scope: ActiveDocument['scope'],
    mountPoint?: string | null,
  ) => {
    const response = await fetch(`/api/v1/chats/${chatId}?action=read-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath,
        scope,
        mountPoint,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to read document content')
    }

    return response.json() as Promise<{ content?: string; mtime?: number }>
  }, [chatId])

  useEffect(() => {
    onAutosaveNotifyRef.current = onAutosaveNotify
  }, [onAutosaveNotify])

  // Initialize from chat data when it loads
  useEffect(() => {
    if (chat) {
      const mode = (chat.documentMode as DocumentMode) || 'normal'
      setDocumentMode(mode)
      setDividerPositionState(chat.dividerPosition || 45)

      // If the chat has an active document association, load it
      if (mode !== 'normal') {
        loadActiveDocument()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.documentMode, chat?.dividerPosition])

  // Load the active document for this chat from the API
  const loadActiveDocument = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=active-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return

      const data = await res.json()
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

      applyDocumentState({
        id: data.document.id,
        filePath: data.document.filePath,
        scope: data.document.scope,
        mountPoint: data.document.mountPoint,
        displayTitle: data.document.displayTitle || data.document.filePath,
        content: contentData.content || '',
        mtime: contentData.mtime,
      })
    } catch (error) {
      console.error('[DocumentMode] Failed to load active document', error)
    }
  }, [applyDocumentState, chatId, readDocumentContent])

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
      const res = await fetch(`/api/v1/chats/${chatId}?action=write-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: activeDocument.filePath,
          scope: activeDocument.scope,
          mountPoint: activeDocument.mountPoint,
          content: contentRef.current,
          mtime: activeDocument.mtime,
        }),
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
      const oldContent = savedContentRef.current
      const newContent = contentRef.current
      savedContentRef.current = newContent
      setIsDirty(false)
      setActiveDocument(prev => prev ? { ...prev, mtime: data.mtime } : null)

      const notifyAutosave = onAutosaveNotifyRef.current
      if (notifyAutosave && oldContent !== newContent && activeDocument) {
        const diff = generateUnifiedDiff(oldContent, newContent, activeDocument.displayTitle || activeDocument.filePath)
        if (diff) {
          notifyAutosave(
            `I've made changes to "${activeDocument.displayTitle || activeDocument.filePath}":\n\n\`\`\`diff\n${diff}\n\`\`\``
          )
        }
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
      const res = await fetch(`/api/v1/chats/${chatId}?action=open-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: params.filePath,
          title: params.title,
          scope: params.scope || 'project',
          mountPoint: params.mountPoint,
          mode: targetMode,
        }),
      })

      if (!res.ok) {
        console.error('[DocumentMode] Failed to open document')
        return null
      }

      const data = await res.json()

      const doc: ActiveDocument = {
        id: data.document.id,
        filePath: data.document.filePath,
        scope: data.document.scope,
        mountPoint: data.document.mountPoint,
        displayTitle: data.document.displayTitle || data.document.filePath,
        content: data.content || '',
        mtime: data.mtime,
      }

      applyDocumentState(doc)
      setDocumentMode(targetMode)

      return doc
    } catch (error) {
      console.error('[DocumentMode] Failed to open document', error)
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
      await fetch(`/api/v1/chats/${chatId}?action=close-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('[DocumentMode] Failed to close document', error)
    }

    applyDocumentState(null, false)
    setDocumentMode('normal')
    await persistMode('normal')
  }, [applyDocumentState, chatId, isDirty, activeDocument, saveDocument, persistMode])

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
      // Fetch the chat to get current documentMode
      const chatRes = await fetch(`/api/v1/chats/${chatId}`)
      if (!chatRes.ok) return
      const chatData = await chatRes.json()
      const mode = (chatData.chat?.documentMode as DocumentMode) || 'normal'
      setDocumentMode(mode)
      setDividerPositionState(chatData.chat?.dividerPosition || 45)

      if (mode !== 'normal') {
        await loadActiveDocument()
      } else {
        applyDocumentState(null, false)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to reload from server', error)
    }
  }, [applyDocumentState, chatId, loadActiveDocument])

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
