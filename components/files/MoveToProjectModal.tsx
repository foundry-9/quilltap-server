'use client'

/**
 * MoveToProjectModal Component
 *
 * Modal for moving files between projects or to/from general files.
 * Allows selecting target project and folder within that project.
 */

import { useState, useEffect } from 'react'
import useSWR from 'swr'
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
  const [saving, setSaving] = useState(false)
  const [selectedValue, setSelectedValue] = useState<string>('')
  const [selectedFolderPath, setSelectedFolderPath] = useState('/')

  const { data: projectsData, isLoading } = useSWR<{ projects: Project[] }>(
    isOpen ? '/api/v1/projects' : null
  )
  const projects = projectsData?.projects || []

  // Determine if a project is selected (vs general files)
  const isGeneralFilesSelected = selectedValue === GENERAL_FILES_VALUE
  const selectedProjectId = isGeneralFilesSelected ? null : (selectedValue || null)

  // Filter out current project from the list
  const availableProjects = projects.filter(p => p.id !== currentProjectId)

  // Reset selections when modal opens (modal-reset pattern)
  useEffect(() => {
    if (isOpen) {
      // Reset selections
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
      setSelectedValue('')
      setSelectedFolderPath('/')
    }
  }, [isOpen])

  const handleMove = async () => {
    // Must have a selection (either a project or general files)
    if (!selectedValue) return

    try {
      setSaving(true)
      const targetProjectId = isGeneralFilesSelected ? null : selectedProjectId

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

      showSuccessToast(`"${fileName}" moved to ${projectName}`)
      onSuccess?.(targetProjectId, projectName)
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[MoveToProjectModal] Failed to move file', {
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
        disabled={saving || isLoading || !selectedValue}
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
            disabled={saving || isLoading}
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
          {isLoading && (
            <p className="qt-text-xs mt-1 qt-text-secondary">Loading projects...</p>
          )}
          {!isLoading && availableProjects.length === 0 && !currentProjectId && (
            <p className="qt-text-xs mt-1 qt-text-secondary">No projects found. Create a project first.</p>
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

        <p className="qt-text-xs qt-text-secondary">
          {isGeneralFilesSelected
            ? 'The file will be moved to General Files. Any existing links to chats or characters will be preserved.'
            : 'The file will be moved to the selected project. Any existing links to chats or characters will be preserved.'}
        </p>
      </div>
    </BaseModal>
  )
}
