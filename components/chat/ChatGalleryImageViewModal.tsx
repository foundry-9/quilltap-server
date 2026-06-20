'use client'

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { Icon } from '@/components/ui/icon'

interface ChatFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  url: string
  createdAt: string
  type?: 'chatFile' | 'generatedImage'  // Added to distinguish between file types
}

interface ChatGalleryImageViewModalProps {
  isOpen: boolean
  onClose: () => void
  file: ChatFile
  onPrev?: () => void
  onNext?: () => void
  onDelete: () => void
  characterId?: string
  characterName?: string
  userCharacterId?: string
  userCharacterName?: string
}

export default function ChatGalleryImageViewModal({
  isOpen,
  onClose,
  file,
  onPrev,
  onNext,
  onDelete,
  characterId,
  characterName,
  userCharacterId,
  userCharacterName,
}: ChatGalleryImageViewModalProps) {
  const [isInCharacterGallery, setIsInCharacterGallery] = useState(false)
  const [isInUserCharacterGallery, setIsInUserCharacterGallery] = useState(false)
  const [characterLinkId, setCharacterLinkId] = useState<string | null>(null)
  const [userCharacterLinkId, setUserCharacterLinkId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [checkingGallery, setCheckingGallery] = useState(true)
  const [imageMissing, setImageMissing] = useState(false)

  // Check whether the image is already in each character's gallery
  useEffect(() => {
    const checkGalleryStatus = async () => {
      if (!file.id) return
      setCheckingGallery(true)
      try {
        const imageRes = await fetch(`/api/v1/images/${file.id}`)
        if (!imageRes.ok) {
          setCheckingGallery(false)
          return
        }
        const imageData = await safeJsonParse<{
          data?: { characterGalleryLinks?: Array<{ characterId: string; linkId: string }> }
        }>(imageRes)
        const links = imageData?.data?.characterGalleryLinks ?? []

        if (characterId) {
          const match = links.find((l) => l.characterId === characterId)
          setIsInCharacterGallery(!!match)
          setCharacterLinkId(match?.linkId ?? null)
        }
        if (userCharacterId) {
          const match = links.find((l) => l.characterId === userCharacterId)
          setIsInUserCharacterGallery(!!match)
          setUserCharacterLinkId(match?.linkId ?? null)
        }
      } catch (error) {
        console.error('Failed to check gallery status:', { error: error instanceof Error ? error.message : String(error) })
      } finally {
        setCheckingGallery(false)
      }
    }
    checkGalleryStatus()
  }, [file.id, characterId, userCharacterId])

  // Keyboard navigation (Escape, arrow keys)
  useImageNavigation({
    isOpen,
    onClose,
    onPrev,
    onNext,
  })

  const handleCopyToClipboard = async () => {
    try {
      await copyImageToClipboard(file.url)
      showSuccessToast('Image copied to clipboard')
    } catch (error) {
      console.error('Failed to copy image to clipboard:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to copy image to clipboard')
    }
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(file.url)
      const blob = await response.blob()
      await triggerDownload(blob, file.filename)
    } catch (error) {
      console.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleToggleCharacterGallery = async () => {
    if (!characterId || isSaving) return

    setIsSaving(true)
    try {
      if (isInCharacterGallery && characterLinkId) {
        const res = await fetch(`/api/v1/characters/${characterId}/photos/${characterLinkId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to remove from photo album')
        }
        setIsInCharacterGallery(false)
        setCharacterLinkId(null)
        showSuccessToast(`Removed from ${characterName || 'character'}'s photo album`)
      } else {
        const res = await fetch(`/api/v1/characters/${characterId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: file.id }),
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to save to photo album')
        }
        const data = await safeJsonParse<{ linkId?: string }>(res)
        setIsInCharacterGallery(true)
        setCharacterLinkId(data.linkId ?? null)
        showSuccessToast(`Saved to ${characterName || 'character'}'s photo album`)
      }
    } catch (error) {
      console.error('Failed to toggle character gallery:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update photo album')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleUserCharacterGallery = async () => {
    if (!userCharacterId || isSaving) return

    setIsSaving(true)
    try {
      if (isInUserCharacterGallery && userCharacterLinkId) {
        const res = await fetch(`/api/v1/characters/${userCharacterId}/photos/${userCharacterLinkId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to remove from photo album')
        }
        setIsInUserCharacterGallery(false)
        setUserCharacterLinkId(null)
        showSuccessToast(`Removed from ${userCharacterName || 'user character'}'s photo album`)
      } else {
        const res = await fetch(`/api/v1/characters/${userCharacterId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: file.id }),
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to save to photo album')
        }
        const data = await safeJsonParse<{ linkId?: string }>(res)
        setIsInUserCharacterGallery(true)
        setUserCharacterLinkId(data.linkId ?? null)
        showSuccessToast(`Saved to ${userCharacterName || 'user character'}'s photo album`)
      }
    } catch (error) {
      console.error('Failed to toggle user character gallery:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update photo album')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteClick = async () => {
    if (await showConfirmation('Permanently delete this photo? This cannot be undone.')) {
      onDelete()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center qt-bg-overlay backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Navigation buttons - left and right sides */}
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10 cursor-pointer"
          title="Previous image (Left Arrow)"
        >
          <Icon name="chevron-left" className="w-8 h-8" />
        </button>
      )}

      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10 cursor-pointer"
          title="Next image (Right Arrow)"
        >
          <Icon name="chevron-right" className="w-8 h-8" />
        </button>
      )}

      {/* Top right control buttons */}
      {!imageMissing && (
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Save to / remove from character photo album */}
        {characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleCharacterGallery()
            }}
            disabled={isSaving || checkingGallery}
            className={`p-2 rounded-full qt-text-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isInCharacterGallery
                ? 'bg-primary hover:qt-bg-primary/90'
                : 'qt-bg-overlay-btn hover:qt-bg-overlay-btn'
            }`}
            title={isInCharacterGallery ? `Remove from ${characterName || 'character'}'s photo album` : `Save to ${characterName || 'character'}'s photo album`}
          >
            <Icon name="user" className="w-6 h-6" />
          </button>
        )}
        {/* Save to / remove from user character photo album */}
        {userCharacterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleUserCharacterGallery()
            }}
            disabled={isSaving || checkingGallery}
            className={`p-2 rounded-full qt-text-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isInUserCharacterGallery
                ? 'bg-primary hover:qt-bg-primary/90'
                : 'qt-bg-overlay-btn hover:qt-bg-overlay-btn'
            }`}
            title={isInUserCharacterGallery ? `Remove from ${userCharacterName || 'user character'}'s photo album` : `Save to ${userCharacterName || 'user character'}'s photo album`}
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
          title="Close (Escape)"
        >
          <Icon name="close" className="w-6 h-6" />
        </button>
      </div>
      )}

      {/* Delete button - bottom right */}
      {!imageMissing && (
      <div className="absolute bottom-4 right-4 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteClick()
          }}
          className="p-2 qt-bg-destructive/80 hover:qt-bg-destructive rounded-full qt-text-overlay transition-colors cursor-pointer"
          title="Delete image permanently"
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
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={file.id}
            filename={file.filename}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (

          <img
            src={file.url}
            alt={file.filename}
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
            onError={() => setImageMissing(true)}
          />
        )}
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded">
        {file.filename}
      </div>
    </div>
  )
}
