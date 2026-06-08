'use client'

/**
 * useGroupMountPoints Hook
 *
 * Manages document stores (mount points) linked to a group.
 *
 * @module app/aurora/groups/hooks/useGroupMountPoints
 */

import { useCallback, useState } from 'react'
import type { DocumentStore, UseGroupMountPointsReturn } from '../../types'

export function useGroupMountPoints(groupId: string): UseGroupMountPointsReturn {
  const [linkedStores, setLinkedStores] = useState<DocumentStore[]>([])
  const [allStores, setAllStores] = useState<DocumentStore[]>([])
  const [loading, setLoading] = useState(false)

  const fetchLinkedStores = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/groups/${groupId}/mount-points`)
      if (res.ok) {
        const data = await res.json()
        setLinkedStores(data.mountPoints || [])
      }
    } catch (err) {
      console.error('useGroupMountPoints: fetchLinkedStores error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  const fetchAllStores = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/mount-points')
      if (res.ok) {
        const data = await res.json()
        setAllStores(data.mountPoints || [])
      }
    } catch (err) {
      console.error('useGroupMountPoints: fetchAllStores error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const linkStore = useCallback(async (mountPointId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/groups/${groupId}/mount-points`, {
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
      console.error('useGroupMountPoints: linkStore error', err instanceof Error ? err.message : String(err))
      return false
    }
  }, [groupId, fetchLinkedStores])

  const unlinkStore = useCallback(async (mountPointId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/groups/${groupId}/mount-points`, {
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
      console.error('useGroupMountPoints: unlinkStore error', err instanceof Error ? err.message : String(err))
      return false
    }
  }, [groupId, fetchLinkedStores])

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
