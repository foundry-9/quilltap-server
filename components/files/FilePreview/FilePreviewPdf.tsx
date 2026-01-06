'use client'

/**
 * FilePreviewPdf Component
 *
 * Renders a PDF file in the preview modal using an iframe.
 */

import { useState, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { FilePreviewRendererProps } from './types'

export default function FilePreviewPdf({
  file,
  fileUrl,
}: Readonly<FilePreviewRendererProps>) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    clientLogger.debug('[FilePreviewPdf] Rendering PDF', {
      fileId: file.id,
    })
  }, [file.id])

  const handleLoad = () => {
    setIsLoading(false)
    clientLogger.debug('[FilePreviewPdf] PDF loaded', { fileId: file.id })
  }

  const handleError = () => {
    setIsLoading(false)
    setError('Failed to load PDF. Try downloading instead.')
    clientLogger.error('[FilePreviewPdf] PDF load failed', { fileId: file.id })
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading PDF...</div>
        </div>
      )}

      {error ? (
        <div className="text-center text-muted-foreground">
          <div className="text-4xl mb-2">{'\u{1F4C4}'}</div>
          <p>{error}</p>
          <a
            href={fileUrl}
            download={file.originalFilename || file.filename}
            className="qt-button qt-button-primary mt-4 inline-block"
          >
            Download PDF
          </a>
        </div>
      ) : (
        <iframe
          src={fileUrl}
          title={file.originalFilename || file.filename || 'PDF Document'}
          className={`w-full h-[70vh] border-0 rounded transition-opacity duration-200 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
