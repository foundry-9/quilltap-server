'use client'

/**
 * useProjectDocumentStores Hook
 *
 * Manages document stores (mount points) linked to a project.
 *
 * @module app/prospero/[id]/hooks/useProjectDocumentStores
 */

import { useCallback, useState } from 'react'
import type { DocumentStore } from '@/app/scriptorium/types'

interface UseProjectDocumentStoresReturn {
  /** Document stores currently linked to this project */
  linkedStores: DocumentStore[]
  /** All available document stores (for the picker) */
  allStores: DocumentStore[]
  /** Loading state */
  loading: boolean
  /** Fetch linked stores */
  fetchLinkedStores: () => Promise<void>
  /** Fetch all available stores */
  fetchAllStores: () => Promise<void>
  /** Link a document store to this project */
  linkStore: (mountPointId: string) => Promise<boolean>
  /** Unlink a document store from this project */
  unlinkStore: (mountPointId: string) => Promise<boolean>
}

export function useProjectDocumentStores(projectId: string): UseProjectDocumentStoresReturn {
  const [linkedStores, setLinkedStores] = useState<DocumentStore[]>([])
  const [allStores, setAllStores] = useState<DocumentStore[]>([])
  const [loading, setLoading] = useState(false)

  const fetchLinkedStores = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/projects/${projectId}/mount-points`)
      if (res.ok) {
        const data = await res.json()
        setLinkedStores(data.mountPoints || [])
      }
    } catch (err) {
      console.error('useProjectDocumentStores: fetchLinkedStores error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchAllStores = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/mount-points')
      if (res.ok) {
        const data = await res.json()
        setAllStores(data.mountPoints || [])
      }
    } catch (err) {
      console.error('useProjectDocumentStores: fetchAllStores error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const linkStore = useCallback(async (mountPointId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/mount-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mountPointId }),
      })
      if (res.ok) {
        await fetchLinkedStores()
        return true
      }
      return false
    } catch (err) {
      console.error('useProjectDocumentStores: linkStore error', err instanceof Error ? err.message : String(err))
      return false
    }
  }, [projectId, fetchLinkedStores])

  const unlinkStore = useCallback(async (mountPointId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/mount-points`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mountPointId }),
      })
      if (res.ok) {
        await fetchLinkedStores()
        return true
      }
      return false
    } catch (err) {
      console.error('useProjectDocumentStores: unlinkStore error', err instanceof Error ? err.message : String(err))
      return false
    }
  }, [projectId, fetchLinkedStores])

  return {
    linkedStores,
    allStores,
    loading,
    fetchLinkedStores,
    fetchAllStores,
    linkStore,
    unlinkStore,
  }
}
