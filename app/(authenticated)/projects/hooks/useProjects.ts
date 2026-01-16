'use client'

/**
 * useProjects Hook
 *
 * Manages projects data and CRUD operations.
 *
 * @module app/(authenticated)/projects/hooks/useProjects
 */

import { useCallback, useState } from 'react'
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
      setLoading(true)
      setError(null)

      const res = await fetch('/api/v1/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')

      const data = await res.json()
      setProjects(data.projects)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('useProjects: fetch error', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  const createProject = useCallback(async (name: string, description: string | null): Promise<Project | null> => {
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })

      if (!res.ok) throw new Error('Failed to create project')

      const data = await res.json()
      setProjects(prev => [data.project, ...prev])
      refreshSidebar()
      showSuccessToast('Project created successfully!')

      return data.project
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create project'
      console.error('useProjects: create error', { error: errorMsg })
      showErrorToast(errorMsg)
      return null
    }
  }, [refreshSidebar])

  const deleteProject = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete project')

      setProjects(prev => prev.filter(p => p.id !== id))
      refreshSidebar()
      showSuccessToast('Project deleted successfully!')

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete project'
      console.error('useProjects: delete error', { error: errorMsg, projectId: id })
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
