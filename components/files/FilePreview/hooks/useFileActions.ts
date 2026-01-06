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
import { FileInfo } from '../../types'

interface UseFileActionsOptions {
  file: FileInfo
  onDelete?: (fileId: string) => void
  onClose?: () => void
}

interface UseFileActionsResult {
  /** Download the file */
  handleDownload: () => void
  /** Delete the file (with confirmation) */
  handleDelete: () => Promise<void>
  /** Whether delete is in progress */
  isDeleting: boolean
}

export function useFileActions({
  file,
  onDelete,
  onClose,
}: UseFileActionsOptions): UseFileActionsResult {
  const [isDeleting, setIsDeleting] = useState(false)

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
    if (!confirm('Are you sure you want to delete this file?')) {
      return
    }

    setIsDeleting(true)
    clientLogger.debug('[useFileActions] Deleting file', { fileId: file.id })

    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
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

  return {
    handleDownload,
    handleDelete,
    isDeleting,
  }
}
