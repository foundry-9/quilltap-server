'use client'

/**
 * ChatProjectModal Component
 *
 * Simple modal dialog for assigning or unassigning a chat to/from a project.
 * Moved out of ChatSettingsModal for easier access from the tool palette.
 */

import { useState, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface Project {
  id: string
  name: string
  color?: string | null
}

interface ChatProjectModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  projectId?: string | null
  projectName?: string | null
  onSuccess?: () => void
}

export default function ChatProjectModal({
  isOpen,
  onClose,
  chatId,
  projectId: initialProjectId,
  projectName: initialProjectName,
  onSuccess,
}: Readonly<ChatProjectModalProps>) {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId ?? null
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Update local state when prop changes
  useEffect(() => {
    setSelectedProjectId(initialProjectId ?? null)
  }, [initialProjectId])

  // Fetch projects when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchProjects()
    }
  }, [isOpen, chatId, initialProjectId, initialProjectName])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error('[ChatProjectModal] Failed to fetch projects', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const handleProjectChange = async (projectId: string | null) => {
    // If same as current, just close
    if (projectId === initialProjectId) {
      onClose()
      return
    }

    try {
      setSaving(true)

      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { projectId } }),
      })

      if (!res.ok) {
        let errorMessage = 'Failed to update project'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      setSelectedProjectId(projectId)

      const projectName = projectId
        ? projects.find(p => p.id === projectId)?.name
        : null

      showSuccessToast(
        projectId
          ? `Chat moved to "${projectName}"`
          : 'Chat removed from project'
      )

      onSuccess?.()
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ChatProjectModal] Failed to update project', {
        chatId,
        projectId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to update project')
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = () => {
    handleProjectChange(selectedProjectId)
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmit}
        disabled={saving || loading}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Assign to Project"
      footer={footer}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <div className="space-y-4">
        {initialProjectName && (
          <p className="qt-text-small">
            Currently in: <span className="font-medium">{initialProjectName}</span>
          </p>
        )}

        <div>
          <label htmlFor="chat-project" className="qt-label mb-2">
            Select Project
          </label>
          <select
            id="chat-project"
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            disabled={saving || loading}
            className="qt-select w-full"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {loading && (
            <p className="qt-text-xs mt-2">Loading projects...</p>
          )}
        </div>

        <p className="qt-text-xs text-muted-foreground">
          Organize this chat by assigning it to a project, or remove it from its current project.
        </p>
      </div>
    </BaseModal>
  )
}
