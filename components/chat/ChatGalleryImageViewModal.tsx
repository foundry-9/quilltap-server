'use client'

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'

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
  const [isTaggedToCharacter, setIsTaggedToCharacter] = useState(false)
  const [isTaggedToUserCharacter, setIsTaggedToUserCharacter] = useState(false)
  const [isTagging, setIsTagging] = useState(false)
  const [checkingTags, setCheckingTags] = useState(true)
  const [imageMissing, setImageMissing] = useState(false)

  // Check existing tags when file changes
  useEffect(() => {
    const checkTags = async () => {
      if (!file.id) return
      setCheckingTags(true)
      try {
        // Check if image exists in gallery with these tags
        if (characterId) {
          const charRes = await fetch(`/api/v1/images?tagType=CHARACTER&tagId=${characterId}`)
          if (charRes.ok) {
            const charData = await safeJsonParse<{ data?: Array<{ filepath: string }> }>(charRes)
            const found = (charData.data || []).some((img) => img.filepath === file.filepath)
            setIsTaggedToCharacter(found)
          }
        }
        if (userCharacterId) {
          const userCharRes = await fetch(`/api/v1/images?tagType=CHARACTER&tagId=${userCharacterId}`)
          if (userCharRes.ok) {
            const userCharData = await safeJsonParse<{ data?: Array<{ filepath: string }> }>(userCharRes)
            const found = (userCharData.data || []).some((img) => img.filepath === file.filepath)
            setIsTaggedToUserCharacter(found)
          }
        }
      } catch (error) {
        console.error('Failed to check tags:', { error: error instanceof Error ? error.message : String(error) })
      } finally {
        setCheckingTags(false)
      }
    }
    checkTags()
  }, [file.id, file.filepath, characterId, userCharacterId])

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

  const handleToggleCharacterTag = async () => {
    if (!characterId || isTagging) return

    setIsTagging(true)
    try {
      if (isTaggedToCharacter) {
        // Find the image in gallery first
        const imagesRes = await fetch(`/api/v1/images?tagType=CHARACTER&tagId=${characterId}`)
        const imagesData = await safeJsonParse<{ data?: Array<{ id: string; filepath: string }>; error?: string }>(imagesRes)
        if (!imagesRes.ok) throw new Error(imagesData.error || 'Failed to find image')
        const galleryImage = (imagesData.data || []).find((img) => img.filepath === file.filepath)

        if (galleryImage) {
          // Remove tag
          const res = await fetch(`/api/v1/images/${galleryImage.id}?action=remove-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'CHARACTER',
              tagId: characterId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to remove tag')
          }
          setIsTaggedToCharacter(false)
          showSuccessToast(`Removed from ${characterName || 'character'}'s gallery`)
        }
      } else {
        // Add tag - both generated images and chat files use the same endpoint
        // Both need to be copied to gallery first if not already there
        const res = await fetch(`/api/v1/chat-files/${file.id}?action=tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagType: 'CHARACTER',
            tagId: characterId,
          }),
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to tag image')
        }
        setIsTaggedToCharacter(true)
        showSuccessToast(`Added to ${characterName || 'character'}'s gallery`)
      }
    } catch (error) {
      console.error('Failed to toggle character tag:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setIsTagging(false)
    }
  }

  const handleToggleUserCharacterTag = async () => {
    if (!userCharacterId || isTagging) return

    setIsTagging(true)
    try {
      if (isTaggedToUserCharacter) {
        // Find the image in gallery first
        const imagesRes = await fetch(`/api/v1/images?tagType=CHARACTER&tagId=${userCharacterId}`)
        const imagesData = await safeJsonParse<{ data?: Array<{ id: string; filepath: string }>; error?: string }>(imagesRes)
        if (!imagesRes.ok) throw new Error(imagesData.error || 'Failed to find image')
        const galleryImage = (imagesData.data || []).find((img) => img.filepath === file.filepath)

        if (galleryImage) {
          // Remove tag
          const res = await fetch(`/api/v1/images/${galleryImage.id}?action=remove-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'CHARACTER',
              tagId: userCharacterId,
            }),
          })
          if (!res.ok) {
            const data = await safeJsonParse<{ error?: string }>(res)
            throw new Error(data.error || 'Failed to remove tag')
          }
          setIsTaggedToUserCharacter(false)
          showSuccessToast(`Removed from ${userCharacterName || 'user character'}'s gallery`)
        }
      } else {
        // Add tag - both generated images and chat files use the same endpoint
        // Both need to be copied to gallery first if not already there
        const res = await fetch(`/api/v1/chat-files/${file.id}?action=tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tagType: 'CHARACTER',
            tagId: userCharacterId,
          }),
        })
        if (!res.ok) {
          const data = await safeJsonParse<{ error?: string }>(res)
          throw new Error(data.error || 'Failed to tag image')
        }
        setIsTaggedToUserCharacter(true)
        showSuccessToast(`Added to ${userCharacterName || 'user character'}'s gallery`)
      }
    } catch (error) {
      console.error('Failed to toggle user character tag:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
    } finally {
      setIsTagging(false)
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
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
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
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Top right control buttons */}
      {!imageMissing && (
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Tag to Character button */}
        {characterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleCharacterTag()
            }}
            disabled={isTagging || checkingTags}
            className={`p-2 rounded-full qt-text-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isTaggedToCharacter
                ? 'bg-primary hover:qt-bg-primary/90'
                : 'qt-bg-overlay-btn hover:qt-bg-overlay-btn'
            }`}
            title={isTaggedToCharacter ? `Remove from ${characterName || 'character'}'s gallery` : `Add to ${characterName || 'character'}'s gallery`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        )}
        {/* Tag to user character button */}
        {userCharacterId && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleToggleUserCharacterTag()
            }}
            disabled={isTagging || checkingTags}
            className={`p-2 rounded-full qt-text-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              isTaggedToUserCharacter
                ? 'bg-primary hover:qt-bg-primary/90'
                : 'qt-bg-overlay-btn hover:qt-bg-overlay-btn'
            }`}
            title={isTaggedToUserCharacter ? `Remove from ${userCharacterName || 'user character'}'s gallery` : `Add to ${userCharacterName || 'user character'}'s gallery`}
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
          title="Download"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
          title="Close (Escape)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
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
          className="p-2 qt-bg-destructive/80 hover:bg-destructive rounded-full qt-text-overlay transition-colors cursor-pointer"
          title="Delete image permanently"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
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
