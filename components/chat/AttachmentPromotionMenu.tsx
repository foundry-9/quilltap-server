'use client'

/**
 * AttachmentPromotionMenu Component
 *
 * Context menu/dropdown for promoting a chat attachment to project or general files.
 * Allows selecting target project and folder.
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

interface AttachmentPromotionMenuProps {
  isOpen: boolean
  onClose: () => void
  attachmentId: string
  attachmentName: string
  /** Current project ID from the chat (if any) */
  currentProjectId?: string | null
  /** Callback after successful promotion */
  onSuccess?: () => void
}

export default function AttachmentPromotionMenu({
  isOpen,
  onClose,
  attachmentId,
  attachmentName,
  currentProjectId,
  onSuccess,
}: Readonly<AttachmentPromotionMenuProps>) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [destination, setDestination] = useState<'project' | 'general'>(
    currentProjectId ? 'project' : 'general'
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    currentProjectId ?? null
  )
  const [selectedFolderPath, setSelectedFolderPath] = useState('/')

  // Fetch projects when modal opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[AttachmentPromotionMenu] Modal opened', {
        attachmentId,
        attachmentName,
        currentProjectId,
      })
      fetchProjects()
      // Reset to defaults
      setDestination(currentProjectId ? 'project' : 'general')
      setSelectedProjectId(currentProjectId ?? null)
      setSelectedFolderPath('/')
    }
  }, [isOpen, attachmentId, attachmentName, currentProjectId])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
        clientLogger.debug('[AttachmentPromotionMenu] Fetched projects', {
          count: data.projects?.length || 0,
        })
      }
    } catch (error) {
      clientLogger.error('[AttachmentPromotionMenu] Failed to fetch projects', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePromote = async () => {
    try {
      setSaving(true)
      clientLogger.debug('[AttachmentPromotionMenu] Promoting attachment', {
        attachmentId,
        destination,
        projectId: destination === 'project' ? selectedProjectId : null,
        folderPath: selectedFolderPath,
      })

      const res = await fetch(`/api/v1/files/${attachmentId}?action=promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProjectId: destination === 'project' ? selectedProjectId : null,
          folderPath: selectedFolderPath,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to promote file')
      }

      const result = await res.json()

      clientLogger.info('[AttachmentPromotionMenu] File promoted', {
        attachmentId,
        result,
      })

      const targetName = destination === 'project'
        ? projects.find(p => p.id === selectedProjectId)?.name || 'project'
        : 'general files'

      showSuccessToast(`"${attachmentName}" saved to ${targetName}`)
      onSuccess?.()
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('[AttachmentPromotionMenu] Failed to promote', {
        attachmentId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to save file')
    } finally {
      setSaving(false)
    }
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
        onClick={handlePromote}
        disabled={saving || loading || (destination === 'project' && !selectedProjectId)}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Saving...' : 'Save File'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Save Attachment"
      footer={footer}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <div className="space-y-4">
        <p className="qt-text-small">
          Save <span className="font-medium">&quot;{attachmentName}&quot;</span> to your files.
        </p>

        {/* Destination selection */}
        <div>
          <label className="qt-label mb-2">Destination</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="destination"
                value="project"
                checked={destination === 'project'}
                onChange={() => setDestination('project')}
                disabled={saving || projects.length === 0}
              />
              <span>Project Files</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="destination"
                value="general"
                checked={destination === 'general'}
                onChange={() => setDestination('general')}
                disabled={saving}
              />
              <span>General Files</span>
            </label>
          </div>
        </div>

        {/* Project selection (when destination is project) */}
        {destination === 'project' && (
          <div>
            <label htmlFor="promotion-project" className="qt-label mb-2">
              Select Project
            </label>
            <select
              id="promotion-project"
              value={selectedProjectId || ''}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
              disabled={saving || loading}
              className="qt-select w-full"
            >
              <option value="">Select a project...</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {loading && (
              <p className="qt-text-xs mt-1">Loading projects...</p>
            )}
          </div>
        )}

        {/* Folder selection */}
        <div>
          <label className="qt-label mb-2">Folder</label>
          <FolderPicker
            value={selectedFolderPath}
            onChange={setSelectedFolderPath}
            projectId={destination === 'project' ? selectedProjectId : null}
            disabled={saving || (destination === 'project' && !selectedProjectId)}
          />
        </div>

        <p className="qt-text-xs text-muted-foreground">
          The file will be copied to the selected location and remain accessible in the original message.
        </p>
      </div>
    </BaseModal>
  )
}
