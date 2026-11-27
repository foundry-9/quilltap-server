'use client'

import { UncensoredBadge } from '@/components/images/UncensoredBadge'
import { Icon } from '@/components/ui/icon'
import { Spinner } from '@/components/ui/Spinner'
import type { GalleryImageProps } from './types'

export function GalleryImage({
  image,
  index,
  isAvatar,
  isUpdating,
  isDeletingImage,
  isConfirmingDelete,
  isMissingImage,
  thumbnailSize: _thumbnailSize,
  onImageClick,
  onImageError,
  onSetAvatar,
  onDownloadImage,
  onDeleteImage,
  entityName: _entityName,
  onSaveToAlbum,
  isInAlbum = false,
  isBusy = false,
  deleteTitle,
  caption,
}: GalleryImageProps) {
  const getImageUrl = () => {
    if (image.url) return image.url
    return image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`
  }

  return (
    <div className="relative group">
      <button
        onClick={() => {
          onImageClick(index)
        }}
        className={`relative aspect-square w-full overflow-hidden rounded-lg qt-bg-muted hover:ring-2 hover:qt-ring-brand focus:outline-none focus:ring-2 qt-focus-ring transition-all ${
          isAvatar ? 'ring-2 ring-success' : ''
        }`}
      >
        {isMissingImage ? (
          <div className="absolute inset-0 flex items-center justify-center qt-text-secondary">
            <Icon name="image" className="w-8 h-8" />
          </div>
        ) : (

          <img
            src={getImageUrl()}
            alt={image.filename}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => {
              console.warn('Image failed to load in gallery', { imageId: image.id })
              onImageError()
            }}
          />
        )}

        {/* Source caption — where the picture comes from */}
        {caption && (
          <div
            className="qt-gallery-caption absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 text-left pointer-events-none"
            title={`${caption.title} — ${caption.detail}`}
          >
            <div className="qt-gallery-caption-title truncate">{caption.title}</div>
            <div className="qt-gallery-caption-detail truncate">{caption.detail}</div>
          </div>
        )}

        {/* Badges — Avatar, and Uncensored when an uncensored profile drew it */}
        {(isAvatar || image.generationModeration) && (
          <div className="absolute top-1 left-1 flex flex-col items-start gap-1">
            {isAvatar && (
              <div className="qt-bg-success qt-text-on-success text-xs px-1.5 py-0.5 rounded font-medium">
                Avatar
              </div>
            )}
            <UncensoredBadge moderation={image.generationModeration} />
          </div>
        )}
      </button>

      {/* Action buttons overlay */}
      <div className={`absolute ${caption ? 'top-1' : 'bottom-1'} right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
        {/* Set as Avatar button */}
        {!isAvatar && onSetAvatar && (
          <button
            onClick={(e) => {
              onSetAvatar(e)
            }}
            disabled={isUpdating || isBusy}
            className={`p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-success hover:qt-text-on-success transition-colors ${isUpdating || isBusy ? 'opacity-50' : ''}`}
            title="Set as avatar"
          >
            {isUpdating ? (
              <Spinner className="w-4 h-4" />
            ) : (
              <Icon name="user" className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Keep in the album button — avatar rolls only */}
        {onSaveToAlbum && (
          <button
            onClick={(e) => {
              onSaveToAlbum(e)
            }}
            disabled={isInAlbum || isBusy}
            className={`p-1.5 rounded-full qt-shadow-md transition-colors ${
              isInAlbum
                ? 'qt-bg-success qt-text-on-success'
                : 'qt-bg-card qt-text-secondary hover:qt-bg-primary hover:qt-text-on-primary'
            } ${isBusy && !isInAlbum ? 'opacity-50' : ''}`}
            title={isInAlbum ? 'Already in the photo album' : 'Keep in the photo album'}
            aria-label={isInAlbum ? 'Already in the photo album' : 'Keep in the photo album'}
          >
            <Icon name="bookmark" className="w-4 h-4" />
          </button>
        )}

        {/* Download button */}
        {!isMissingImage && (
          <button
            onClick={(e) => {
              onDownloadImage(e)
            }}
            className="p-1.5 rounded-full qt-shadow-md qt-bg-card qt-text-secondary hover:qt-bg-primary hover:qt-text-on-primary transition-colors"
            title="Download image"
            aria-label="Download image"
          >
            <Icon name="download" className="w-4 h-4" />
          </button>
        )}

        {/* Delete button — show for non-avatars, or for missing avatar images */}
        {onDeleteImage && (!isAvatar || isMissingImage) && (
          <button
            onClick={(e) => {
              onDeleteImage(e)
            }}
            disabled={isDeletingImage || isBusy}
            className={`p-1.5 rounded-full qt-shadow-md transition-colors ${
              isConfirmingDelete
                ? 'qt-bg-destructive qt-text-on-destructive'
                : 'qt-bg-card qt-text-secondary hover:qt-bg-destructive hover:qt-text-on-destructive'
            } ${isDeletingImage || isBusy ? 'opacity-50' : ''}`}
            title={isConfirmingDelete ? 'Click again to confirm delete' : deleteTitle ?? 'Delete image'}
          >
            {isDeletingImage ? (
              <Spinner className="w-4 h-4" />
            ) : (
              <Icon name="trash" className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
