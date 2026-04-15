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

interface UseDocumentModeParams {
  chatId: string
  chat: Chat | null
}

interface UseDocumentModeReturn {
  documentMode: DocumentMode
  activeDocument: ActiveDocument | null
  dividerPosition: number
  isDirty: boolean
  isSaving: boolean
  isLLMEditing: boolean
  openDocument: (params: OpenDocumentParams) => Promise<void>
  closeDocument: () => Promise<void>
  toggleFocusMode: () => void
  setDividerPosition: (position: number) => void
  handleContentChange: (content: string) => void
  handleLLMEditStart: () => void
  handleLLMEditEnd: () => Promise<void>
  saveDocument: () => Promise<void>
}

interface OpenDocumentParams {
  filePath?: string
  title?: string
  scope?: 'project' | 'document_store' | 'general'
  mountPoint?: string
  mode?: 'split' | 'focus'
}

const AUTOSAVE_DEBOUNCE_MS = 2500

export function useDocumentMode({ chatId, chat }: UseDocumentModeParams): UseDocumentModeReturn {
  const [documentMode, setDocumentMode] = useState<DocumentMode>('normal')
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null)
  const [dividerPosition, setDividerPositionState] = useState(45)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLLMEditing, setIsLLMEditing] = useState(false)

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<string>('')

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
      const res = await fetch(`/api/v1/chats/${chatId}?action=active-document`)
      if (!res.ok) return

      const data = await res.json()
      if (!data.document) {
        // No active document — reset to normal
        setDocumentMode('normal')
        return
      }

      // Fetch the file content
      const contentRes = await fetch(`/api/v1/chats/${chatId}?action=read-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: data.document.filePath,
          scope: data.document.scope,
          mountPoint: data.document.mountPoint,
        }),
      })

      if (!contentRes.ok) {
        console.error('[DocumentMode] Failed to read document content')
        return
      }

      const contentData = await contentRes.json()

      setActiveDocument({
        id: data.document.id,
        filePath: data.document.filePath,
        scope: data.document.scope,
        mountPoint: data.document.mountPoint,
        displayTitle: data.document.displayTitle || data.document.filePath,
        content: contentData.content || '',
        mtime: contentData.mtime,
      })
      contentRef.current = contentData.content || ''
    } catch (error) {
      console.error('[DocumentMode] Failed to load active document', error)
    }
  }, [chatId])

  // Persist document mode to the server
  const persistMode = useCallback(async (mode: DocumentMode) => {
    try {
      await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { documentMode: mode } }),
      })
    } catch (error) {
      console.error('[DocumentMode] Failed to persist mode', error)
    }
  }, [chatId])

  // Persist divider position to the server
  const persistDividerPosition = useCallback(async (position: number) => {
    try {
      await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { dividerPosition: position } }),
      })
    } catch (error) {
      console.error('[DocumentMode] Failed to persist divider position', error)
    }
  }, [chatId])

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
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setIsDirty(false)
        setActiveDocument(prev => prev ? { ...prev, mtime: data.mtime } : null)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to save document', error)
    } finally {
      setIsSaving(false)
    }
  }, [chatId, activeDocument, isDirty])

  // Handle content changes with debounced autosave
  const handleContentChange = useCallback((content: string) => {
    contentRef.current = content
    setIsDirty(true)
    setActiveDocument(prev => prev ? { ...prev, content } : null)

    // Debounce autosave
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }
    autosaveTimerRef.current = setTimeout(() => {
      saveDocument()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [saveDocument])

  // Open a document
  const openDocument = useCallback(async (params: OpenDocumentParams) => {
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
        return
      }

      const data = await res.json()

      setActiveDocument({
        id: data.document.id,
        filePath: data.document.filePath,
        scope: data.document.scope,
        mountPoint: data.document.mountPoint,
        displayTitle: data.document.displayTitle || data.document.filePath,
        content: data.content || '',
        mtime: data.mtime,
      })
      contentRef.current = data.content || ''
      setIsDirty(false)
      setDocumentMode(targetMode)
    } catch (error) {
      console.error('[DocumentMode] Failed to open document', error)
    }
  }, [chatId, isDirty, activeDocument, saveDocument])

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

    setActiveDocument(null)
    setIsDirty(false)
    setDocumentMode('normal')
    await persistMode('normal')
  }, [chatId, isDirty, activeDocument, saveDocument, persistMode])

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
    setIsLLMEditing(true)
  }, [])

  const handleLLMEditEnd = useCallback(async () => {
    setIsLLMEditing(false)
    // Refetch document content after LLM edits
    if (activeDocument) {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=read-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: activeDocument.filePath,
            scope: activeDocument.scope,
            mountPoint: activeDocument.mountPoint,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          setActiveDocument(prev => prev ? {
            ...prev,
            content: data.content || '',
            mtime: data.mtime,
          } : null)
          contentRef.current = data.content || ''
          setIsDirty(false)
        }
      } catch (error) {
        console.error('[DocumentMode] Failed to refetch document after LLM edit', error)
      }
    }
  }, [chatId, activeDocument])

  // Cleanup autosave timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [])

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
  }
}
