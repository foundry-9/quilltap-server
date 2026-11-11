'use client'

/**
 * `useProjectsQuery` — the one read of the project list (`GET /api/v1/projects`).
 *
 * Keyed by `queryKeys.projects.list()`, which the `projects` realtime topic
 * and the workspace tab refetch both sweep, so a project created, renamed or
 * deleted anywhere refreshes the Prospero list and every project picker.
 * Callers type the row and narrow with `select`.
 *
 * @module lib/hooks/use-projects
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { EntityListOptions, EntityRow } from './use-profiles'

export function useProjectsQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => apiFetch<{ projects?: P[] }>('/api/v1/projects', { signal }),
    select: (data) => {
      const rows = data.projects ?? []
      return select ? select(rows) : (rows as unknown as R)
    },
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}
