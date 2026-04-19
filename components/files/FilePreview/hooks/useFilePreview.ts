'use client'

/**
 * useFilePreview Hook
 *
 * Manages file preview state including preview type detection,
 * text content loading, and navigation.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
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

  // Load text content for text files via SWR (gated by previewType)
  const shouldFetchText = previewType === 'text' && file.size <= MAX_TEXT_SIZE
  const { data: textData, isLoading: isLoadingText, error: swrTextError } = useSWR<string>(
    shouldFetchText ? fileUrl : null,
    shouldFetchText ? async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to load file content')
      return response.text()
    } : null
  )

  const textContent = textData ?? null

  // Handle size limit and SWR errors
  useEffect(() => {
    if (previewType !== 'text') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setTextError(null)
      return
    }

    if (file.size > MAX_TEXT_SIZE) {
      setTextError(`File is too large to preview (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 1MB.`)
      return
    }

    if (swrTextError) {
      const message = swrTextError instanceof Error ? swrTextError.message : 'Failed to load file'
      setTextError(message)
      console.warn('[useFilePreview] Failed to load text content', {
        fileId: file.id,
        error: message,
      })
      return
    }

    setTextError(null)
  }, [file.id, file.size, previewType, swrTextError])

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
