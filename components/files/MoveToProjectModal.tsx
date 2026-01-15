'use client'

/**
 * MoveToProjectModal Component
 *
 * Modal for moving files between projects or to/from general files.
 * Allows selecting target project and folder within that project.
 */

import { useState, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import FolderPicker from '@/components/files/FolderPicker'

interface Project {
  id: string
  name: string
}

// Special value for "General Files" option
const GENERAL_FILES_VALUE = '__general__'

interface MoveToProjectModalProps {
  isOpen: boolean
  onClose: () => void
  fileId: string
  fileName: string
  /** Current project ID (null if file is in general files) */
  currentProjectId?: string | null
  /** Callback after successful move (projectId is null when moved to general files) */
  onSuccess?: (projectId: string | null, projectName: string) => void
}

export default function MoveToProjectModal({
  isOpen,
  onClose,
  fileId,
  fileName,
  currentProjectId,
  onSuccess,
}: Readonly<MoveToProjectModalProps>) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedValue, setSelectedValue] = useState<string>('')
  const [selectedFolderPath, setSelectedFolderPath] = useState('/')

  // Determine if a project is selected (vs general files)
  const isGeneralFilesSelected = selectedValue === GENERAL_FILES_VALUE
  const selectedProjectId = isGeneralFilesSelected ? null : (selectedValue || null)

  // Filter out current project from the list
  const availableProjects = projects.filter(p => p.id !== currentProjectId)

  // Fetch projects when modal opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[MoveToProjectModal] Modal opened', {
        fileId,
        fileName,
        currentProjectId,
      })
      fetchProjects()
      // Reset selections
      setSelectedValue('')
      setSelectedFolderPath('/')
    }
  }, [isOpen, fileId, fileName, currentProjectId])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
        clientLogger.debug('[MoveToProjectModal] Fetched projects', {
          count: data.projects?.length || 0,
        })
      }
    } catch (error) {
      clientLogger.error('[MoveToProjectModal] Failed to fetch projects', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleMove = async () => {
    // Must have a selection (either a project or general files)
    if (!selectedValue) return

    try {
      setSaving(true)
      const targetProjectId = isGeneralFilesSelected ? null : selectedProjectId

      clientLogger.debug('[MoveToProjectModal] Moving file', {
        fileId,
        targetProjectId,
        folderPath: selectedFolderPath,
        isGeneralFiles: isGeneralFilesSelected,
      })

      const res = await fetch(`/api/v1/files/${fileId}?action=promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProjectId,
          folderPath: isGeneralFilesSelected ? '/' : selectedFolderPath,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to move file')
      }

      const result = await res.json()
      const projectName = isGeneralFilesSelected
        ? 'General Files'
        : (projects.find(p => p.id === targetProjectId)?.name || 'project')

      clientLogger.info('[MoveToProjectModal] File moved', {
        fileId,
        targetProjectId,
        projectName,
        result,
      })

      showSuccessToast(`"${fileName}" moved to ${projectName}`)
      onSuccess?.(targetProjectId, projectName)
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('[MoveToProjectModal] Failed to move file', {
        fileId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to move file')
    } finally {
      setSaving(false)
    }
  }

  // Determine title and button text based on context
  const modalTitle = currentProjectId ? 'Move File' : 'Move to Project'
  const buttonText = isGeneralFilesSelected ? 'Move to General Files' : 'Move to Project'

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
        onClick={handleMove}
        disabled={saving || loading || !selectedValue}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Moving...' : buttonText}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      footer={footer}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <div className="space-y-4">
        <p className="qt-text-small">
          Move <span className="font-medium">&quot;{fileName}&quot;</span> to a different location.
        </p>

        {/* Destination selection */}
        <div>
          <label htmlFor="move-to-project" className="qt-label mb-2">
            Select Destination
          </label>
          <select
            id="move-to-project"
            value={selectedValue}
            onChange={(e) => {
              setSelectedValue(e.target.value)
              setSelectedFolderPath('/') // Reset folder when selection changes
            }}
            disabled={saving || loading}
            className="qt-select w-full"
          >
            <option value="">Select a destination...</option>
            {/* Show "General Files" option if file is currently in a project */}
            {currentProjectId && (
              <option value={GENERAL_FILES_VALUE}>General Files (No Project)</option>
            )}
            {availableProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {loading && (
            <p className="qt-text-xs mt-1 text-muted-foreground">Loading projects...</p>
          )}
          {!loading && availableProjects.length === 0 && !currentProjectId && (
            <p className="qt-text-xs mt-1 text-muted-foreground">No projects found. Create a project first.</p>
          )}
        </div>

        {/* Folder selection (only show when a project is selected, not for general files) */}
        {selectedProjectId && !isGeneralFilesSelected && (
          <div>
            <label className="qt-label mb-2">Folder</label>
            <FolderPicker
              value={selectedFolderPath}
              onChange={setSelectedFolderPath}
              projectId={selectedProjectId}
              disabled={saving}
            />
          </div>
        )}

        <p className="qt-text-xs text-muted-foreground">
          {isGeneralFilesSelected
            ? 'The file will be moved to General Files. Any existing links to chats or characters will be preserved.'
            : 'The file will be moved to the selected project. Any existing links to chats or characters will be preserved.'}
        </p>
      </div>
    </BaseModal>
  )
}
