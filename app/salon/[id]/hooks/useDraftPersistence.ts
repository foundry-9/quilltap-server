'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseDraftPersistenceParams {
  chatId: string
  input: string
  setInput: (value: string) => void
}

export function useDraftPersistence({ chatId, input, setInput }: UseDraftPersistenceParams) {
  const draftStorageKey = `quilltap-draft-${chatId}`
  const draftSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedDraftRef = useRef<string>('')
  const hasRestoredDraftRef = useRef<boolean>(false)

  // Restore draft from localStorage on mount
  useEffect(() => {
    if (hasRestoredDraftRef.current) return
    hasRestoredDraftRef.current = true

    try {
      const savedDraft = localStorage.getItem(draftStorageKey)
      if (savedDraft) {
        setInput(savedDraft)
        lastSavedDraftRef.current = savedDraft
      }
    } catch {
      // Failed to restore draft from localStorage
    }
  }, [draftStorageKey, setInput])

  // Save draft to localStorage with debouncing (5 second minimum)
  useEffect(() => {
    // Don't save if input hasn't changed from last save
    if (input === lastSavedDraftRef.current) return

    // Clear any existing timer
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current)
    }

    // Set new timer for 5 seconds
    draftSaveTimerRef.current = setTimeout(() => {
      try {
        if (input.trim()) {
          localStorage.setItem(draftStorageKey, input)
          lastSavedDraftRef.current = input
        } else {
          // Clear draft if input is empty
          localStorage.removeItem(draftStorageKey)
          lastSavedDraftRef.current = ''
        }
      } catch {
        // Failed to save draft to localStorage
      }
    }, 5000)

    // Cleanup timer on unmount or input change
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current)
      }
    }
  }, [input, draftStorageKey])

  // Helper to clear draft (called on successful submission)
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftStorageKey)
      lastSavedDraftRef.current = ''
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current)
        draftSaveTimerRef.current = null
      }
    } catch {
      // Failed to clear draft from localStorage
    }
  }, [draftStorageKey])

  return { clearDraft }
}
