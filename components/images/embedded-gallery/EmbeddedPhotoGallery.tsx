'use client'

import { useState, useEffect } from 'react'
import ImageDetailModal from '../ImageDetailModal'
import { ImageUploadDialog } from '../image-upload-dialog'
import { GalleryControls } from './GalleryControls'
import { GalleryEmpty } from './GalleryEmpty'
import { GalleryGrid } from './GalleryGrid'
import { useGalleryData } from './hooks/useGalleryData'
import type { EmbeddedPhotoGalleryProps } from './types'

const THUMBNAIL_SIZES = [80, 100, 120, 150, 180, 200]
const DEFAULT_THUMBNAIL_INDEX = 2

export function EmbeddedPhotoGallery({
  entityType,
  entityId,
  entityName,
  currentAvatarId,
  onAvatarChange,
  onRefresh
}: EmbeddedPhotoGalleryProps) {
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(DEFAULT_THUMBNAIL_INDEX)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showOnlyTagged, setShowOnlyTagged] = useState(true)
  const [updatingTag, setUpdatingTag] = useState<string | null>(null)
  const [settingAvatar, setSettingAvatar] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [deletingImage, setDeletingImage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const {
    allImages,
    setAllImages,
    loading,
    missingImages,
    fetchImages,
    handleImageError,
    isImageTagged,
    handleToggleTag,
    handleSetAvatar,
    handleClearAvatar,
    handleDeleteImage
  } = useGalleryData(entityId, entityType)

  const thumbnailSize = THUMBNAIL_SIZES[thumbnailSizeIndex]
  const images = showOnlyTagged
    ? allImages.filter(img =>
        img.tags?.some(tag => tag.tagId === entityId && tag.tagType === entityType.toUpperCase())
      )
    : allImages
  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null

  useEffect(() => {
    if (confirmDelete) {
      const timer = setTimeout(() => setConfirmDelete(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmDelete])

  const handlePrevious = () => {
    if (selectedIndex > 0) setSelectedIndex(selectedIndex - 1)
  }

  const handleNext = () => {
    if (selectedIndex < images.length - 1) setSelectedIndex(selectedIndex + 1)
  }

  const handleToggleTagClick = async (e: React.MouseEvent, image: any) => {
    e.stopPropagation()
    setUpdatingTag(image.id)
    try {
      await handleToggleTag(image, entityName)
    } finally {
      setUpdatingTag(null)
    }
  }

  const handleSetAvatarClick = async (e: React.MouseEvent, image: any) => {
    e.stopPropagation()
    if (!onAvatarChange) return
    setSettingAvatar(image.id)
    try {
      await handleSetAvatar(image, currentAvatarId, onAvatarChange)
    } finally {
      setSettingAvatar(null)
    }
  }

  const handleClearAvatarClick = async () => {
    if (!onAvatarChange) return
    try {
      await handleClearAvatar(currentAvatarId, onAvatarChange)
    } catch (error) {
      console.error('Error clearing avatar:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleDeleteImageClick = async (e: React.MouseEvent, image: any) => {
    e.stopPropagation()
    if (confirmDelete !== image.id) {
      setConfirmDelete(image.id)
      return
    }
    setDeletingImage(image.id)
    setConfirmDelete(null)
    try {
      await handleDeleteImage(image, currentAvatarId, onAvatarChange)
      setAllImages(prev => prev.filter(img => img.id !== image.id))
    } finally {
      setDeletingImage(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary"></div>
      </div>
    )
  }

  const taggedCount = allImages.filter(img =>
    img.tags?.some(tag => tag.tagId === entityId && tag.tagType === entityType.toUpperCase())
  ).length

  return (
    <div>
      <GalleryControls
        taggedCount={taggedCount}
        totalCount={images.length}
        showOnlyTagged={showOnlyTagged}
        onFilterToggle={setShowOnlyTagged}
        onUploadClick={() => setShowUploadDialog(true)}
        onClearAvatarClick={handleClearAvatarClick}
        thumbnailSize={thumbnailSize}
        thumbnailSizeIndex={thumbnailSizeIndex}
        maxThumbnailIndex={THUMBNAIL_SIZES.length - 1}
        onZoomOut={() => setThumbnailSizeIndex(Math.max(0, thumbnailSizeIndex - 1))}
        onZoomIn={() => setThumbnailSizeIndex(Math.min(THUMBNAIL_SIZES.length - 1, thumbnailSizeIndex + 1))}
        hasAvatarSet={!!(onAvatarChange && currentAvatarId)}
      />

      {images.length === 0 ? (
        <GalleryEmpty showOnlyTagged={showOnlyTagged} entityName={entityName} />
      ) : (
        <GalleryGrid
          images={images}
          thumbnailSize={thumbnailSize}
          currentAvatarId={currentAvatarId}
          missingImages={missingImages}
          updatingTag={updatingTag}
          settingAvatar={settingAvatar}
          deletingImage={deletingImage}
          confirmDelete={confirmDelete}
          isImageTagged={isImageTagged}
          onImageClick={(index) => setSelectedIndex(index)}
          onImageError={handleImageError}
          onToggleTag={handleToggleTagClick}
          onSetAvatar={handleSetAvatarClick}
          onDeleteImage={handleDeleteImageClick}
          entityName={entityName}
        />
      )}

      {selectedImage && (
        <ImageDetailModal
          isOpen={true}
          onClose={() => setSelectedIndex(-1)}
          image={selectedImage}
          onPrev={selectedIndex > 0 ? handlePrevious : undefined}
          onNext={selectedIndex < images.length - 1 ? handleNext : undefined}
          onAvatarSet={() => {
            fetchImages()
            if (onRefresh) onRefresh()
          }}
        />
      )}

      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => {
          setShowUploadDialog(false)
          fetchImages()
        }}
        contextType={entityType === 'character' ? 'CHARACTER' : 'PERSONA'}
        contextId={entityId}
      />
    </div>
  )
}
