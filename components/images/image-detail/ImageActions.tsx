'use client'

// Note: Character and Persona imports were removed - this component doesn't use entity types
import { Icon } from '@/components/ui/icon'

interface ImageActionsProps {
  handleDownload: () => void
  handleCopyToClipboard: () => void
  handleSaveToGallery?: () => void
  savingToGallery?: boolean
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

export function ImageActions({
  handleDownload,
  handleCopyToClipboard,
  handleSaveToGallery,
  savingToGallery,
  onClose,
  onPrev,
  onNext,
}: ImageActionsProps) {
  return (
    <>
      {/* Navigation buttons - left and right sides */}
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10"
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
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10"
          title="Next image (Right Arrow)"
        >
          <Icon name="chevron-right" className="w-8 h-8" />
        </button>
      )}

      {/* Top right control buttons */}
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {/* Download button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Copy to clipboard"
        >
          <Icon name="copy" className="w-6 h-6" />
        </button>
        {/* Save to my gallery button */}
        {handleSaveToGallery && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (!savingToGallery) handleSaveToGallery()
            }}
            disabled={savingToGallery}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors disabled:opacity-50"
            title={savingToGallery ? 'Saving…' : 'Save to my gallery'}
          >
            <Icon name="bookmark" className="w-6 h-6" />
          </button>
        )}
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Close (Escape)"
        >
          <Icon name="close" className="w-6 h-6" />
        </button>
      </div>
    </>
  )
}
