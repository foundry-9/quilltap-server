'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseDraftPersistenceParams {
  chatId: string
  /**
   * External setter for the composer value. Used once on mount to restore a
   * saved draft (which the composer's ComposerSyncPlugin then pushes into the
   * editor). NOT called on every keystroke.
   */
  setInput: (value: string) => void
}

/**
 * Draft persistence for the chat composer.
 *
 * Restore runs once on mount via `setInput`. Saving is imperative
 * (`persistDraft`) and driven by the editor's own debounced markdown emit, so
 * it writes to localStorage via a ref without ever triggering a React
 * re-render of the (large) Salon page — that decoupling is what keeps typing
 * from re-rendering the tree.
 */
export function useDraftPersistence({ chatId, setInput }: UseDraftPersistenceParams) {
  const draftStorageKey = `quilltap-draft-${chatId}`
  const hasRestoredDraftRef = useRef<boolean>(false)

  // Restore draft from localStorage on mount.
  useEffect(() => {
    if (hasRestoredDraftRef.current) return
    hasRestoredDraftRef.current = true

    try {
      const savedDraft = localStorage.getItem(draftStorageKey)
      if (savedDraft) {
        setInput(savedDraft)
      }
    } catch {
      // Failed to restore draft from localStorage
    }
  }, [draftStorageKey, setInput])

  // Persist (or clear) the draft. The caller (composer editor) already debounces
  // this emit, so we write straight through with no state update.
  const persistDraft = useCallback((text: string) => {
    try {
      if (text.trim()) {
        localStorage.setItem(draftStorageKey, text)
      } else {
        localStorage.removeItem(draftStorageKey)
      }
    } catch {
      // Failed to persist draft to localStorage
    }
  }, [draftStorageKey])

  return { persistDraft }
}
