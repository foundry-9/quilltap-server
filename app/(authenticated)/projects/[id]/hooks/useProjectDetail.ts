'use client'

/**
 * useProjectDetail Hook
 *
 * Manages project data and update operations.
 *
 * @module app/(authenticated)/projects/[id]/hooks/useProjectDetail
 */

import { useCallback, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import type { Project, EditForm } from '../types'

interface UseProjectDetailReturn {
  project: Project | null
  loading: boolean
  error: string | null
  editForm: EditForm
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>
  isEditing: boolean
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>
  fetchProject: () => Promise<void>
  handleSave: () => Promise<void>
  handleToggleAllowAnyCharacter: () => Promise<void>
  handleRemoveCharacter: (characterId: string) => Promise<void>
}

export function useProjectDetail(projectId: string): UseProjectDetailReturn {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({ name: '', description: '', instructions: '' })
  const { refreshProjects } = useSidebarData()

  const fetchProject = useCallback(async () => {
    try {
      clientLogger.debug('useProjectDetail: fetching project', { projectId })
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
      setEditForm({
        name: data.project.name,
        description: data.project.description || '',
        instructions: data.project.instructions || '',
      })
      clientLogger.debug('useProjectDetail: loaded project', { projectId: data.project.id })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load project'
      clientLogger.error('useProjectDetail: fetch error', { error: errorMsg, projectId })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const handleSave = useCallback(async () => {
    try {
      clientLogger.debug('useProjectDetail: saving project', { projectId })
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          instructions: editForm.instructions || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      setIsEditing(false)
      showSuccessToast('Project updated!')
      refreshProjects()
      clientLogger.info('useProjectDetail: saved project', { projectId })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update project'
      clientLogger.error('useProjectDetail: save error', { error: errorMsg, projectId })
      showErrorToast(errorMsg)
    }
  }, [projectId, editForm, refreshProjects])

  const handleToggleAllowAnyCharacter = useCallback(async () => {
    if (!project) return
    try {
      clientLogger.debug('useProjectDetail: toggling allowAnyCharacter', { projectId, current: project.allowAnyCharacter })
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAnyCharacter: !project.allowAnyCharacter }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(data.project.allowAnyCharacter ? 'Any character can now participate' : 'Only roster characters can participate')
      clientLogger.info('useProjectDetail: toggled allowAnyCharacter', { projectId, allowAnyCharacter: data.project.allowAnyCharacter })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update setting'
      clientLogger.error('useProjectDetail: toggle error', { error: errorMsg, projectId })
      showErrorToast(errorMsg)
    }
  }, [project, projectId])

  const handleRemoveCharacter = useCallback(async (characterId: string) => {
    try {
      clientLogger.debug('useProjectDetail: removing character', { projectId, characterId })
      const res = await fetch(`/api/projects/${projectId}/characters?characterId=${characterId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove character')
      await fetchProject()
      showSuccessToast('Character removed from project')
      clientLogger.info('useProjectDetail: removed character', { projectId, characterId })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove character'
      clientLogger.error('useProjectDetail: remove character error', { error: errorMsg, projectId, characterId })
      showErrorToast(errorMsg)
    }
  }, [projectId, fetchProject])

  return {
    project,
    loading,
    error,
    editForm,
    setEditForm,
    isEditing,
    setIsEditing,
    fetchProject,
    handleSave,
    handleToggleAllowAnyCharacter,
    handleRemoveCharacter,
  }
}
