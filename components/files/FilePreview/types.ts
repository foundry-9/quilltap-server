/**
 * Types for FilePreview components
 */

import { FileInfo } from '../types'

export type PreviewType = 'image' | 'pdf' | 'text' | 'unsupported'

export interface FilePreviewModalProps {
  /** The file to preview */
  file: FileInfo
  /** All files in the current view (for navigation) */
  files: FileInfo[]
  /** Called when modal should close */
  onClose: () => void
  /** Called when file is deleted */
  onDelete?: (fileId: string) => void
  /** Called when file is moved to a project */
  onMoveToProject?: (fileId: string) => void
  /** Called when navigating to a different file (with optional heading anchor) */
  onNavigate?: (file: FileInfo, heading?: string) => void
}

export interface FilePreviewRendererProps {
  /** The file to preview */
  file: FileInfo
  /** URL to fetch the file content */
  fileUrl: string
}

export interface FilePreviewActionsProps {
  /** The file being previewed */
  file: FileInfo
  /** Index of current file in the list */
  currentIndex: number
  /** Total number of files */
  totalFiles: number
  /** Called to navigate to previous file */
  onPrevious: () => void
  /** Called to navigate to next file */
  onNext: () => void
  /** Called to download the file */
  onDownload: () => void
  /** Called to delete the file */
  onDelete: () => void
  /** Called to move the file to a project */
  onMoveToProject?: () => void
  /** Called to close the modal */
  onClose: () => void
  /** Whether delete is in progress */
  isDeleting?: boolean
  /** Whether the file can be moved to a project (general files only) */
  canMoveToProject?: boolean
}

export interface FileMetadataPanelProps {
  /** The file to show metadata for */
  file: FileInfo
  /** Resolved character associations */
  characters?: Array<{ id: string; name: string }>
  /** Resolved project association */
  project?: { id: string; name: string } | null
  /** Called when character association is toggled */
  onToggleCharacter?: (characterId: string) => void
  /** Called when project is changed */
  onChangeProject?: (projectId: string | null) => void
  /** Whether association changes are in progress */
  isUpdating?: boolean
}

/**
 * Determine the preview type for a file based on its MIME type and isPlainText flag
 * @param mimeType The file's MIME type
 * @param isPlainText Optional flag from text detection (if true, file is previewable as text)
 */
export function getPreviewType(mimeType: string, isPlainText?: boolean): PreviewType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    isPlainText ||
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType === 'application/xml'
  ) {
    return 'text'
  }
  return 'unsupported'
}

/**
 * Get a human-readable preview type label
 */
export function getPreviewTypeLabel(previewType: PreviewType): string {
  switch (previewType) {
    case 'image':
      return 'Image'
    case 'pdf':
      return 'PDF Document'
    case 'text':
      return 'Text File'
    case 'unsupported':
      return 'File'
  }
}
