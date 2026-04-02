'use client'

interface GalleryControlsProps {
  taggedCount: number
  totalCount: number
  showOnlyTagged: boolean
  onFilterToggle: (checked: boolean) => void
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
  taggedCount,
  totalCount,
  showOnlyTagged,
  onFilterToggle,
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
          {showOnlyTagged
            ? `${taggedCount} tagged photo${taggedCount !== 1 ? 's' : ''}`
            : `${totalCount} photo${totalCount !== 1 ? 's' : ''} (${taggedCount} tagged)`
          }
        </p>

        {/* Filter Toggle */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showOnlyTagged}
            onChange={(e) => {
              onFilterToggle(e.target.checked)
            }}
            className="rounded border-input text-primary focus:ring-ring"
          />
          <span className="qt-text-secondary">Show only tagged</span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        {/* Upload Button */}
        <button
          onClick={() => {
            onUploadClick()
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary hover:qt-bg-primary/90 rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
