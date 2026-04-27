'use client'

/**
 * FileThumbnail Component
 *
 * Displays a thumbnail for image files or a fallback icon for other file types.
 * Uses the thumbnail API for on-demand generation with caching.
 */

import { useState, useEffect, useRef } from 'react'
import { buildMountBlobUrl } from './mountBlobUrl'

interface FileThumbnailProps {
  /** File ID for thumbnail generation (legacy files-table id) */
  fileId: string
  /** MIME type to determine if thumbnail is available */
  mimeType: string
  /** Alt text for the thumbnail */
  alt: string
  /** Size of the thumbnail (default 150) */
  size?: number
  /** Additional CSS classes */
  className?: string
  /**
   * When present, the thumbnail resolves to the mount-point blob endpoint
   * rather than the legacy /api/v1/files/{id} thumbnail action. The blob
   * endpoint serves the full bytes; the browser scales with CSS.
   */
  mountPointId?: string
  relativePath?: string
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

const MAX_RETRIES = 2
const RETRY_BASE_DELAY = 1000

export default function FileThumbnail({
  fileId,
  mimeType,
  alt,
  size = 150,
  className = '',
  mountPointId,
  relativePath,
}: Readonly<FileThumbnailProps>) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [isVisible, setIsVisible] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canShowThumbnail = supportsThumbnail(mimeType)
  const isMountBlob = !!mountPointId && !!relativePath
  const retryQuery = retryCount > 0 ? `${isMountBlob ? '?' : '&'}_r=${retryCount}` : ''
  const thumbnailUrl = canShowThumbnail
    ? (isMountBlob
        ? `${buildMountBlobUrl(mountPointId, relativePath)}${retryQuery}`
        : `/api/v1/files/${fileId}?action=thumbnail&size=${size}${retryQuery}`)
    : null

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

  // Cleanup retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  const handleLoad = () => {
    setStatus('loaded')
  }

  const handleError = () => {
    if (retryCount < MAX_RETRIES) {
      // Exponential backoff: 1s, 2s
      const delay = RETRY_BASE_DELAY * Math.pow(2, retryCount)
      retryTimerRef.current = setTimeout(() => {
        setRetryCount(prev => prev + 1)
        setStatus('loading')
      }, delay)
    } else {
      setStatus('error')
      console.warn('[FileThumbnail] Thumbnail load failed after retries', { fileId, mimeType })
    }
  }

  // Fallback icon display
  const renderFallbackIcon = () => (
    <div
      className={`flex items-center justify-center qt-bg-muted text-4xl ${className}`}
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
      className={`relative overflow-hidden qt-bg-muted ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse qt-bg-muted-foreground/20" />
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
