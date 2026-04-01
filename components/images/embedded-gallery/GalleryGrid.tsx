'use client'

import { GalleryImage } from './GalleryImage'
import type { GalleryImage as GalleryImageType } from './types'

interface GalleryGridProps {
  images: GalleryImageType[]
  thumbnailSize: number
  currentAvatarId?: string
  missingImages: Set<string>
  updatingTag: string | null
  settingAvatar: string | null
  deletingImage: string | null
  confirmDelete: string | null
  isImageTagged: (image: GalleryImageType) => boolean
  onImageClick: (index: number) => void
  onImageError: (imageId: string) => void
  onToggleTag: (e: React.MouseEvent, image: GalleryImageType) => void
  onSetAvatar: (e: React.MouseEvent, image: GalleryImageType) => void
  onDeleteImage: (e: React.MouseEvent, image: GalleryImageType) => void
  entityName: string
}

export function GalleryGrid({
  images,
  thumbnailSize,
  currentAvatarId,
  missingImages,
  updatingTag,
  settingAvatar,
  deletingImage,
  confirmDelete,
  isImageTagged,
  onImageClick,
  onImageError,
  onToggleTag,
  onSetAvatar,
  onDeleteImage,
  entityName,
}: GalleryGridProps) {
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`,
      }}
    >
      {images.map((image, index) => {
        const isTagged = isImageTagged(image)
        const isAvatar = currentAvatarId === image.id
        const isUpdating = updatingTag === image.id || settingAvatar === image.id

        return (
          <GalleryImage
            key={image.id}
            image={image}
            index={index}
            isTagged={isTagged}
            isAvatar={isAvatar}
            isUpdating={isUpdating}
            isDeletingImage={deletingImage === image.id}
            isConfirmingDelete={confirmDelete === image.id}
            isMissingImage={missingImages.has(image.id)}
            thumbnailSize={thumbnailSize}
            onImageClick={() => onImageClick(index)}
            onImageError={() => onImageError(image.id)}
            onToggleTag={(e) => onToggleTag(e, image)}
            onSetAvatar={(e) => onSetAvatar(e, image)}
            onDeleteImage={(e) => onDeleteImage(e, image)}
            entityName={entityName}
          />
        )
      })}
    </div>
  )
}
