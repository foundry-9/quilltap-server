'use client'

/**
 * FilePreviewModal Component
 *
 * Main modal for previewing files with navigation, actions, and type-specific renderers.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { FilePreviewModalProps } from './types'
import { useFilePreview } from './hooks/useFilePreview'
import { useFileActions } from './hooks/useFileActions'
import FilePreviewActions from './FilePreviewActions'
import FilePreviewImage from './FilePreviewImage'
import FilePreviewPdf from './FilePreviewPdf'
import FilePreviewText from './FilePreviewText'
import FilePreviewFallback from './FilePreviewFallback'
import FileDeleteConfirmation from '../FileDeleteConfirmation'

export default function FilePreviewModal({
  file,
  files,
  onClose,
  onDelete,
  onMoveToProject,
  onNavigate,
}: Readonly<FilePreviewModalProps>) {
  const {
    previewType,
    fileUrl,
    textContent,
    isLoadingText,
    textError,
    currentIndex,
    hasPrevious,
    hasNext,
    goToPrevious,
    goToNext,
  } = useFilePreview({ file, files })

  const {
    handleDownload,
    handleDelete,
    handleMoveToProject,
    isDeleting,
    canMoveToProject,
    pendingDelete,
    confirmDelete,
    cancelDelete,
  } = useFileActions({
    file,
    onDelete,
    onMoveToProject,
    onClose,
  })

  // Ref for scrolling content to top on file change
  const contentRef = useRef<HTMLDivElement>(null)

  // Track target heading for wikilink navigation
  const [targetHeading, setTargetHeading] = useState<string | undefined>(undefined)

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    const prevFile = goToPrevious()
    if (prevFile && onNavigate) {
      setTargetHeading(undefined) // Clear heading for arrow navigation
      onNavigate(prevFile)
    }
  }, [goToPrevious, onNavigate])

  const handleNext = useCallback(() => {
    const nextFile = goToNext()
    if (nextFile && onNavigate) {
      setTargetHeading(undefined) // Clear heading for arrow navigation
      onNavigate(nextFile)
    }
  }, [goToNext, onNavigate])

  // Handle navigation from wikilinks (with optional heading)
  const handleTextNavigate = useCallback((file: typeof files[0], heading?: string) => {
    setTargetHeading(heading)
    if (onNavigate) {
      onNavigate(file, heading)
    }
  }, [onNavigate])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Modal opened

  // Handle click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

  // Render the appropriate preview component
  const renderPreview = () => {
    switch (previewType) {
      case 'image':
        return <FilePreviewImage file={file} fileUrl={fileUrl} />
      case 'pdf':
        return <FilePreviewPdf file={file} fileUrl={fileUrl} />
      case 'text':
        return (
          <FilePreviewText
            file={file}
            content={textContent}
            isLoading={isLoadingText}
            error={textError}
            files={files}
            onNavigate={handleTextNavigate}
            targetHeading={targetHeading}
          />
        )
      default:
        return <FilePreviewFallback file={file} fileUrl={fileUrl} />
    }
  }

  // Stop mousedown propagation to prevent parent modal's click-outside detection
  // FilePreviewModal is rendered outside parent modals in the DOM, so clicks inside
  // would otherwise trigger their click-outside handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center qt-bg-overlay backdrop-blur-sm"
      onClick={handleBackdropClick}
      onMouseDown={handleMouseDown}
    >
      <div
        className="qt-dialog w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-title"
      >
        {/* Actions bar */}
        <FilePreviewActions
          file={file}
          currentIndex={currentIndex}
          totalFiles={files.length}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onMoveToProject={handleMoveToProject}
          onClose={onClose}
          isDeleting={isDeleting}
          canMoveToProject={canMoveToProject}
        />

        {/* Preview content */}
        <div ref={contentRef} className="flex-1 overflow-auto p-4 relative">{renderPreview()}</div>

        {/* Navigation arrows on sides (for larger screens) */}
        {files.length > 1 && (
          <>
            {hasPrevious && (
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 qt-button qt-button-secondary p-4 text-2xl hidden lg:block"
                aria-label="Previous file"
              >
                {'\u2190'}
              </button>
            )}
            {hasNext && (
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 qt-button qt-button-secondary p-4 text-2xl hidden lg:block"
                aria-label="Next file"
              >
                {'\u2192'}
              </button>
            )}
          </>
        )}

        {/* Delete Confirmation for files with associations */}
        {pendingDelete && (
          <FileDeleteConfirmation
            isOpen={!!pendingDelete}
            filename={file.originalFilename || file.filename || 'file'}
            associations={pendingDelete.associations}
            onConfirm={confirmDelete}
            onCancel={cancelDelete}
            isDeleting={isDeleting}
          />
        )}
      </div>
    </div>
  )
}
