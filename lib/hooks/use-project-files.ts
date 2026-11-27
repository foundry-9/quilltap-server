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

import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeListQuery, type EntityListOptions } from './use-profiles'

const unwrapFiles = <F,>(data: { files?: F[] }) => data.files

function projectFilesUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}?action=list-files`
}

export function useProjectFilesQuery<F = { id: string }, R = F[]>(
  projectId: string,
  options?: EntityListOptions<F, R>,
) {
  return useEnvelopeListQuery<{ files?: F[] }, F, R>({
    queryKey: queryKeys.projects.files(projectId),
    url: projectFilesUrl(projectId),
    unwrap: unwrapFiles,
    options,
    enabled: (options?.enabled ?? true) && !!projectId,
  })
}
