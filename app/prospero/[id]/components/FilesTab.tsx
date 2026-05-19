'use client'

/**
 * Files Tab
 *
 * Displays project files.
 */

import { formatBytes } from '@/lib/utils/format-bytes'
import type { ProjectFile } from '../types'

interface FilesTabProps {
  files: ProjectFile[]
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

export function FilesTab({ files }: FilesTabProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-12 qt-text-secondary">
        <p>No files in this project yet.</p>
        <p className="text-sm mt-2">Drag and drop files here to add them.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div key={file.id} className="qt-entity-card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded qt-bg-muted flex items-center justify-center">
              {file.mimeType.startsWith('image/') ? (
                <ImageIcon className="w-5 h-5 qt-text-secondary" />
              ) : (
                <DocumentIcon className="w-5 h-5 qt-text-secondary" />
              )}
            </div>
            <div>
              <p className="font-medium">{file.originalFilename}</p>
              <p className="qt-text-small">{formatBytes(file.size)} &bull; {file.category}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
