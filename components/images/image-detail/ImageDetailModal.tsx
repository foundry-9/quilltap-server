'use client'

import { useState, useEffect } from 'react'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import DeletedImagePlaceholder from '../DeletedImagePlaceholder'
import { ImageActions } from './ImageActions'
import { ImageMetadata } from './ImageMetadata'
import { useImageActions } from './hooks/useImageActions'
import type { ImageDetailModalProps, Character } from './types'

export default function ImageDetailModal({
  isOpen,
  onClose,
  image,
  onPrev,
  onNext,
  onAvatarSet,
}: ImageDetailModalProps) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [loadingEntities, setLoadingEntities] = useState(true)
  const [imageMissing, setImageMissing] = useState(false)

  const {
    taggedCharacterIds,
    taggingInProgress,
    settingAvatar,
    toggleCharacterTag,
    setAsAvatar,
    handleDownload,
    handleCopyToClipboard,
    handleSaveToGallery,
    savingToGallery,
    updateTaggedCharacters,
  } = useImageActions(image, characters, onAvatarSet)

  // Load characters on mount (includes former personas now with controlledBy: 'user')
  useEffect(() => {
    const loadEntities = async () => {
      try {
        setLoadingEntities(true)
        const charsRes = await fetch('/api/v1/characters')

        if (charsRes.ok) {
          const charsData = await charsRes.json()
          setCharacters(charsData.characters || [])
        }
      } catch (error) {
        console.error('Failed to load entities:', {
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setLoadingEntities(false)
      }
    }

    if (isOpen) {
      loadEntities()
    }
  }, [isOpen])

  // Update tagged entities when image changes
  useEffect(() => {
    if (image.tags) {
      const charIds = new Set<string>()

      image.tags.forEach((tag) => {
        const tagId = tag.tagId
        if (tag.tagType === 'CHARACTER' && characters.some((c) => c.id === tagId)) {
          charIds.add(tagId)
        }
      })

      updateTaggedCharacters(charIds)
    } else {
      updateTaggedCharacters(new Set())
    }
  }, [image, characters, updateTaggedCharacters])

  // Keyboard navigation (Escape, arrow keys)
  useImageNavigation({
    isOpen,
    onClose,
    onPrev,
    onNext,
  })

  if (!isOpen) return null

  const filepath = image.url || image.filepath
  const imageSrc = filepath.startsWith('/') ? filepath : `/${filepath}`

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center qt-bg-overlay backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <ImageActions
        handleDownload={handleDownload}
        handleCopyToClipboard={handleCopyToClipboard}
        handleSaveToGallery={handleSaveToGallery}
        savingToGallery={savingToGallery}
        onClose={onClose}
        onPrev={onPrev}
        onNext={onNext}
      />

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center justify-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={image.id}
            filename={image.filename}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (
           
          <img
            src={imageSrc}
            alt={image.filename}
            className="max-w-full max-h-[70vh] w-auto h-auto object-contain"
            onError={() => setImageMissing(true)}
          />
        )}

        {/* Tag buttons panel */}
        {!imageMissing && (
          <ImageMetadata
            imageId={image.id}
            characters={characters}
            loadingEntities={loadingEntities}
            taggedCharacterIds={taggedCharacterIds}
            taggingInProgress={taggingInProgress}
            settingAvatar={settingAvatar}
            onToggleCharacterTag={toggleCharacterTag}
            onSetAsAvatar={setAsAvatar}
          />
        )}
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded">
        {image.filename}
      </div>
    </div>
  )
}
