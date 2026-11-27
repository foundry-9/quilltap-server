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

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeListQuery, type EntityListOptions, type EntityRow } from './use-profiles'

const unwrapProjects = <P,>(data: { projects?: P[] }) => data.projects

export function useProjectsQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  return useEnvelopeListQuery<{ projects?: P[] }, P, R>({
    queryKey: queryKeys.projects.list(),
    url: '/api/v1/projects',
    unwrap: unwrapProjects,
    options,
  })
}

/**
 * Create a project (`POST /api/v1/projects`) and re-read every project list.
 * Toasts the outcome; resolves the new project, or null on failure.
 */
export function useCreateProject<P = EntityRow>() {
  const queryClient = useQueryClient()
  return useCallback(async (name: string, description: string | null): Promise<P | null> => {
    try {
      const data = await apiFetch<{ project: P }>('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists })
      showSuccessToast('Project created successfully!')
      return data.project
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to create project')
      console.error('useCreateProject: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [queryClient])
}
