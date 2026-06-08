'use client'

/**
 * useGroups Hook
 *
 * Manages groups data and CRUD operations.
 *
 * @module app/aurora/hooks/useGroups
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { Group, UseGroupsReturn } from '../types'

export function useGroups(): UseGroupsReturn {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/v1/groups')
      if (!res.ok) throw new Error('Failed to fetch groups')

      const data = await res.json()
      // Map API response to expected format (API returns _count.members, UI expects memberCount)
      const mappedGroups = data.groups.map((g: Group & { _count?: { members: number } }) => ({
        ...g,
        memberCount: g._count?.members ?? 0,
      }))
      setGroups(mappedGroups)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useGroups: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createGroup = useCallback(async (name: string, description?: string | null): Promise<Group | null> => {
    try {
      const res = await fetch('/api/v1/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })

      if (!res.ok) throw new Error('Failed to create group')

      const data = await res.json()
      // New groups have 0 members
      const newGroup: Group = {
        ...data.group,
        memberCount: 0,
      }
      setGroups(prev => [newGroup, ...prev])
      showSuccessToast('Group created successfully!')

      return newGroup
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create group'
      console.error('useGroups: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [])

  const deleteGroup = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/groups/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete group')

      setGroups(prev => prev.filter(g => g.id !== id))
      showSuccessToast('Group deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete group'
      console.error('useGroups: delete error', { error: errorMsg, groupId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [])

  return {
    groups,
    loading,
    error,
    fetchGroups,
    createGroup,
    deleteGroup,
  }
}
