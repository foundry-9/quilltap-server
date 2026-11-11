'use client'

/**
 * `useGroupsQuery` — the one read of the group list (`GET /api/v1/groups`).
 *
 * Keyed `groups.list()`, under the `groups` prefix the Aurora tab refetch
 * sweeps and every group write invalidates, so the Aurora list, the container
 * catalogue and the Save Scenario dialog share one entry. Callers type the
 * row and narrow with `select`.
 *
 * @module lib/hooks/use-groups
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeSelect, type EntityListOptions, type EntityRow } from './use-profiles'

const unwrapGroups = <G,>(data: { groups?: G[] }) => data.groups

export function useGroupsQuery<G = EntityRow, R = G[]>(options?: EntityListOptions<G, R>) {
  const select = useEnvelopeSelect<{ groups?: G[] }, G, R>(unwrapGroups, options?.select)
  return useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: ({ signal }) => apiFetch<{ groups?: G[] }>('/api/v1/groups', { signal }),
    select,
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}
