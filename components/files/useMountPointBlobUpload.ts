'use client'

/**
 * Hook for uploading files directly into a database-backed Scriptorium mount
 * point. PUTs each selected file to the canonical per-file item route
 * /api/v1/mount-points/{id}/files/{relativePath} (multipart `file`). The
 * current folder is prepended to the relative path so uploads land where the
 * browser is currently viewing. The pipeline transcodes images, routes native
 * text to the document store, and rewrites the stored path (e.g. .png→.webp),
 * so we read the actual written path back from the response.
 */

import { useRef, useState, useCallback } from 'react'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { buildMountFileItemUrl } from './mountBlobUrl'

interface UseMountPointBlobUploadOptions {
  mountPointId: string
  /** Folder path in the form '/' or '/images/' — trailing slash tolerated. */
  folderPath?: string
  onSuccess?: () => void
}

interface UploadResponse {
  // The canonical item route returns the stored file's metadata directly.
  relativePath?: string
  error?: string
}

function buildRelativePath(folderPath: string, filename: string): string {
  const trimmed = folderPath.replace(/^\/+|\/+$/g, '')
  return trimmed ? `${trimmed}/${filename}` : filename
}

export function useMountPointBlobUpload({
  mountPointId,
  folderPath = '/',
  onSuccess,
}: UseMountPointBlobUploadOptions) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setUploading(true)
    setError(null)
    setUploadProgress({ current: 0, total: fileArray.length })

    const uploaded: string[] = []
    const errors: string[] = []

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      setUploadProgress({ current: i + 1, total: fileArray.length })

      try {
        const formData = new FormData()
        formData.append('file', file)

        const relativePath = buildRelativePath(folderPath, file.name)
        const res = await fetch(buildMountFileItemUrl(mountPointId, relativePath), {
          method: 'PUT',
          body: formData,
        })

        const data = await safeJsonParse<UploadResponse>(res)
        if (!res.ok || !data.relativePath) {
          throw new Error(data.error || 'Failed to upload file')
        }
        uploaded.push(data.relativePath)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[useMountPointBlobUpload] Upload failed', {
          mountPointId,
          filename: file.name,
          error: message,
        })
        errors.push(`${file.name}: ${message}`)
      }
    }

    setUploading(false)
    setUploadProgress(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    if (uploaded.length > 0) {
      showSuccessToast(uploaded.length === 1 ? 'File uploaded' : `${uploaded.length} files uploaded`)
      onSuccess?.()
    }

    if (errors.length > 0) {
      setError(errors.join('\n'))
      showErrorToast(errors.length === 1 ? errors[0] : `${errors.length} files failed to upload`)
    }
  }, [mountPointId, folderPath, onSuccess])

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
