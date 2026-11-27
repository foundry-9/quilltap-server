'use client'

/**
 * useDocumentStores Hook
 *
 * The Scriptorium's store list and its writes. The list is the shared
 * `useDocumentStoresQuery` read, so the `mountPoints` realtime topic refreshes
 * it; the writes (`document-store-requests`, shared with the store page) edit
 * the cached entry for their optimistic status and then invalidate it.
 *
 * @module app/scriptorium/hooks/useDocumentStores
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useDocumentStoresQuery, type DocumentStoresResponse } from '@/lib/hooks/use-document-stores'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import {
  convertDocumentStore,
  createDocumentStore,
  deconvertDocumentStore,
  deleteDocumentStore,
  scanCompleteMessage,
  scanDocumentStore,
  updateDocumentStore,
  type ScanResponse,
} from '../document-store-requests'
import type {
  DocumentStore,
  CreateDocumentStoreData,
  UpdateDocumentStoreData,
  ConvertResult,
  DeconvertResult,
  UseDocumentStoresReturn,
} from '../types'

const EMPTY: DocumentStore[] = []

export function useDocumentStores(): UseDocumentStoresReturn {
  const queryClient = useQueryClient()
  const query = useDocumentStoresQuery<DocumentStore>()
  const stores = query.data ?? EMPTY

  /** Edit the cached list in place (optimistic status flips, a row the server returned). */
  const setStores = useCallback(
    (update: (prev: DocumentStore[]) => DocumentStore[]) => {
      queryClient.setQueryData<DocumentStoresResponse<DocumentStore>>(queryKeys.mountPoints.list(), (prev) =>
        prev ? { ...prev, mountPoints: update(prev.mountPoints ?? []) } : prev,
      )
    },
    [queryClient],
  )

  /** Re-read every store list and, given an id, that store's own reads. */
  const refresh = useCallback(
    async (id?: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.lists }),
        id ? queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.store(id) }) : undefined,
      ])
    },
    [queryClient],
  )

  const fetchStores = useCallback(async () => {
    await refresh()
  }, [refresh])

  const createStore = useCallback(async (data: CreateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const result = await createDocumentStore(data)
      await refresh()

      if (result.warning) {
        showErrorToast(result.warning)
      } else {
        showSuccessToast('Document store created successfully!')
      }

      return result.mountPoint
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to create document store')
      console.error('useDocumentStores: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [refresh])

  const updateStore = useCallback(async (id: string, data: UpdateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const result = await updateDocumentStore(id, data)
      setStores(prev => prev.map(s => s.id === id ? result.mountPoint : s))
      await refresh(id)
      showSuccessToast('Document store updated successfully!')

      return result.mountPoint
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to update document store')
      console.error('useDocumentStores: update error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return null
    }
  }, [setStores, refresh])

  const deleteStore = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteDocumentStore(id)

      setStores(prev => prev.filter(s => s.id !== id))
      await queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.all })
      showSuccessToast('Document store deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to delete document store')
      console.error('useDocumentStores: delete error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [setStores, queryClient])

  const scanStore = useCallback(async (id: string): Promise<ScanResponse | null> => {
    try {
      // Optimistically update scan status
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'scanning' as const } : s))

      const result = await scanDocumentStore(id)

      // Re-read the store for its updated counts.
      await refresh(id)

      showSuccessToast(scanCompleteMessage(result))

      if (result.embeddingJobsEnqueued > 0) {
        notifyQueueChange()
      }

      return result
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to scan document store')
      console.error('useDocumentStores: scan error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)

      // Reset scan status on error
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'error' as const } : s))

      return null
    }
  }, [setStores, refresh])

  const convertStore = useCallback(async (id: string): Promise<ConvertResult | null> => {
    try {
      // Optimistically mark the store as converting so the card disables
      // its other action buttons while the request is in flight.
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'converting' as const, conversionError: null }
        : s
      ))

      const result = await convertDocumentStore(id)

      await refresh(id)

      const cr = result.convertResult
      const previousBasePath = result.previousBasePath
      const partsA = [
        `${cr.filesMigrated} file${cr.filesMigrated === 1 ? '' : 's'} migrated`,
      ]
      if (cr.blobsWritten > 0) partsA.push(`${cr.blobsWritten} binary blob${cr.blobsWritten === 1 ? '' : 's'}`)
      if (cr.filesSkipped > 0) partsA.push(`${cr.filesSkipped} skipped`)
      if (cr.errors.length > 0) partsA.push(`${cr.errors.length} error${cr.errors.length === 1 ? '' : 's'}`)
      const suffix = previousBasePath
        ? `. Your original files at ${previousBasePath} remain on disk and are yours to keep or delete.`
        : '. Your original files remain on disk.'
      showSuccessToast(`Converted to database: ${partsA.join(', ')}${suffix}`)

      return cr
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to convert document store')
      console.error('useDocumentStores: convert error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'error' as const, conversionError: errorMsg }
        : s
      ))
      return null
    }
  }, [setStores, refresh])

  const deconvertStore = useCallback(async (id: string, targetPath: string): Promise<DeconvertResult | null> => {
    try {
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'deconverting' as const, conversionError: null }
        : s
      ))

      const result = await deconvertDocumentStore(id, targetPath)

      await refresh(id)

      const dr = result.deconvertResult
      const parts = [`${dr.filesWritten} document${dr.filesWritten === 1 ? '' : 's'}`]
      if (dr.blobsWritten > 0) parts.push(`${dr.blobsWritten} blob${dr.blobsWritten === 1 ? '' : 's'}`)
      if (dr.errors.length > 0) parts.push(`${dr.errors.length} error${dr.errors.length === 1 ? '' : 's'}`)
      showSuccessToast(`Deconverted to filesystem: ${parts.join(', ')} written to ${targetPath}`)

      return dr
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to deconvert document store')
      console.error('useDocumentStores: deconvert error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      setStores(prev => prev.map(s => s.id === id
        ? { ...s, conversionStatus: 'error' as const, conversionError: errorMsg }
        : s
      ))
      return null
    }
  }, [setStores, refresh])

  return {
    stores,
    loading: query.isPending,
    error: query.error ? apiErrorMessage(query.error, 'Failed to fetch document stores') : null,
    fetchStores,
    createStore,
    updateStore,
    deleteStore,
    scanStore,
    convertStore,
    deconvertStore,
  }
}
