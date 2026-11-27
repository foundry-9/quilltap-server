'use client'

/**
 * useProjects Hook
 *
 * The Prospero project list and its create / delete writes. The list is the
 * shared `useProjectsQuery` read, so the `projects` realtime topic and every
 * other view's write refresh it; this hook's writes invalidate the list key
 * rather than splicing a private copy.
 *
 * @module app/prospero/hooks/useProjects
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useCreateProject, useProjectsQuery } from '@/lib/hooks/use-projects'
import type { Project, UseProjectsReturn } from '../types'

type ProjectRow = Project & { _count?: { chats: number; files: number; characters: number } }

/** The API returns `_count`; the cards want `chatCount` / `fileCount` / `characterCount`. */
function withCounts(rows: ProjectRow[]): Project[] {
  return rows.map((p) => ({
    ...p,
    chatCount: p._count?.chats ?? 0,
    fileCount: p._count?.files ?? 0,
    characterCount: p._count?.characters ?? 0,
  }))
}

const EMPTY: Project[] = []

export function useProjects(): UseProjectsReturn {
  const queryClient = useQueryClient()
  const query = useProjectsQuery<ProjectRow, Project[]>({ select: withCounts })

  const fetchProjects = useCallback(async () => {
    // A re-read keeps the current list on screen (no loading flip), which is
    // what lets an in-place project detail stay mounted.
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists })
  }, [queryClient])

  const createProject = useCreateProject<Project>()

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      await apiFetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
      showSuccessToast('Project deleted successfully!')
      return true
    } catch (err) {
      const errorMsg = apiErrorMessage(err, 'Failed to delete project')
      console.error('useProjects: delete error', { error: errorMsg, projectId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [queryClient])

  return {
    projects: query.data ?? EMPTY,
    loading: query.isPending,
    error: query.error ? apiErrorMessage(query.error, 'Failed to fetch projects') : null,
    fetchProjects,
    createProject,
    deleteProject,
  }
}
