'use client'

import type { GalleryImageProps } from './types'

export function GalleryImage({
  image,
  index,
  isTagged,
  isAvatar,
  isUpdating,
  isDeletingImage,
  isConfirmingDelete,
  isMissingImage,
  thumbnailSize,
  onImageClick,
  onImageError,
  onToggleTag,
  onSetAvatar,
  onDeleteImage,
  entityName,
}: GalleryImageProps) {
  const getImageUrl = (image: any) => {
    if (image.url) return image.url
    // filepath already includes leading slash from API
    return image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`
  }

  return (
    <div className="relative group">
      <button
        onClick={() => {
          onImageClick(index)
        }}
        className={`relative aspect-square w-full overflow-hidden rounded-lg bg-muted hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-ring transition-all ${
          isAvatar ? 'ring-2 ring-success' : ''
        } ${!isTagged ? 'opacity-60' : ''}`}
      >
        {isMissingImage ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        ) : (
           
          <img
            src={getImageUrl(image)}
            alt={image.filename}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => {
              console.warn('Image failed to load in gallery', { imageId: image.id })
              onImageError()
            }}
          />
        )}

        {/* Avatar Badge */}
        {isAvatar && (
          <div className="absolute top-1 left-1 bg-success text-success-foreground text-xs px-1.5 py-0.5 rounded font-medium">
            Avatar
          </div>
        )}

        {/* Tagged indicator */}
        {isTagged && !isAvatar && (
          <div className="absolute top-1 left-1 bg-primary rounded-full p-0.5">
            <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </button>

      {/* Action buttons overlay */}
      <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Tag/Untag button */}
        <button
          onClick={(e) => {
            onToggleTag(e)
          }}
          disabled={isUpdating}
          className={`p-1.5 rounded-full qt-shadow-md transition-colors ${
            isTagged
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-card text-muted-foreground hover:bg-accent'
          } ${isUpdating ? 'opacity-50' : ''}`}
          title={isTagged ? `Remove from ${entityName}` : `Tag to ${entityName}`}
        >
          {isUpdating ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : isTagged ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          )}
        </button>

        {/* Set as Avatar button */}
        {!isAvatar && (
          <button
            onClick={(e) => {
              onSetAvatar(e)
            }}
            disabled={isUpdating}
            className={`p-1.5 rounded-full qt-shadow-md bg-card text-muted-foreground hover:bg-success hover:text-success-foreground transition-colors ${isUpdating ? 'opacity-50' : ''}`}
            title="Set as avatar"
          >
            {isDeletingImage ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </button>
        )}

        {/* Delete button - show for non-avatars, or for missing avatar images */}
        {(!isAvatar || isMissingImage) && (
          <button
            onClick={(e) => {
              onDeleteImage(e)
            }}
            disabled={isDeletingImage}
            className={`p-1.5 rounded-full qt-shadow-md transition-colors ${
              isConfirmingDelete
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-card text-muted-foreground hover:bg-destructive hover:text-destructive-foreground'
            } ${isDeletingImage ? 'opacity-50' : ''}`}
            title={isConfirmingDelete ? 'Click again to confirm delete' : 'Delete image'}
          >
            {isDeletingImage ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
