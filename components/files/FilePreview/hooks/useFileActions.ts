'use client'

/**
 * useFileActions Hook
 *
 * Provides action handlers for file operations:
 * - Download
 * - Delete
 * - Future: Move, Rename, Associate with characters/projects
 */

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { FileInfo } from '../../types'

interface UseFileActionsOptions {
  file: FileInfo
  onDelete?: (fileId: string) => void
  onMoveToProject?: (fileId: string) => void
  onClose?: () => void
}

interface UseFileActionsResult {
  /** Download the file */
  handleDownload: () => void
  /** Delete the file (with confirmation) */
  handleDelete: () => Promise<void>
  /** Move file (opens modal) */
  handleMoveToProject: () => void
  /** Whether delete is in progress */
  isDeleting: boolean
  /** Whether the file can be moved (always true - can move to project, between projects, or to general) */
  canMoveToProject: boolean
}

export function useFileActions({
  file,
  onDelete,
  onMoveToProject,
  onClose,
}: UseFileActionsOptions): UseFileActionsResult {
  const [isDeleting, setIsDeleting] = useState(false)

  // Files can always be moved - to a project, between projects, or back to general files
  const canMoveToProject = true

  const handleDownload = useCallback(() => {
    clientLogger.debug('[useFileActions] Downloading file', {
      fileId: file.id,
      filename: file.originalFilename,
    })

    // Create a download link
    const link = document.createElement('a')
    link.href = `/api/files/${file.id}`
    link.download = file.originalFilename || file.filename || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    showSuccessToast('Download started')
  }, [file])

  const handleDelete = useCallback(async () => {
    const confirmed = await showConfirmation('Are you sure you want to delete this file? This cannot be undone.')
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    clientLogger.debug('[useFileActions] Deleting file', { fileId: file.id })

    try {
      // Use force=true since user is explicitly deleting from file preview
      const response = await fetch(`/api/files/${file.id}?force=true`, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete file')
      }

      clientLogger.debug('[useFileActions] File deleted', { fileId: file.id })
      showSuccessToast('File deleted')

      // Notify parent component
      onDelete?.(file.id)
      onClose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete file'
      clientLogger.error('[useFileActions] Delete failed', {
        fileId: file.id,
        error: message,
      })
      showErrorToast(message)
    } finally {
      setIsDeleting(false)
    }
  }, [file, onDelete, onClose])

  const handleMoveToProject = useCallback(() => {
    clientLogger.debug('[useFileActions] Opening move modal', {
      fileId: file.id,
      filename: file.originalFilename,
      currentProjectId: file.projectId,
    })

    onMoveToProject?.(file.id)
  }, [file, onMoveToProject])

  return {
    handleDownload,
    handleDelete,
    handleMoveToProject,
    isDeleting,
    canMoveToProject,
  }
}
