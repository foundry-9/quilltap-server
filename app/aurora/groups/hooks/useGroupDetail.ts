'use client'

/**
 * useGroupDetail Hook
 *
 * One group's record from the query cache (`groups.detail(id)`), the edit
 * form's draft of it, and the save. A refetch — a tab switch back, a member
 * change — never overwrites a draft the user has edited (#170, `useDraft`).
 * A save writes the response to the cache and re-reads the `groups` prefix,
 * so the Aurora list and the group pickers show the new name and colour.
 *
 * @module app/aurora/groups/hooks/useGroupDetail
 */

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useDraft, type SetDraft } from '@/lib/hooks/use-draft'
import type { Group } from '../../types'

export interface GroupForm {
  name: string
  description: string
  instructions: string
  color: string
  icon: string
}

export interface UseGroupDetailReturn {
  group: Group | null
  loading: boolean
  error: string | null
  formData: GroupForm
  setFormData: SetDraft<GroupForm>
  saving: boolean
  /** Save the form; toasts the outcome. Resolves true on success. */
  save: () => Promise<boolean>
}

const toForm = (g: Group | null): GroupForm => ({
  name: g?.name || '',
  description: g?.description || '',
  instructions: g?.instructions || '',
  color: g?.color || '',
  icon: g?.icon || '',
})

export function useGroupDetail(groupId: string): UseGroupDetailReturn {
  const queryClient = useQueryClient()
  const detailKey = queryKeys.groups.detail(groupId)

  const query = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => apiFetch<{ group: Group }>(`/api/v1/groups/${groupId}`, { signal }),
    select: (data) => data.group,
  })
  const group = query.data ?? null

  const serverForm = useMemo(() => toForm(group), [group])
  const [formData, setFormData] = useDraft(serverForm)

  const mutation = useMutation({
    mutationFn: (form: GroupForm) =>
      apiFetch<{ group: Group }>(`/api/v1/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          instructions: form.instructions || null,
          color: form.color || null,
          icon: form.icon || null,
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(detailKey, data)
      // Names, colours and icons appear in every group list and picker.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.byCharactersAll }),
      ])
    },
  })
  const { mutateAsync: putGroup, isPending: saving } = mutation

  const save = useCallback(async (): Promise<boolean> => {
    try {
      await putGroup(formData)
      showSuccessToast('Group updated successfully!')
      return true
    } catch (err) {
      const message = apiErrorMessage(err, 'Failed to save group')
      console.error('useGroupDetail: save error', { groupId, message })
      showErrorToast(message)
      return false
    }
  }, [putGroup, formData, groupId])

  return {
    group,
    loading: query.isLoading,
    error: query.error ? apiErrorMessage(query.error, 'Failed to fetch group') : null,
    formData,
    setFormData,
    saving,
    save,
  }
}
