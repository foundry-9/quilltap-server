'use client'

/**
 * FilePreviewFallback Component
 *
 * Displays metadata and download option for unsupported file types.
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getFileIcon } from '../FileThumbnail'
import { FileInfo, formatFileSize, formatFileDate, getFileTypeLabel } from '../types'

interface FilePreviewFallbackProps {
  /** The file to show */
  file: FileInfo
  /** URL to download the file */
  fileUrl: string
}

export default function FilePreviewFallback({
  file,
  fileUrl,
}: Readonly<FilePreviewFallbackProps>) {
  useEffect(() => {
    clientLogger.debug('[FilePreviewFallback] Rendering fallback', {
      fileId: file.id,
      mimeType: file.mimeType,
    })
  }, [file.id, file.mimeType])

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[300px] text-center p-8">
      {/* Large file icon */}
      <div className="text-7xl mb-4">{getFileIcon(file.mimeType)}</div>

      {/* File name */}
      <h3 className="text-xl font-semibold mb-2 break-all max-w-md">
        {file.originalFilename || file.filename}
      </h3>

      {/* File metadata */}
      <div className="text-muted-foreground space-y-1 mb-6">
        <p>{getFileTypeLabel(file.mimeType)}</p>
        <p>{formatFileSize(file.size)}</p>
        <p>Added {formatFileDate(file.createdAt)}</p>
      </div>

      {/* Preview not available message */}
      <p className="text-muted-foreground mb-4">
        Preview not available for this file type
      </p>

      {/* Download button */}
      <a
        href={fileUrl}
        download={file.originalFilename || file.filename}
        className="qt-button qt-button-primary"
      >
        Download File
      </a>
    </div>
  )
}
