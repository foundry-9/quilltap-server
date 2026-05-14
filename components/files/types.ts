/**
 * Shared types for file browser components
 */

export interface FileInfo {
  id: string
  originalFilename: string
  filename?: string
  mimeType: string
  size: number
  category: string
  folderPath?: string
  description?: string | null
  filepath?: string
  projectId?: string | null
  linkedTo?: string[]
  isPlainText?: boolean
  fileStatus?: string
  createdAt: string
  updatedAt: string
  /**
   * When present, the file lives in a database-backed Scriptorium mount point
   * (not the legacy files table). Thumbnail, preview, and delete calls route
   * through /api/v1/mount-points/{mountPointId}/blobs/{relativePath} instead
   * of /api/v1/files/{id}.
   */
  mountPointId?: string
  relativePath?: string
}

export interface FolderInfo {
  path: string
  name: string
  fileCount: number
  /** Database folder ID (if from DB, undefined if derived from file paths) */
  id?: string
  /** Whether this folder exists in the database */
  isDbFolder?: boolean
}

export type SortField = 'name' | 'type' | 'size' | 'date'
export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: SortField
  direction: SortDirection
}

/**
 * Format date for display
 */
export function formatFileDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString()
}

/**
 * Get short file type label from MIME type
 */
export function getFileTypeLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Image'
  if (mimeType.startsWith('video/')) return 'Video'
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet'
  if (mimeType.includes('document') || mimeType.includes('word')) return 'Document'
  if (mimeType.includes('json')) return 'JSON'
  if (mimeType.includes('javascript')) return 'JavaScript'
  if (mimeType.includes('typescript')) return 'TypeScript'
  if (mimeType.startsWith('text/')) return 'Text'
  return 'File'
}

/**
 * Sort files by given field and direction
 */
export function sortFiles(files: FileInfo[], sort: SortState): FileInfo[] {
  const sorted = [...files]

  sorted.sort((a, b) => {
    let comparison = 0

    switch (sort.field) {
      case 'name':
        comparison = (a.originalFilename || a.filename || '').localeCompare(
          b.originalFilename || b.filename || ''
        )
        break
      case 'type':
        comparison = a.mimeType.localeCompare(b.mimeType)
        break
      case 'size':
        comparison = a.size - b.size
        break
      case 'date':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        break
    }

    return sort.direction === 'asc' ? comparison : -comparison
  })

  return sorted
}
