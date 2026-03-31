'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'

interface ImageModalProps {
  isOpen: boolean
  onClose: () => void
  src: string
  filename: string
  // Optional props for tagging/deletion functionality
  fileId?: string
  characterId?: string
  characterName?: string
  personaId?: string
  personaName?: string
  onDelete?: () => void
}

export default function ImageModal({
  isOpen,
  onClose,
  src,
  filename,
  fileId,
  characterId,
  characterName,
  personaId,
  personaName,
  onDelete,
}: ImageModalProps) {
  const [isTagging, setIsTagging] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  const handleDownload = async () => {
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      await triggerDownload(blob, filename)
    } catch (error) {
      console.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleCopyToClipboard = async () => {
    try {
      await copyImageToClipboard(src)
      showSuccessToast('Image copied to clipboard')
    } catch (error) {
      console.error('Failed to copy image to clipboard:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to copy image to clipboard')
    }
  }

  const handleTagCharacter = async () => {
    if (!fileId || !characterId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/v1/chat-files/${fileId}?action=tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagType: 'CHARACTER',
          tagId: characterId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to tag image')
      }

      showSuccessToast(`Image added to ${characterName || 'character'}'s gallery`)
    } catch (error) {
      console.error('Failed to tag image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to tag image')
    } finally {
      setIsTagging(false)
    }
  }

  const handleTagPersona = async () => {
    if (!fileId || !personaId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/v1/chat-files/${fileId}?action=tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagType: 'PERSONA',
          tagId: personaId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to tag image')
      }

      showSuccessToast(`Image added to ${personaName || 'persona'}'s gallery`)
    } catch (error) {
      console.error('Failed to tag image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to tag image')
    } finally {
      setIsTagging(false)
    }
  }

  const handleDelete = async () => {
    if (!fileId) return

    if (!(await showConfirmation('Permanently delete this photo? This cannot be undone.'))) {
      return
    }

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/v1/chat-files/${fileId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      showSuccessToast('Image deleted')
      onDelete?.()
      onClose()
    } catch (error) {
      console.error('Failed to delete image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isOpen) return null

  const canTag = fileId && (characterId || personaId)
  const canDelete = fileId

  // Use portal to render at document body level, avoiding stacking context issues
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center qt-bg-overlay backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Control buttons - top right */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Tag to character button */}
        {canTag && characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleTagCharacter()
            }}
            disabled={isTagging}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title={`Add to ${characterName || 'character'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        )}
        {/* Tag to persona button */}
        {canTag && personaId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleTagPersona()
            }}
            disabled={isTagging}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title={`Add to ${personaName || 'persona'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        )}
        {/* Download button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
        {/* Copy to clipboard button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleCopyToClipboard()
          }}
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Copy to clipboard"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Delete button - bottom right */}
      {canDelete && (
        <div className="absolute bottom-4 right-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            disabled={isDeleting}
            className="p-2 bg-destructive/80 hover:bg-destructive rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title="Delete image"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Using regular img instead of Next.js Image because authenticated API routes
            require session cookies, which Next.js image optimization doesn't forward */}
        { }
        <img
          src={src}
          alt={filename}
          className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
        />
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded">
        {filename}
      </div>
    </div>,
    document.body
  )
}
