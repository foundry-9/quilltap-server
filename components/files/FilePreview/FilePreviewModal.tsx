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
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'

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

  const displayName = file.originalFilename || file.filename

  // Headerless: the action bar is the dialog's top row. The body wrapper is
  // `contents`, so the bar, the scrolling preview and the side arrows lay out
  // directly in the dialog's flex column as before.
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      headerless
      maxWidth="5xl"
      className="overflow-hidden"
      bodyClassName="contents"
      overlayClassName="backdrop-blur-sm"
    >
      {/* The action bar shows the filename; this names the dialog. */}
      <ModalTitle className="sr-only">{displayName}</ModalTitle>

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
    </BaseModal>
  )
}
