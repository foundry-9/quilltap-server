'use client'

import { useState, useCallback } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import type { MountPoint, AvailableBackend, ConnectionTestResult, MountPointFormData } from '../types'

interface UseMountPointsResult {
  mountPoints: MountPoint[]
  availableBackends: AvailableBackend[]
  loading: boolean
  error: string | null
  loadData: () => Promise<void>
  fetchMountPoints: () => Promise<void>
  createMountPoint: (data: MountPointFormData) => Promise<MountPoint | null>
  updateMountPoint: (id: string, data: Partial<MountPointFormData>) => Promise<boolean>
  deleteMountPoint: (id: string) => Promise<boolean>
  testConnection: (id: string) => Promise<ConnectionTestResult>
  setDefault: (id: string) => Promise<boolean>
}

/**
 * Hook to manage mount points data fetching and operations
 */
export function useMountPoints(): UseMountPointsResult {
  const [mountPoints, setMountPoints] = useState<MountPoint[]>([])
  const [availableBackends, setAvailableBackends] = useState<AvailableBackend[]>([])

  const { loading, error, execute: executeLoad } = useAsyncOperation<void>()

  const loadData = useCallback(async () => {
    await executeLoad(async () => {
      const [mountPointsRes, backendsRes] = await Promise.all([
        fetchJson<{ mountPoints: MountPoint[] }>('/api/v1/system/mount-points'),
        fetchJson<{ backends: AvailableBackend[] }>('/api/v1/system/mount-points?action=list-backends'),
      ])

      if (!mountPointsRes.ok) {
        throw new Error(mountPointsRes.error || 'Failed to fetch mount points')
      }

      if (mountPointsRes.data?.mountPoints) {
        setMountPoints(mountPointsRes.data.mountPoints)
      }

      // The backends API returns an object with backends array
      if (backendsRes.ok && backendsRes.data?.backends) {
        setAvailableBackends(backendsRes.data.backends)
      } else {
        // Default to local backend if backend list fails
        setAvailableBackends([
          {
            backendId: 'local',
            displayName: 'Local Filesystem',
            description: 'Store files on the local server filesystem',
            configFields: [
              {
                name: 'basePath',
                label: 'Base Path',
                type: 'string',
                required: false,
                description: 'Base directory for file storage (uses default if not set)',
                placeholder: '/app/data/files',
              },
            ],
          },
        ])
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchMountPoints = useCallback(async () => {
    const result = await fetchJson<{ mountPoints: MountPoint[] }>('/api/v1/system/mount-points')
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch mount points')
    }
    if (result.data?.mountPoints) {
      setMountPoints(result.data.mountPoints)
    }
  }, [])

  const createMountPoint = useCallback(async (data: MountPointFormData): Promise<MountPoint | null> => {
    const result = await fetchJson<{ mountPoint: MountPoint }>('/api/v1/system/mount-points', {
      method: 'POST',
      body: JSON.stringify(data),
    })

    if (!result.ok) {
      throw new Error(result.error || 'Failed to create mount point')
    }

    if (result.data?.mountPoint) {
      setMountPoints((prev) => [...prev, result.data!.mountPoint])
      return result.data.mountPoint
    }

    return null
  }, [])

  const updateMountPoint = useCallback(
    async (id: string, data: Partial<MountPointFormData>): Promise<boolean> => {
      const result = await fetchJson<{ mountPoint: MountPoint }>(`/api/v1/system/mount-points/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to update mount point')
      }

      if (result.data?.mountPoint) {
        setMountPoints((prev) => prev.map((mp) => (mp.id === id ? result.data!.mountPoint : mp)))
      }

      return true
    },
    []
  )

  const deleteMountPoint = useCallback(async (id: string): Promise<boolean> => {
    const result = await fetchJson<{ success: boolean }>(`/api/v1/system/mount-points/${id}`, {
      method: 'DELETE',
    })

    if (!result.ok) {
      throw new Error(result.error || 'Failed to delete mount point')
    }

    setMountPoints((prev) => prev.filter((mp) => mp.id !== id))
    return true
  }, [])

  const testConnection = useCallback(async (id: string): Promise<ConnectionTestResult> => {
    const result = await fetchJson<ConnectionTestResult>(`/api/v1/system/mount-points/${id}?action=test`, {
      method: 'POST',
    })

    if (!result.ok) {
      // Still refresh to show any health status changes
      await fetchMountPoints()
      return {
        success: false,
        message: result.error || 'Connection test failed',
      }
    }

    // Refresh mount points to update health status in UI
    await fetchMountPoints()

    return result.data || { success: false, message: 'No response from server' }
  }, [fetchMountPoints])

  const setDefault = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await fetchJson<MountPoint>(`/api/v1/system/mount-points/${id}?action=set-default`, {
        method: 'POST',
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to set default mount point')
      }

      // Refresh mount points to get updated isDefault flag
      await fetchMountPoints()
      return true
    },
    [fetchMountPoints]
  )

  return {
    mountPoints,
    availableBackends,
    loading,
    error,
    loadData,
    fetchMountPoints,
    createMountPoint,
    updateMountPoint,
    deleteMountPoint,
    testConnection,
    setDefault,
  }
}
