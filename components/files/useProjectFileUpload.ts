'use client'

/**
 * Hook for uploading files to a project
 * Supports multiple file selection and folder path specification
 */

import { useRef, useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

export interface UploadedProjectFile {
  id: string
  originalFilename: string
  mimeType: string
  size: number
  category: string
  folderPath: string
  createdAt: string
}

interface UseProjectFileUploadOptions {
  projectId: string
  folderPath?: string
  onSuccess?: (files: UploadedProjectFile[]) => void
}

interface UploadResponse {
  file?: UploadedProjectFile
  duplicate?: boolean
  error?: string
}

export function useProjectFileUpload({
  projectId,
  folderPath = '/',
  onSuccess,
}: UseProjectFileUploadOptions) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    clientLogger.debug('[useProjectFileUpload] Starting upload', {
      projectId,
      folderPath,
      fileCount: fileArray.length,
    })

    setUploading(true)
    setError(null)
    setUploadProgress({ current: 0, total: fileArray.length })

    const uploadedFiles: UploadedProjectFile[] = []
    const errors: string[] = []

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      setUploadProgress({ current: i + 1, total: fileArray.length })

      try {
        const formData = new FormData()
        formData.append('file', file)
        if (folderPath && folderPath !== '/') {
          formData.append('folderPath', folderPath)
        }

        clientLogger.debug('[useProjectFileUpload] Uploading file', {
          projectId,
          filename: file.name,
          size: file.size,
          mimeType: file.type,
        })

        const res = await fetch(`/api/projects/${projectId}/files/upload`, {
          method: 'POST',
          body: formData,
        })

        const data = await safeJsonParse<UploadResponse>(res)

        if (!res.ok || !data.file) {
          throw new Error(data.error || 'Failed to upload file')
        }

        uploadedFiles.push(data.file)

        if (data.duplicate) {
          clientLogger.debug('[useProjectFileUpload] File was duplicate', {
            filename: file.name,
            fileId: data.file.id,
          })
        } else {
          clientLogger.debug('[useProjectFileUpload] File uploaded successfully', {
            filename: file.name,
            fileId: data.file.id,
          })
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        clientLogger.error('[useProjectFileUpload] Failed to upload file', {
          filename: file.name,
          error: errorMessage,
        })
        errors.push(`${file.name}: ${errorMessage}`)
      }
    }

    setUploading(false)
    setUploadProgress(null)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    // Show results
    if (uploadedFiles.length > 0) {
      const message = uploadedFiles.length === 1
        ? 'File uploaded'
        : `${uploadedFiles.length} files uploaded`
      showSuccessToast(message)
      onSuccess?.(uploadedFiles)
    }

    if (errors.length > 0) {
      setError(errors.join('\n'))
      if (errors.length === 1) {
        showErrorToast(errors[0])
      } else {
        showErrorToast(`${errors.length} files failed to upload`)
      }
    }

    clientLogger.debug('[useProjectFileUpload] Upload complete', {
      projectId,
      uploaded: uploadedFiles.length,
      failed: errors.length,
    })
  }, [projectId, folderPath, onSuccess])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await uploadFiles(files)
  }, [uploadFiles])

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return {
    uploading,
    error,
    uploadProgress,
    fileInputRef,
    uploadFiles,
    handleFileSelect,
    triggerFileSelect,
  }
}
