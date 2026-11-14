'use client'

/**
 * useGroupMembers Hook
 *
 * A group's members (`?action=members`, keyed `groups.members(id)`), every
 * character the group could take in (the shared characters list, narrowed),
 * and the add / remove writes. A membership change re-reads the `groups`
 * prefix (member counts, the group pickers keyed by cast) and the
 * character's own stats (its page lists its groups).
 *
 * @module app/aurora/groups/hooks/useGroupMembers
 */

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { GroupMember, UseGroupMembersReturn } from '../../types'
import { useCharactersList } from '@/lib/hooks/use-characters-list'

const EMPTY_MEMBERS: GroupMember[] = []
const toMembers = (rows: GroupMember[]): GroupMember[] => rows.map((c) => ({ id: c.id, name: c.name }))

type MemberWrite = { action: 'addMember' | 'removeMember'; characterId: string }

export function useGroupMembers(groupId: string): UseGroupMembersReturn {
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryKey: queryKeys.groups.members(groupId),
    queryFn: ({ signal }) =>
      apiFetch<{ members?: GroupMember[] }>(`/api/v1/groups/${groupId}?action=members`, { signal }),
    select: (data) => data.members ?? EMPTY_MEMBERS,
  })

  // Every character the group could take in: the shared list, narrowed.
  const { data: allCharacters = EMPTY_MEMBERS } = useCharactersList<GroupMember, GroupMember[]>(undefined, {
    select: toMembers,
  })

  const { mutateAsync: writeMember } = useMutation({
    mutationFn: ({ action, characterId }: MemberWrite) =>
      apiFetch(`/api/v1/groups/${groupId}?action=${action}`, {
        method: action === 'addMember' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      }),
    onSuccess: (_data, { characterId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.characters.stats(characterId) }),
      ]),
  })

  const run = useCallback(
    async (write: MemberWrite, success: string, failure: string): Promise<boolean> => {
      try {
        await writeMember(write)
        showSuccessToast(success)
        return true
      } catch (err) {
        const message = apiErrorMessage(err, failure)
        console.error(`useGroupMembers: ${write.action} error`, { groupId, characterId: write.characterId, message })
        showErrorToast(message)
        return false
      }
    },
    [writeMember, groupId],
  )

  const addMember = useCallback(
    (characterId: string) => run({ action: 'addMember', characterId }, 'Member added to group!', 'Failed to add member'),
    [run],
  )
  const removeMember = useCallback(
    (characterId: string) =>
      run({ action: 'removeMember', characterId }, 'Member removed from group!', 'Failed to remove member'),
    [run],
  )

  return {
    members: membersQuery.data ?? EMPTY_MEMBERS,
    allCharacters,
    loading: membersQuery.isLoading,
    addMember,
    removeMember,
  }
}
