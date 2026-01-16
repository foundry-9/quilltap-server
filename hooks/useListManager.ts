'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { getErrorMessage } from '@/lib/error-utils'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

/**
 * Options for configuring the useListManager hook
 */
export interface UseListManagerOptions<T> {
  /** Function to fetch items from the API */
  fetchFn: () => Promise<T[]>
  /** Optional function to delete an item by ID */
  deleteFn?: (id: string) => Promise<void>
  /** The field name to use as the unique identifier (defaults to 'id') */
  idField?: keyof T
  /** Confirmation message for delete operations */
  deleteConfirmMessage?: string
  /** Success message shown after deletion */
  deleteSuccessMessage?: string
  /** Whether to auto-fetch on mount (defaults to true) */
  autoFetch?: boolean
}

/**
 * Result type returned by the useListManager hook
 */
export interface UseListManagerResult<T> {
  /** The list of items */
  items: T[]
  /** Whether data is currently loading */
  loading: boolean
  /** Error message if an error occurred */
  error: string | null
  /** ID of item currently being deleted */
  deletingId: string | null
  /** Item currently being edited */
  editingItem: T | null
  /** Whether the editor modal is visible */
  showEditor: boolean
  /** Refetch items from the API */
  refetch: () => Promise<void>
  /** Handle deleting an item */
  handleDelete: (id: string) => Promise<void>
  /** Handle editing an item (opens editor) */
  handleEdit: (item: T) => void
  /** Handle creating a new item (opens editor with no item) */
  handleCreate: () => void
  /** Close the editor modal */
  handleEditorClose: () => void
  /** Called after successfully saving in editor */
  handleEditorSave: () => void
  /** Set the error message */
  setError: (msg: string | null) => void
  /** Set items directly (for local updates) */
  setItems: React.Dispatch<React.SetStateAction<T[]>>
}

/**
 * Hook to manage CRUD list operations with loading, error, and editor states
 *
 * This hook consolidates the common state management pattern found in list components
 * like memory-list.tsx, physical-description-list.tsx, and settings tabs.
 *
 * @template T - The type of items in the list (must have an 'id' field by default)
 * @param options - Configuration options for the list manager
 * @returns Object containing list state and handlers
 *
 * @example
 * const {
 *   items,
 *   loading,
 *   error,
 *   deletingId,
 *   editingItem,
 *   showEditor,
 *   handleDelete,
 *   handleEdit,
 *   handleCreate,
 *   handleEditorClose,
 *   handleEditorSave,
 * } = useListManager({
 *   fetchFn: async () => {
 *     const res = await fetch('/api/v1/memories')
 *     if (!res.ok) throw new Error('Failed to fetch')
 *     return (await res.json()).memories
 *   },
 *   deleteFn: async (id) => {
 *     const res = await fetch(`/api/v1/memories/${id}`, { method: 'DELETE' })
 *     if (!res.ok) throw new Error('Failed to delete')
 *   },
 *   deleteConfirmMessage: 'Are you sure you want to delete this memory?',
 *   deleteSuccessMessage: 'Memory deleted',
 * })
 */
export function useListManager<T extends Record<string, any>>(
  options: UseListManagerOptions<T>
): UseListManagerResult<T> {
  const {
    fetchFn,
    deleteFn,
    idField = 'id' as keyof T,
    deleteConfirmMessage = 'Are you sure you want to delete this item?',
    deleteSuccessMessage = 'Item deleted',
    autoFetch = true,
  } = options

  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<T | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  // Use refs to store functions to avoid dependency array issues that cause infinite loops
  const fetchFnRef = useRef(fetchFn)
  const deleteFnRef = useRef(deleteFn)
  const hasFetchedRef = useRef(false)

  // Keep refs up to date
  useEffect(() => {
    fetchFnRef.current = fetchFn
    deleteFnRef.current = deleteFn
  }, [fetchFn, deleteFn])

  const refetch = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchFnRef.current()
      setItems(data)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to fetch items')
      console.error('useListManager: Fetch failed', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (autoFetch && !hasFetchedRef.current) {
      hasFetchedRef.current = true
      refetch()
    }
  }, [autoFetch, refetch])

  const handleDelete = useCallback(async (id: string) => {
    if (!deleteFnRef.current) {
      return
    }

    const confirmed = await showConfirmation(deleteConfirmMessage)
    if (!confirmed) {
      return
    }

    setDeletingId(id)
    try {
      await deleteFnRef.current(id)
      setItems(prev => prev.filter(item => String(item[idField]) !== id))
      showSuccessToast(deleteSuccessMessage)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to delete')
      console.error('useListManager: Delete failed', { id, error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setDeletingId(null)
    }
  }, [deleteConfirmMessage, deleteSuccessMessage, idField])

  const handleEdit = useCallback((item: T) => {
    setEditingItem(item)
    setShowEditor(true)
  }, [])

  const handleCreate = useCallback(() => {
    setEditingItem(null)
    setShowEditor(true)
  }, [])

  const handleEditorClose = useCallback(() => {
    setShowEditor(false)
    setEditingItem(null)
  }, [])

  const handleEditorSave = useCallback(() => {
    setShowEditor(false)
    setEditingItem(null)
    refetch()
  }, [refetch])

  return {
    items,
    loading,
    error,
    deletingId,
    editingItem,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
    setError,
    setItems,
  }
}
