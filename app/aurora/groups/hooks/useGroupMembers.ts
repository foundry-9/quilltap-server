'use client'

/**
 * useGroupMembers Hook
 *
 * Manages group members and member operations.
 *
 * @module app/aurora/groups/hooks/useGroupMembers
 */

import { useCallback, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { GroupMember, UseGroupMembersReturn } from '../../types'
import { useCharactersList } from '@/lib/hooks/use-characters-list'

const EMPTY_MEMBERS: GroupMember[] = []
const toMembers = (rows: GroupMember[]): GroupMember[] => rows.map((c) => ({ id: c.id, name: c.name }))

export function useGroupMembers(groupId: string): UseGroupMembersReturn {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(false)

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/groups/${groupId}?action=members`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
      }
    } catch (err) {
      console.error('useGroupMembers: fetchMembers error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  // Every character the group could take in: the shared list, narrowed.
  const { data: allCharacters = EMPTY_MEMBERS, refetch: refetchCharacters } = useCharactersList<
    GroupMember,
    GroupMember[]
  >(undefined, { select: toMembers })
  const fetchAllCharacters = useCallback(async () => {
    await refetchCharacters()
  }, [refetchCharacters])

  const addMember = useCallback(async (characterId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/groups/${groupId}?action=addMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })
      if (res.ok) {
        await fetchMembers()
        showSuccessToast('Member added to group!')
        return true
      }
      return false
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to add member'
      console.error('useGroupMembers: addMember error', { error: errorMsg })
      showErrorToast(errorMsg)
      return false
    }
  }, [groupId, fetchMembers])

  const removeMember = useCallback(async (characterId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/groups/${groupId}?action=removeMember`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })
      if (res.ok) {
        await fetchMembers()
        showSuccessToast('Member removed from group!')
        return true
      }
      return false
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove member'
      console.error('useGroupMembers: removeMember error', { error: errorMsg })
      showErrorToast(errorMsg)
      return false
    }
  }, [groupId, fetchMembers])

  return {
    members,
    allCharacters,
    loading,
    fetchMembers,
    fetchAllCharacters,
    addMember,
    removeMember,
  }
}
