'use client'

import { useRef, useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { FileConflictInfo, ConflictResolution } from '@/components/chat/FileConflictDialog'

export interface AttachedFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  url: string
}

/**
 * API response types
 */
interface UploadSuccessResponse {
  file: {
    id: string
    filename: string
    filepath: string
    mimeType: string
    url: string
  }
}

interface UploadDuplicateResponse {
  duplicate: true
  conflictType: 'filename' | 'content' | 'both'
  existingFile: {
    id: string
    filename: string
    size: number
    createdAt: string
    sha256: string
  }
  newFile: {
    filename: string
    size: number
    sha256: string
  }
}

type UploadResponse = UploadSuccessResponse | UploadDuplicateResponse | { error: string }

export function useFileAttachments(chatId: string, projectId?: string | null) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Conflict handling state
  const [conflictInfo, setConflictInfo] = useState<FileConflictInfo | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false)
  const [resolvingConflict, setResolvingConflict] = useState(false)

  /**
   * Upload a file with optional resolution for conflict handling
   */
  const uploadFile = useCallback(async (
    file: File,
    resolution?: ConflictResolution,
    conflictingFileId?: string
  ): Promise<boolean> => {
    const formData = new FormData()
    formData.append('file', file)

    if (resolution) {
      formData.append('resolution', resolution)
    }
    if (conflictingFileId) {
      formData.append('conflictingFileId', conflictingFileId)
    }

    const res = await fetch(`/api/v1/chats/${chatId}/files`, {
      method: 'POST',
      body: formData,
    })

    const data = await safeJsonParse<UploadResponse>(res)

    // Check for duplicate response
    if ('duplicate' in data && data.duplicate) {
      clientLogger.debug('[FileAttachments] Duplicate detected', {
        conflictType: data.conflictType,
        existingFilename: data.existingFile.filename,
      })

      // Store conflict info and pending file for resolution
      setConflictInfo({
        conflictType: data.conflictType,
        existingFile: data.existingFile,
        newFile: data.newFile,
      })
      setPendingFile(file)
      setIsConflictDialogOpen(true)
      return false
    }

    // Check for error
    if ('error' in data) {
      throw new Error(data.error)
    }

    // Check for success
    if (!res.ok || !('file' in data)) {
      throw new Error('Failed to upload file')
    }

    // Success - add to attached files
    const uploadedFile = data.file
    setAttachedFiles((prev) => [...prev, {
      id: uploadedFile.id,
      filename: uploadedFile.filename,
      filepath: uploadedFile.filepath,
      mimeType: uploadedFile.mimeType,
      url: uploadedFile.url,
    }])

    return true
  }, [chatId])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    try {
      const success = await uploadFile(file)
      if (success) {
        showSuccessToast('File attached')
      }
      // If not success, conflict dialog is shown
    } catch (err) {
      clientLogger.error('Error uploading file:', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploadingFile(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  /**
   * Handle conflict resolution from the dialog
   */
  const handleConflictResolution = useCallback(async (resolution: ConflictResolution) => {
    if (!pendingFile || !conflictInfo) {
      clientLogger.error('[FileAttachments] No pending file for resolution')
      return
    }

    setResolvingConflict(true)
    try {
      clientLogger.debug('[FileAttachments] Resolving conflict', {
        resolution,
        filename: pendingFile.name,
        conflictingFileId: conflictInfo.existingFile.id,
      })

      const success = await uploadFile(
        pendingFile,
        resolution,
        conflictInfo.existingFile.id
      )

      if (success) {
        const message = resolution === 'skip'
          ? 'Upload skipped'
          : resolution === 'keepBoth'
          ? 'File attached with new name'
          : 'File replaced'
        showSuccessToast(message)
      }

      // Close dialog and clear state
      setIsConflictDialogOpen(false)
      setConflictInfo(null)
      setPendingFile(null)
    } catch (err) {
      clientLogger.error('[FileAttachments] Error resolving conflict:', {
        error: err instanceof Error ? err.message : String(err),
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to resolve conflict')
    } finally {
      setResolvingConflict(false)
    }
  }, [pendingFile, conflictInfo, uploadFile])

  /**
   * Cancel the conflict dialog
   */
  const cancelConflict = useCallback(() => {
    clientLogger.debug('[FileAttachments] Conflict cancelled')
    setIsConflictDialogOpen(false)
    setConflictInfo(null)
    setPendingFile(null)
  }, [])

  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  return {
    attachedFiles,
    setAttachedFiles,
    uploadingFile,
    fileInputRef,
    handleFileSelect,
    removeAttachedFile,
    uploadFile, // Expose for direct file uploads (e.g., from paste)
    // Conflict handling
    conflictInfo,
    isConflictDialogOpen,
    resolvingConflict,
    handleConflictResolution,
    cancelConflict,
  }
}
