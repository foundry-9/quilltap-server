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

export function useGroupMembers(groupId: string): UseGroupMembersReturn {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [allCharacters, setAllCharacters] = useState<GroupMember[]>([])
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

  const fetchAllCharacters = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/characters')
      if (res.ok) {
        const data = await res.json()
        // Map characters to GroupMember format
        const characters = data.characters.map((c: any) => ({
          id: c.id,
          name: c.name,
        }))
        setAllCharacters(characters)
      }
    } catch (err) {
      console.error('useGroupMembers: fetchAllCharacters error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

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
