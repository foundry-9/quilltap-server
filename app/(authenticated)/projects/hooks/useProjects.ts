'use client'

/**
 * useProjects Hook
 *
 * Manages projects data and CRUD operations.
 *
 * @module app/(authenticated)/projects/hooks/useProjects
 */

import { useCallback, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import type { Project, UseProjectsReturn } from '../types'

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { refreshProjects: refreshSidebar } = useSidebarData()

  const fetchProjects = useCallback(async () => {
    try {
      clientLogger.debug('useProjects: fetching projects')
      setLoading(true)
      setError(null)

      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')

      const data = await res.json()
      setProjects(data.projects)
      clientLogger.debug('useProjects: fetched projects', { count: data.projects.length })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      clientLogger.error('useProjects: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createProject = useCallback(async (name: string, description: string | null): Promise<Project | null> => {
    try {
      clientLogger.debug('useProjects: creating project', { name })

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })

      if (!res.ok) throw new Error('Failed to create project')

      const data = await res.json()
      setProjects(prev => [data.project, ...prev])
      refreshSidebar()
      showSuccessToast('Project created successfully!')
      clientLogger.info('useProjects: created project', { projectId: data.project.id })

      return data.project
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create project'
      clientLogger.error('useProjects: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [refreshSidebar])

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      clientLogger.debug('useProjects: deleting project', { projectId: id })

      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete project')

      setProjects(prev => prev.filter(p => p.id !== id))
      refreshSidebar()
      showSuccessToast('Project deleted successfully!')
      clientLogger.info('useProjects: deleted project', { projectId: id })

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete project'
      clientLogger.error('useProjects: delete error', { error: errorMsg, projectId: id })
      showErrorToast(errorMsg)
      return false
    }
  }, [refreshSidebar])

  return {
    projects,
    loading,
    error,
    fetchProjects,
    createProject,
    deleteProject,
  }
}
