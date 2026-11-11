'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useApiKeysQuery, useConnectionProfilesQuery } from '@/lib/hooks/use-profiles'
import { showErrorToast } from '@/lib/toast'
import type { ConnectionProfile, ApiKey, ProviderConfig } from '../types'

const EMPTY_PROFILES: ConnectionProfile[] = []
const EMPTY_KEYS: ApiKey[] = []
const EMPTY_PROVIDERS: ProviderConfig[] = []

/**
 * The Settings "by kind" connection-profiles tab's data and writes.
 *
 * Reads are the shared list queries (`lib/hooks/use-profiles.ts`), so a
 * profile created, deleted or reordered here shows in every picker on the
 * page and in the by-provider card at once; writes invalidate the shared key
 * rather than re-fetching into private state.
 */
export function useConnectionProfiles() {
  const queryClient = useQueryClient()
  const profilesQuery = useConnectionProfilesQuery<ConnectionProfile>({ refetchOnMount: 'always' })
  const { data: apiKeys = EMPTY_KEYS } = useApiKeysQuery<ApiKey>()
  const { data: providers = EMPTY_PROVIDERS } = useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: ({ signal }) => apiFetch<{ providers?: ProviderConfig[] }>('/api/v1/providers', { signal }),
    select: (data) => data.providers ?? EMPTY_PROVIDERS,
  })
  const { data: cheapDefaultProfileId = null } = useChatSettingsQuery(
    (settings) => settings.cheapLLMSettings?.defaultCheapProfileId ?? null,
  )
  const triggerAutoAssociate = useAutoAssociate()
  const [deleting, setDeleting] = useState(false)

  const refreshProfiles = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.connectionProfiles.all }),
    [queryClient],
  )

  /** A write whose success refreshes the shared list; failures toast. */
  const write = useCallback(
    async (url: string, init: RequestInit, failure: string): Promise<boolean> => {
      try {
        await apiFetch(url, init)
        await refreshProfiles()
        return true
      } catch (err) {
        const message = apiErrorMessage(err, failure)
        console.error('[ConnectionProfiles] write failed', { url, message })
        showErrorToast(message)
        return false
      }
    },
    [refreshProfiles],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(true)
      try {
        return await write(`/api/v1/connection-profiles/${id}`, { method: 'DELETE' }, 'Failed to delete profile')
      } finally {
        setDeleting(false)
      }
    },
    [write],
  )

  const reorderProfiles = useCallback(
    async (order: Array<{ id: string; sortIndex: number }>) => {
      await write(
        '/api/v1/connection-profiles?action=reorder',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) },
        'Failed to reorder profiles',
      )
    },
    [write],
  )

  const resetSort = useCallback(async () => {
    await write(
      '/api/v1/connection-profiles?action=reset-sort',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      'Failed to reset sort order',
    )
  }, [write])

  /** Re-read the profiles and keys (after the modal saves). */
  const refreshAfterSave = useCallback(async () => {
    await Promise.all([
      refreshProfiles(),
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
    ])
  }, [refreshProfiles, queryClient])

  return {
    profiles: profilesQuery.data ?? EMPTY_PROFILES,
    apiKeys,
    providers,
    cheapDefaultProfileId,
    loading: profilesQuery.isPending,
    error: profilesQuery.error ? apiErrorMessage(profilesQuery.error, 'Failed to fetch profiles') : null,
    deleting,
    /** Re-read the profile list everywhere it is shown. */
    refreshProfiles,
    refreshAfterSave,
    handleDelete,
    triggerAutoAssociate,
    reorderProfiles,
    resetSort,
  }
}
