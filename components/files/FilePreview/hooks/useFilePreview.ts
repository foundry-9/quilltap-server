'use client'

/**
 * useFilePreview Hook
 *
 * Manages file preview state including preview type detection,
 * text content loading, and navigation.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileInfo } from '../../types'
import { PreviewType, getPreviewType } from '../types'

const MAX_TEXT_SIZE = 1024 * 1024 // 1MB max for text preview

interface UseFilePreviewOptions {
  file: FileInfo
  files: FileInfo[]
}

interface UseFilePreviewResult {
  /** The preview type for the current file */
  previewType: PreviewType
  /** URL to access the file */
  fileUrl: string
  /** Text content (for text files) */
  textContent: string | null
  /** Whether text content is loading */
  isLoadingText: boolean
  /** Error message if text loading failed */
  textError: string | null
  /** Current file index in the list */
  currentIndex: number
  /** Whether there's a previous file */
  hasPrevious: boolean
  /** Whether there's a next file */
  hasNext: boolean
  /** Navigate to previous file */
  goToPrevious: () => FileInfo | null
  /** Navigate to next file */
  goToNext: () => FileInfo | null
}

export function useFilePreview({
  file,
  files,
}: UseFilePreviewOptions): UseFilePreviewResult {
  const [textContent, setTextContent] = useState<string | null>(null)
  const [isLoadingText, setIsLoadingText] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  const previewType = useMemo(
    () => getPreviewType(file.mimeType, file.isPlainText),
    [file.mimeType, file.isPlainText]
  )
  const fileUrl = useMemo(() => `/api/v1/files/${file.id}`, [file.id])

  const currentIndex = useMemo(
    () => files.findIndex(f => f.id === file.id),
    [files, file.id]
  )

  const hasPrevious = currentIndex > 0
  const hasNext = currentIndex < files.length - 1

  // Load text content for text files
  useEffect(() => {
    if (previewType !== 'text') {
      setTextContent(null)
      setTextError(null)
      return
    }

    // Check if file is too large
    if (file.size > MAX_TEXT_SIZE) {
      setTextError(`File is too large to preview (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 1MB.`)
      setTextContent(null)
      return
    }

    const loadTextContent = async () => {
      setIsLoadingText(true)
      setTextError(null)

      try {
        const response = await fetch(fileUrl)
        if (!response.ok) {
          throw new Error('Failed to load file content')
        }

        const text = await response.text()
        setTextContent(text)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load file'
        setTextError(message)
        // Use warn instead of error - this is handled gracefully via textError state
        console.warn('[useFilePreview] Failed to load text content', {
          fileId: file.id,
          error: message,
        })
      } finally {
        setIsLoadingText(false)
      }
    }

    loadTextContent()
  }, [file.id, file.size, fileUrl, previewType])

  const goToPrevious = useCallback((): FileInfo | null => {
    if (!hasPrevious) return null
    return files[currentIndex - 1]
  }, [files, currentIndex, hasPrevious])

  const goToNext = useCallback((): FileInfo | null => {
    if (!hasNext) return null
    return files[currentIndex + 1]
  }, [files, currentIndex, hasNext])

  // Preview initialized

  return {
    previewType,
    fileUrl,
    textContent,
    isLoadingText,
    textError,
    currentIndex,
    hasPrevious,
    hasNext,
    goToPrevious,
    goToNext,
  }
}
