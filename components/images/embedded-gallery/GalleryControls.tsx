'use client'

import { Icon } from '@/components/ui/icon'

interface GalleryControlsProps {
  totalCount: number
  onUploadClick: () => void
  onClearAvatarClick: () => void
  thumbnailSize: number
  thumbnailSizeIndex: number
  maxThumbnailIndex: number
  onZoomOut: () => void
  onZoomIn: () => void
  hasAvatarSet: boolean
}

export function GalleryControls({
  totalCount,
  onUploadClick,
  onClearAvatarClick,
  thumbnailSize,
  thumbnailSizeIndex,
  maxThumbnailIndex,
  onZoomOut,
  onZoomIn,
  hasAvatarSet,
}: GalleryControlsProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div className="flex items-center gap-4">
        <p className="qt-text-small">
          {totalCount} photo{totalCount !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Upload Button */}
        <button
          onClick={() => {
            onUploadClick()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary hover:qt-bg-primary/90 rounded-md transition-colors"
        >
          <Icon name="upload" className="w-4 h-4" />
          Upload
        </button>

        {/* Clear Avatar Button */}
        {hasAvatarSet && (
          <button
            onClick={() => {
              onClearAvatarClick()
            }}
            className="px-3 py-1 qt-text-label-xs qt-text-destructive hover:qt-bg-destructive/10 rounded-md transition-colors"
          >
            Clear Avatar
          </button>
        )}

        {/* Zoom Controls */}
        <button
          onClick={() => {
            onZoomOut()
          }}
          disabled={thumbnailSizeIndex === 0}
          className="p-1 qt-text-secondary hover:text-foreground disabled:opacity-50"
          title="Smaller thumbnails"
        >
          <Icon name="zoom-out" className="w-5 h-5" />
        </button>
        <span className="qt-text-label-xs w-12 text-center">
          {thumbnailSize}px
        </span>
        <button
          onClick={() => {
            onZoomIn()
          }}
          disabled={thumbnailSizeIndex === maxThumbnailIndex}
          className="p-1 qt-text-secondary hover:text-foreground disabled:opacity-50"
          title="Larger thumbnails"
        >
          <Icon name="zoom-in" className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
