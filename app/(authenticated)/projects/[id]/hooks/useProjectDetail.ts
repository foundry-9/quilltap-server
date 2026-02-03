'use client'

/**
 * useProjectDetail Hook
 *
 * Manages project data and update operations.
 *
 * @module app/(authenticated)/projects/[id]/hooks/useProjectDetail
 */

import { useCallback, useState } from 'react'
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
  handleSaveAgentMode: (enabled: boolean | null) => Promise<void>
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
      const res = await fetch(`/api/v1/projects/${projectId}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
      setEditForm({
        name: data.project.name,
        description: data.project.description || '',
        instructions: data.project.instructions || '',
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load project'
      console.error('useProjectDetail: fetch error', errorMsg)
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update project'
      console.error('useProjectDetail: save error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId, editForm, refreshProjects])

  const handleToggleAllowAnyCharacter = useCallback(async () => {
    if (!project) return
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAnyCharacter: !project.allowAnyCharacter }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(data.project.allowAnyCharacter ? 'Any character can now participate' : 'Only roster characters can participate')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update setting'
      console.error('useProjectDetail: toggle error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [project, projectId])

  const handleSaveAgentMode = useCallback(async (enabled: boolean | null) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAgentModeEnabled: enabled }),
      })

      if (!res.ok) throw new Error('Failed to update agent mode setting')
      const data = await res.json()
      setProject(data.project)
      const message = enabled === null
        ? 'Agent mode set to inherit from global/character'
        : enabled
          ? 'Agent mode enabled by default for project'
          : 'Agent mode disabled by default for project'
      showSuccessToast(message)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update agent mode'
      console.error('useProjectDetail: save agent mode error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

  const handleRemoveCharacter = useCallback(async (characterId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}?action=remove-character`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })

      if (!res.ok) throw new Error('Failed to remove character')
      await fetchProject()
      showSuccessToast('Character removed from project')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove character'
      console.error('useProjectDetail: remove character error', errorMsg)
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
    handleSaveAgentMode,
    handleRemoveCharacter,
  }
}
