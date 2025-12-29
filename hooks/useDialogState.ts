'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'

/**
 * Options for configuring the useDialogState hook
 */
export interface UseDialogStateOptions<TState> {
  /** Whether the dialog is currently open */
  isOpen: boolean
  /** Initial state to reset to when dialog closes */
  initialState: TState
  /** Optional callback for additional reset logic (e.g., clearing file inputs) */
  onReset?: () => void
  /** Context string for logging - identifies the dialog in logs */
  logContext?: string
}

/**
 * Result type returned by the useDialogState hook
 */
export interface UseDialogStateResult<TState> {
  /** Current dialog state */
  state: TState
  /** Update the state */
  setState: React.Dispatch<React.SetStateAction<TState>>
  /** Reset state to initial values */
  reset: () => void
  /** Update a single field in the state */
  setField: <K extends keyof TState>(field: K, value: TState[K]) => void
  /** Update multiple fields at once */
  setFields: (fields: Partial<TState>) => void
  /** Clear error field if it exists in state */
  clearError: () => void
}

/**
 * Hook to manage dialog state with automatic reset on close and open logging.
 *
 * This hook consolidates the common pattern found in dialog hooks where:
 * - State resets when the dialog closes
 * - Debug logging occurs when the dialog opens
 * - Optional file input refs need to be cleared
 *
 * @template TState - The type of the dialog state
 * @param options - Configuration options for the dialog state
 * @returns Object containing state and state management functions
 *
 * @example
 * const { state, setState, setField, reset } = useDialogState({
 *   isOpen,
 *   initialState: { step: 'file', error: null, importing: false },
 *   logContext: 'useImportKeys',
 *   onReset: () => {
 *     if (fileInputRef.current) fileInputRef.current.value = ''
 *   }
 * })
 */
export function useDialogState<TState>(
  options: UseDialogStateOptions<TState>
): UseDialogStateResult<TState> {
  const { isOpen, initialState, onReset, logContext } = options

  const [state, setState] = useState<TState>(initialState)

  // Store initial state in ref to avoid dependency issues
  const initialStateRef = useRef(initialState)
  const onResetRef = useRef(onReset)

  // Keep refs up to date
  useEffect(() => {
    initialStateRef.current = initialState
    onResetRef.current = onReset
  }, [initialState, onReset])

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      clientLogger.debug('Dialog closed, resetting state', {
        context: logContext || 'useDialogState',
      })
      setState(initialStateRef.current)
      onResetRef.current?.()
    }
  }, [isOpen, logContext])

  // Log when dialog opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('Dialog opened', {
        context: logContext || 'useDialogState',
      })
    }
  }, [isOpen, logContext])

  const reset = useCallback(() => {
    clientLogger.debug('Manual state reset', {
      context: logContext || 'useDialogState',
    })
    setState(initialStateRef.current)
    onResetRef.current?.()
  }, [logContext])

  const setField = useCallback(<K extends keyof TState>(field: K, value: TState[K]) => {
    setState((prev) => ({ ...prev, [field]: value } as TState))
  }, [])

  const setFields = useCallback((fields: Partial<TState>) => {
    setState((prev) => ({ ...prev, ...fields } as TState))
  }, [])

  const clearError = useCallback(() => {
    setState((prev) => {
      if (prev && typeof prev === 'object' && 'error' in prev) {
        return { ...prev, error: null } as TState
      }
      return prev
    })
  }, [])

  return useMemo(
    () => ({
      state,
      setState,
      reset,
      setField,
      setFields,
      clearError,
    }),
    [state, reset, setField, setFields, clearError]
  )
}

/**
 * Hook variant that also manages a file input ref - common pattern for import dialogs
 */
export interface UseDialogStateWithFileInputOptions<TState>
  extends Omit<UseDialogStateOptions<TState>, 'onReset'> {
  /** Additional reset callback beyond clearing the file input */
  onReset?: () => void
}

export interface UseDialogStateWithFileInputResult<TState>
  extends UseDialogStateResult<TState> {
  /** Ref for the file input element */
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

/**
 * Extended useDialogState that automatically manages a file input ref.
 *
 * @example
 * const { state, setState, fileInputRef } = useDialogStateWithFileInput({
 *   isOpen,
 *   initialState: { step: 'file', selectedFile: null },
 *   logContext: 'useImportKeys',
 * })
 *
 * return <input type="file" ref={fileInputRef} />
 */
export function useDialogStateWithFileInput<TState>(
  options: UseDialogStateWithFileInputOptions<TState>
): UseDialogStateWithFileInputResult<TState> {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    options.onReset?.()
  }, [options])

  const dialogState = useDialogState({
    ...options,
    onReset: clearFileInput,
  })

  return useMemo(
    () => ({
      ...dialogState,
      fileInputRef,
    }),
    [dialogState]
  )
}
