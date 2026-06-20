'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { Icon } from '@/components/ui/icon'

interface ImageModalProps {
  isOpen: boolean
  onClose: () => void
  src: string
  filename: string
  // Optional props for gallery/deletion functionality
  fileId?: string
  characterId?: string
  characterName?: string
  userCharacterId?: string
  userCharacterName?: string
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
  userCharacterId,
  userCharacterName,
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
      console.error('Failed to copy image to clipboard:', error)
      showErrorToast('Failed to copy image to clipboard')
    }
  }

  const handleSaveToCharacterGallery = async () => {
    if (!fileId || !characterId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save to photo album')
      }

      showSuccessToast(`Saved to ${characterName || 'character'}'s photo album`)
    } catch (error) {
      console.error('Failed to save to character gallery:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to save to photo album')
    } finally {
      setIsTagging(false)
    }
  }

  const handleSaveToUserCharacterGallery = async () => {
    if (!fileId || !userCharacterId) return

    setIsTagging(true)
    try {
      const res = await fetch(`/api/v1/characters/${userCharacterId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save to photo album')
      }

      showSuccessToast(`Saved to ${userCharacterName || 'user character'}'s photo album`)
    } catch (error) {
      console.error('Failed to save to user character gallery:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to save to photo album')
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

  const canSaveToGallery = fileId && (characterId || userCharacterId)
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
        {/* Save to character photo album */}
        {canSaveToGallery && characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleSaveToCharacterGallery()
            }}
            disabled={isTagging}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title={`Save to ${characterName || 'character'}'s photo album`}
          >
            <Icon name="user" className="w-6 h-6" />
          </button>
        )}
        {/* Save to user character photo album */}
        {canSaveToGallery && userCharacterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleSaveToUserCharacterGallery()
            }}
            disabled={isTagging}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title={`Save to ${userCharacterName || 'user character'}'s photo album`}
          >
            <Icon name="user" className="w-6 h-6" />
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
          <Icon name="download" className="w-6 h-6" />
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
          <Icon name="copy" className="w-6 h-6" />
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
          <Icon name="close" className="w-6 h-6" />
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
            className="p-2 qt-bg-destructive/80 hover:qt-bg-destructive rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title="Delete image"
          >
            <Icon name="trash" className="w-6 h-6" />
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
