'use client'

/**
 * `useProjectFilesQuery` — the one read of a project's files
 * (`GET /api/v1/projects/{id}?action=list-files`).
 *
 * Keyed `projects.files(id)`, under the `projects` prefix the Prospero tab
 * refetch sweeps, so the project page's Files card and the Move-to-Project
 * folder picker share one entry. Callers type the row and narrow with `select`.
 *
 * @module lib/hooks/use-project-files
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeSelect, type EntityListOptions } from './use-profiles'

const unwrapFiles = <F,>(data: { files?: F[] }) => data.files

export function projectFilesUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}?action=list-files`
}

export function useProjectFilesQuery<F = { id: string }, R = F[]>(
  projectId: string,
  options?: EntityListOptions<F, R>,
) {
  const select = useEnvelopeSelect<{ files?: F[] }, F, R>(unwrapFiles, options?.select)
  return useQuery({
    queryKey: queryKeys.projects.files(projectId),
    queryFn: ({ signal }) => apiFetch<{ files?: F[] }>(projectFilesUrl(projectId), { signal }),
    select,
    enabled: (options?.enabled ?? true) && !!projectId,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}
