'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import DeletedImagePlaceholder from '../DeletedImagePlaceholder'
import { ImageActions } from './ImageActions'
import { ImageMetadata } from './ImageMetadata'
import { UncensoredBadge } from '@/components/images/UncensoredBadge'
import { useImageActions } from './hooks/useImageActions'
import type { ImageDetailModalProps, Character, CharacterGalleryLink } from './types'
import { useCharactersList } from '@/lib/hooks/use-characters-list'

const EMPTY_CHARACTERS: Character[] = []

export default function ImageDetailModal({
  isOpen,
  onClose,
  image,
  onPrev,
  onNext,
  onAvatarSet,
}: ImageDetailModalProps) {
  const { data: characters = EMPTY_CHARACTERS, isLoading: loadingCharacters } =
    useCharactersList<Character>(undefined, { enabled: isOpen })
  const [loadingLinks, setLoadingLinks] = useState(true)
  const loadingEntities = loadingCharacters || loadingLinks
  // Which image failed to load. The viewer stays mounted while Prev/Next swap
  // the `image` prop, so the placeholder is tied to that image alone (#300).
  const [missingImageId, setMissingImageId] = useState<string | null>(null)
  const imageMissing = missingImageId === image.id
  const dialogRef = useRef<HTMLDivElement>(null)
  const handleFocusKeyDown = useDialogFocus(dialogRef, isOpen)

  const {
    characterGalleryLinks,
    savingToGalleryFor,
    settingAvatar,
    addToCharacterGallery,
    removeFromCharacterGallery,
    setAsAvatar,
    handleDownload,
    handleCopyToClipboard,
    handleSaveToGallery,
    savingToGallery,
    updateCharacterGalleryLinks,
  } = useImageActions(image, characters, onAvatarSet)

  // Load the image's character gallery links on open (the characters are the shared list above).
  // A link id resolves to the album picture's links (#260); a response for an
  // image the viewer has paged away from is ignored (#300).
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const lookupId = image.linkId ?? image.id

    const loadEntities = async () => {
      try {
        setLoadingLinks(true)
        updateCharacterGalleryLinks([])

        const imageRes = await fetch(`/api/v1/images/${lookupId}`)
        if (cancelled) return

        if (imageRes.ok) {
          const imageData = await imageRes.json()
          if (cancelled) return
          const links: CharacterGalleryLink[] = imageData?.data?.characterGalleryLinks ?? []
          updateCharacterGalleryLinks(links)
        } else {
          console.warn('Image album lookup failed', { imageId: lookupId, status: imageRes.status })
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load entities:', {
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (!cancelled) setLoadingLinks(false)
      }
    }

    void loadEntities()
    return () => {
      cancelled = true
    }
  }, [isOpen, image.id, image.linkId, updateCharacterGalleryLinks])

  // Keyboard navigation (Escape, arrow keys)
  useImageNavigation({
    isOpen,
    onClose,
    onPrev,
    onNext,
  })

  if (!isOpen || typeof document === 'undefined') return null

  const filepath = image.url || image.filepath
  const imageSrc = filepath.startsWith('/') ? filepath : `/${filepath}`

  // Portal to document.body. Rendered in place, the overlay lands inside
  // `.qt-workspace`, whose `isolation: isolate` traps its `z-[60]` in the
  // workspace's own stacking context — the sticky `.qt-page-toolbar` (z-30)
  // then paints over the top-right Download/Copy/Close controls, leaving the
  // gallery with no reachable way to save a picture (bug 99).
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${image.filename}`}
      tabIndex={-1}
      onKeyDown={handleFocusKeyDown}
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
            onError={() => setMissingImageId(image.id)}
          />
        )}

        {!imageMissing && image.generationModeration && (
          <div className="mt-2 flex justify-center">
            <UncensoredBadge moderation={image.generationModeration} />
          </div>
        )}

        {/* Character gallery panel */}
        {!imageMissing && (
          <ImageMetadata
            imageId={image.id}
            characters={characters}
            loadingEntities={loadingEntities}
            characterGalleryLinks={characterGalleryLinks}
            savingToGalleryFor={savingToGalleryFor}
            settingAvatar={settingAvatar}
            onAddToCharacterGallery={addToCharacterGallery}
            onRemoveFromCharacterGallery={removeFromCharacterGallery}
            onSetAsAvatar={setAsAvatar}
          />
        )}
      </div>

      {/* Filename at bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded">
        {image.filename}
      </div>
    </div>,
    document.body
  )
}
