'use client'

/**
 * FilePreviewImage Component
 *
 * Renders an image file in the preview modal.
 */

import { useState, useEffect } from 'react'
import { FilePreviewRendererProps } from './types'

export default function FilePreviewImage({
  file,
  fileUrl,
}: Readonly<FilePreviewRendererProps>) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Image renderer mounted
  }, [file.id, file.mimeType])

  const handleLoad = () => {
    setIsLoading(false)
  }

  const handleError = () => {
    setIsLoading(false)
    setError('Failed to load image')
    // Use warn instead of error - this is handled gracefully via error state
    console.warn('[FilePreviewImage] Image load failed', { fileId: file.id })
  }

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[300px]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading image...</div>
        </div>
      )}

      {error ? (
        <div className="text-center text-muted-foreground">
          <div className="text-4xl mb-2">{'\u{1F5BC}\uFE0F'}</div>
          <p>{error}</p>
        </div>
      ) : (
        <img
          src={fileUrl}
          alt={file.originalFilename || file.filename || 'Image'}
          className={`max-w-full max-h-[70vh] object-contain transition-opacity duration-200 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
