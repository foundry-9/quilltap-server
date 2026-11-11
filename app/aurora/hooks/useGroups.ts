'use client'

/**
 * useGroups Hook
 *
 * The Aurora group list (the shared `useGroupsQuery` read, with the member
 * count lifted out of `_count`) and its create / delete writes. Every write
 * invalidates the `groups` prefix, so the list, the group pickers and an open
 * group page re-read together.
 *
 * @module app/aurora/hooks/useGroups
 */

import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useGroupsQuery } from '@/lib/hooks/use-groups'
import type { Group, UseGroupsReturn } from '../types'

type GroupRow = Group & { _count?: { members: number } }

const EMPTY_GROUPS: Group[] = []
const withMemberCount = (rows: GroupRow[]): Group[] =>
  rows.map((g) => ({ ...g, memberCount: g._count?.members ?? 0 }))

export function useGroups(): UseGroupsReturn {
  const queryClient = useQueryClient()
  const query = useGroupsQuery<GroupRow, Group[]>({ select: withMemberCount })

  const invalidateGroups = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.groups.all }),
    [queryClient],
  )

  const fetchGroups = useCallback(async () => {
    await invalidateGroups()
  }, [invalidateGroups])

  const { mutateAsync: postGroup } = useMutation({
    mutationFn: (body: { name: string; description?: string | null }) =>
      apiFetch<{ group: Group }>('/api/v1/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateGroups(),
  })

  const { mutateAsync: removeGroup } = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateGroups(),
  })

  const createGroup = useCallback(
    async (name: string, description?: string | null): Promise<Group | null> => {
      try {
        const data = await postGroup({ name, description })
        showSuccessToast('Group created successfully!')
        // New groups have no members yet.
        return { ...data.group, memberCount: 0 }
      } catch (err) {
        const message = apiErrorMessage(err, 'Failed to create group')
        console.error('useGroups: create error', { error: message })
        showErrorToast(message)
        return null
      }
    },
    [postGroup],
  )

  const deleteGroup = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await removeGroup(id)
        showSuccessToast('Group deleted successfully!')
        return true
      } catch (err) {
        const message = apiErrorMessage(err, 'Failed to delete group')
        console.error('useGroups: delete error', { error: message, groupId: id })
        showErrorToast(message)
        return false
      }
    },
    [removeGroup],
  )

  return {
    groups: query.data ?? EMPTY_GROUPS,
    loading: query.isLoading,
    error: query.error ? apiErrorMessage(query.error, 'Failed to fetch groups') : null,
    fetchGroups,
    createGroup,
    deleteGroup,
  }
}
