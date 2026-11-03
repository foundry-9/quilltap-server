'use client'

/**
 * useDocumentStoreDetail Hook
 *
 * One document store's record and the page-level operations on it (edit,
 * scan). The record is the TanStack query the store's folder browser reads
 * too (`queryKeys.mountPoints.detail`), so the `mountPoints` realtime topic
 * keeps the page's counts current as files come and go.
 *
 * @module app/scriptorium/[id]/hooks/useDocumentStoreDetail
 */

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { queryKeys } from '@/lib/query/keys'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { fetchDocumentStore, type DocumentStoreRecord } from '@/components/document-browser/useDocumentStoreSource'
import type { UpdateDocumentStoreData, ScanResult } from '../../types'

interface UseDocumentStoreDetailReturn {
  store: DocumentStoreRecord | null
  loading: boolean
  error: string | null
  scanning: boolean
  /** Re-read the record and listing in place (tab re-activation). */
  refresh: () => Promise<void>
  updateStore: (data: UpdateDocumentStoreData) => Promise<DocumentStoreRecord | null>
  scanStore: () => Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null>
}

export function useDocumentStoreDetail(storeId: string): UseDocumentStoreDetailReturn {
  const queryClient = useQueryClient()
  const [scanning, setScanning] = useState(false)

  const storeQuery = useQuery({
    queryKey: queryKeys.mountPoints.detail(storeId),
    queryFn: ({ signal }) => fetchDocumentStore(storeId, signal),
  })

  const invalidate = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.store(storeId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.lists }),
      ]).then(() => undefined),
    [queryClient, storeId],
  )

  const updateStore = useCallback(
    async (data: UpdateDocumentStoreData): Promise<DocumentStoreRecord | null> => {
      try {
        const result = await apiFetch<{ mountPoint: DocumentStoreRecord }>(`/api/v1/mount-points/${storeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        await invalidate()
        showSuccessToast('Document store updated successfully!')
        return result.mountPoint
      } catch (err) {
        showErrorToast(apiErrorMessage(err, 'Failed to update document store'))
        return null
      }
    },
    [storeId, invalidate],
  )

  const scanStore = useCallback(async () => {
    setScanning(true)
    try {
      const result = await apiFetch<{ scanResult: ScanResult; embeddingJobsEnqueued: number }>(
        `/api/v1/mount-points/${storeId}?action=scan`,
        { method: 'POST' },
      )
      await invalidate()
      showSuccessToast(
        `Scan complete: ${result.scanResult.filesScanned} files scanned, ${result.embeddingJobsEnqueued} embedding jobs queued`,
      )
      if (result.embeddingJobsEnqueued > 0) notifyQueueChange()
      return result
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to scan document store'))
      await invalidate()
      return null
    } finally {
      setScanning(false)
    }
  }, [storeId, invalidate])

  return {
    store: storeQuery.data ?? null,
    loading: storeQuery.isLoading,
    error: storeQuery.error ? apiErrorMessage(storeQuery.error, 'Failed to fetch document store') : null,
    scanning,
    refresh: invalidate,
    updateStore,
    scanStore,
  }
}
