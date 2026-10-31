/**
 * Types for FilePreview components
 */

import { FileInfo } from '../types'
import { previewKindOf } from '@/lib/folder-browser/preview-kind'

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

/**
 * Determine the preview type for a file based on its MIME type and isPlainText flag
 * (`previewKindOf`, narrowed to the viewers this modal has: Markdown reads as
 * text, and DOCX — which only the document-store viewer renders — as unsupported).
 * @param mimeType The file's MIME type
 * @param isPlainText Optional flag from text detection (if true, file is previewable as text)
 */
export function getPreviewType(mimeType: string, isPlainText?: boolean): PreviewType {
  const kind = previewKindOf({ mimeType, isPlainText })
  if (kind === 'markdown') return 'text'
  if (kind === 'docx') return 'unsupported'
  return kind
}
