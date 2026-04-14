'use client'

/**
 * useDocumentStores Hook
 *
 * Manages document stores data and CRUD operations.
 *
 * @module app/document-stores/hooks/useDocumentStores
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type {
  DocumentStore,
  CreateDocumentStoreData,
  UpdateDocumentStoreData,
  ScanResult,
  UseDocumentStoresReturn,
} from '../types'

export function useDocumentStores(): UseDocumentStoresReturn {
  const [stores, setStores] = useState<DocumentStore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStores = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/v1/mount-points')
      if (!res.ok) throw new Error('Failed to fetch document stores')

      const data = await res.json()
      setStores(data.mountPoints)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useDocumentStores: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createStore = useCallback(async (data: CreateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const res = await fetch('/api/v1/mount-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error('Failed to create document store')

      const result = await res.json()
      setStores(prev => [result.mountPoint, ...prev])

      if (result.warning) {
        showErrorToast(result.warning)
      } else {
        showSuccessToast('Document store created successfully!')
      }

      return result.mountPoint
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create document store'
      console.error('useDocumentStores: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const updateStore = useCallback(async (id: string, data: UpdateDocumentStoreData): Promise<DocumentStore | null> => {
    try {
      const res = await fetch(`/api/v1/mount-points/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error('Failed to update document store')

      const result = await res.json()
      setStores(prev => prev.map(s => s.id === id ? result.mountPoint : s))
      showSuccessToast('Document store updated successfully!')

      return result.mountPoint
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update document store'
      console.error('useDocumentStores: update error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const deleteStore = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/mount-points/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete document store')

      setStores(prev => prev.filter(s => s.id !== id))
      showSuccessToast('Document store deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete document store'
      console.error('useDocumentStores: delete error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [])

  const scanStore = useCallback(async (id: string): Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null> => {
    try {
      // Optimistically update scan status
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'scanning' as const } : s))

      const res = await fetch(`/api/v1/mount-points/${id}?action=scan`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to scan document store')

      const result = await res.json()

      // Refresh the store data after scan to get updated counts
      const storeRes = await fetch(`/api/v1/mount-points/${id}`)
      if (storeRes.ok) {
        const storeData = await storeRes.json()
        setStores(prev => prev.map(s => s.id === id ? storeData.mountPoint : s))
      }

      showSuccessToast(
        `Scan complete: ${result.scanResult.filesScanned} files scanned, ${result.embeddingJobsEnqueued} embedding jobs queued`
      )

      if (result.embeddingJobsEnqueued > 0) {
        notifyQueueChange()
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to scan document store'
      console.error('useDocumentStores: scan error', { error: errorMsg, storeId: id })
      showErrorToast(errorMsg)

      // Reset scan status on error
      setStores(prev => prev.map(s => s.id === id ? { ...s, scanStatus: 'error' as const } : s))

      return null
    }
  }, [])

  return {
    stores,
    loading,
    error,
    fetchStores,
    createStore,
    updateStore,
    deleteStore,
    scanStore,
  }
}
