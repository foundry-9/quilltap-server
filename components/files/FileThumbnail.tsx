'use client'

/**
 * FileThumbnail Component
 *
 * Displays a thumbnail for image files or a fallback icon for other file types.
 * Uses the thumbnail API for on-demand generation with caching.
 */

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface FileThumbnailProps {
  /** File ID for thumbnail generation */
  fileId: string
  /** MIME type to determine if thumbnail is available */
  mimeType: string
  /** Alt text for the thumbnail */
  alt: string
  /** Size of the thumbnail (default 150) */
  size?: number
  /** Additional CSS classes */
  className?: string
}

/**
 * Get file type icon based on MIME type
 */
function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '\u{1F5BC}\uFE0F' // framed picture
  if (mimeType.startsWith('video/')) return '\u{1F3AC}' // clapper board
  if (mimeType.startsWith('audio/')) return '\u{1F3B5}' // musical note
  if (mimeType === 'application/pdf') return '\u{1F4C4}' // page facing up
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '\u{1F4CA}' // bar chart
  if (mimeType.includes('document') || mimeType.includes('word')) return '\u{1F4DD}' // memo
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript')) return '\u{1F4DC}' // scroll
  if (mimeType.startsWith('text/')) return '\u{1F4C3}' // page with curl
  return '\u{1F4C1}' // file folder
}

/**
 * Check if MIME type supports thumbnail generation
 */
function supportsThumbnail(mimeType: string): boolean {
  const supportedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
  ]
  return supportedTypes.includes(mimeType.toLowerCase())
}

export default function FileThumbnail({
  fileId,
  mimeType,
  alt,
  size = 150,
  className = '',
}: Readonly<FileThumbnailProps>) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const canShowThumbnail = supportsThumbnail(mimeType)
  const thumbnailUrl = canShowThumbnail ? `/api/files/${fileId}/thumbnail?size=${size}` : null

  // Lazy loading with Intersection Observer
  useEffect(() => {
    if (!containerRef.current || !canShowThumbnail) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '100px', // Start loading 100px before visible
        threshold: 0,
      }
    )

    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [canShowThumbnail])

  // Log mount
  useEffect(() => {
    clientLogger.debug('[FileThumbnail] Mounted', {
      fileId,
      mimeType,
      canShowThumbnail,
      size,
    })
  }, [fileId, mimeType, canShowThumbnail, size])

  const handleLoad = () => {
    setStatus('loaded')
    clientLogger.debug('[FileThumbnail] Thumbnail loaded', { fileId })
  }

  const handleError = () => {
    setStatus('error')
    clientLogger.warn('[FileThumbnail] Thumbnail load failed', { fileId, mimeType })
  }

  // Fallback icon display
  const renderFallbackIcon = () => (
    <div
      className={`flex items-center justify-center bg-muted text-4xl ${className}`}
      style={{ width: size, height: size }}
    >
      {getFileIcon(mimeType)}
    </div>
  )

  // If not an image type, show icon
  if (!canShowThumbnail) {
    return renderFallbackIcon()
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-muted ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-muted-foreground/20" />
      )}

      {/* Thumbnail image */}
      {isVisible && thumbnailUrl && status !== 'error' && (
        <img
          src={thumbnailUrl}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
        />
      )}

      {/* Error fallback - show icon */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-4xl">
          {getFileIcon(mimeType)}
        </div>
      )}
    </div>
  )
}

export { getFileIcon, supportsThumbnail }
