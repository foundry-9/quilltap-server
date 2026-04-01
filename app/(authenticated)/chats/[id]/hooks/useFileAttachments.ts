'use client'

import { useRef, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

export interface AttachedFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  url: string
}

export function useFileAttachments(chatId: string) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/chats/${chatId}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await safeJsonParse<{ file?: { id: string; filepath: string; mimeType: string; url: string }; error?: string }>(res)

      if (!res.ok || !data.file) {
        throw new Error(data.error || 'Failed to upload file')
      }
      const uploadedFile = data.file
      setAttachedFiles((prev) => [...prev, {
        id: uploadedFile.id,
        filename: file.name,
        filepath: uploadedFile.filepath,
        mimeType: uploadedFile.mimeType,
        url: uploadedFile.url,
      }])
      showSuccessToast('File attached')
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
  }
}
