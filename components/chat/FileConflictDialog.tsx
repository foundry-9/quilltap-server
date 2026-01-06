'use client'

/**
 * FileConflictDialog Component
 *
 * Modal dialog for handling duplicate file conflicts when uploading
 * to project chats. Offers options to Replace, Keep Both, or Skip.
 */

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { BaseModal } from '@/components/ui/BaseModal'

/**
 * Information about a file conflict
 */
export interface FileConflictInfo {
  conflictType: 'filename' | 'content' | 'both'
  existingFile: {
    id: string
    filename: string
    size: number
    createdAt: string
    sha256: string
  }
  newFile: {
    filename: string
    size: number
    sha256: string
  }
}

/**
 * Resolution options for duplicate conflicts
 */
export type ConflictResolution = 'replace' | 'keepBoth' | 'skip'

interface FileConflictDialogProps {
  isOpen: boolean
  onClose: () => void
  conflict: FileConflictInfo | null
  onResolve: (resolution: ConflictResolution) => void
  resolving?: boolean
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Get user-friendly conflict description
 */
function getConflictDescription(conflictType: 'filename' | 'content' | 'both'): string {
  switch (conflictType) {
    case 'filename':
      return 'A file with this name already exists in the project.'
    case 'content':
      return 'This exact file already exists in the project (with a different name).'
    case 'both':
      return 'This exact file already exists with the same name.'
  }
}

export default function FileConflictDialog({
  isOpen,
  onClose,
  conflict,
  onResolve,
  resolving = false,
}: Readonly<FileConflictDialogProps>) {
  const [selectedResolution, setSelectedResolution] = useState<ConflictResolution | null>(null)

  if (!conflict) return null

  const handleResolve = (resolution: ConflictResolution) => {
    clientLogger.debug('[FileConflictDialog] Resolution selected', {
      resolution,
      conflictType: conflict.conflictType,
      existingFileId: conflict.existingFile.id,
    })
    onResolve(resolution)
  }

  const handleClose = () => {
    clientLogger.debug('[FileConflictDialog] Dialog cancelled')
    setSelectedResolution(null)
    onClose()
  }

  const footer = (
    <div className="flex flex-col sm:flex-row justify-end gap-2">
      <button
        onClick={handleClose}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={() => handleResolve('skip')}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        {resolving && selectedResolution === 'skip' ? 'Skipping...' : 'Skip Upload'}
      </button>
      <button
        onClick={() => {
          setSelectedResolution('keepBoth')
          handleResolve('keepBoth')
        }}
        disabled={resolving}
        className="qt-button qt-button-secondary"
      >
        {resolving && selectedResolution === 'keepBoth' ? 'Uploading...' : 'Keep Both'}
      </button>
      <button
        onClick={() => {
          setSelectedResolution('replace')
          handleResolve('replace')
        }}
        disabled={resolving}
        className="qt-button qt-button-primary"
      >
        {resolving && selectedResolution === 'replace' ? 'Replacing...' : 'Replace'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="File Already Exists"
      footer={footer}
      closeOnClickOutside={!resolving}
      closeOnEscape={!resolving}
    >
      <div className="space-y-4">
        {/* Conflict explanation */}
        <p className="text-muted-foreground">
          {getConflictDescription(conflict.conflictType)}
        </p>

        {/* Existing file info */}
        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📄</span>
            <span className="font-medium">Existing File</span>
          </div>
          <div className="qt-text-sm space-y-1 ml-7">
            <div className="font-medium">{conflict.existingFile.filename}</div>
            <div className="qt-text-xs text-muted-foreground">
              {formatFileSize(conflict.existingFile.size)} • Uploaded {formatDate(conflict.existingFile.createdAt)}
            </div>
          </div>
        </div>

        {/* New file info */}
        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📎</span>
            <span className="font-medium">New File</span>
          </div>
          <div className="qt-text-sm space-y-1 ml-7">
            <div className="font-medium">{conflict.newFile.filename}</div>
            <div className="qt-text-xs text-muted-foreground">
              {formatFileSize(conflict.newFile.size)}
            </div>
          </div>
        </div>

        {/* Resolution options explanation */}
        <div className="qt-text-xs text-muted-foreground space-y-1 border-t pt-3">
          <p><strong>Replace:</strong> Delete the existing file and upload the new one.</p>
          <p><strong>Keep Both:</strong> Upload the new file with a modified name (e.g., &quot;file (1).pdf&quot;).</p>
          <p><strong>Skip Upload:</strong> Cancel and keep the existing file.</p>
        </div>
      </div>
    </BaseModal>
  )
}
