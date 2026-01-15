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

interface FileAssociation {
  characters: { id: string; name: string; usage: string }[]
  messages: { chatId: string; chatName: string; messageId: string }[]
}

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
  /** Pending delete info when file has associations */
  pendingDelete: {
    fileId: string
    associations: FileAssociation
  } | null
  /** Confirm deletion with dissociation */
  confirmDelete: () => Promise<void>
  /** Cancel pending delete */
  cancelDelete: () => void
}

export function useFileActions({
  file,
  onDelete,
  onMoveToProject,
  onClose,
}: UseFileActionsOptions): UseFileActionsResult {
  const [isDeleting, setIsDeleting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{
    fileId: string
    associations: FileAssociation
  } | null>(null)

  // Files can always be moved - to a project, between projects, or back to general files
  const canMoveToProject = true

  const handleDownload = useCallback(() => {
    clientLogger.debug('[useFileActions] Downloading file', {
      fileId: file.id,
      filename: file.originalFilename,
    })

    // Create a download link
    const link = document.createElement('a')
    link.href = `/api/v1/files/${file.id}`
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
      // No longer using force=true - respect associations
      const response = await fetch(`/api/v1/files/${file.id}`, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        clientLogger.debug('[useFileActions] File deleted', { fileId: file.id })
        showSuccessToast('File deleted')
        onDelete?.(file.id)
        onClose?.()
      } else if (data.details?.code === 'FILE_HAS_ASSOCIATIONS') {
        // File has associations - show confirmation dialog
        clientLogger.debug('[useFileActions] File has associations', {
          fileId: file.id,
          associations: data.details.associations,
        })
        setPendingDelete({
          fileId: file.id,
          associations: data.details.associations,
        })
      } else {
        throw new Error(data.error || 'Failed to delete file')
      }
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

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return

    setIsDeleting(true)
    clientLogger.debug('[useFileActions] Confirming delete with dissociation', {
      fileId: pendingDelete.fileId,
    })

    try {
      const response = await fetch(`/api/v1/files/${pendingDelete.fileId}?dissociate=true`, {
        method: 'DELETE',
      })

      if (response.ok) {
        clientLogger.debug('[useFileActions] File deleted with dissociation', {
          fileId: pendingDelete.fileId,
        })
        showSuccessToast('File deleted')
        setPendingDelete(null)
        onDelete?.(pendingDelete.fileId)
        onClose?.()
      } else {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete file'
      clientLogger.error('[useFileActions] Delete with dissociation failed', {
        fileId: pendingDelete.fileId,
        error: message,
      })
      showErrorToast(message)
    } finally {
      setIsDeleting(false)
    }
  }, [pendingDelete, onDelete, onClose])

  const cancelDelete = useCallback(() => {
    setPendingDelete(null)
  }, [])

  return {
    handleDownload,
    handleDelete,
    handleMoveToProject,
    isDeleting,
    canMoveToProject,
    pendingDelete,
    confirmDelete,
    cancelDelete,
  }
}
