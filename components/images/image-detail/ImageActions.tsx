'use client'

// Note: Character and Persona imports were removed - this component doesn't use entity types

interface ImageActionsProps {
  handleDownload: () => void
  handleCopyToClipboard: () => void
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

export function ImageActions({
  handleDownload,
  handleCopyToClipboard,
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
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
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
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
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
          className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors"
          title="Close (Escape)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </>
  )
}
