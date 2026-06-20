'use client'

/**
 * Files Tab
 *
 * Displays project files.
 */

import { formatBytes } from '@/lib/utils/format-bytes'
import type { ProjectFile } from '../types'
import { Icon } from '@/components/ui/icon'

interface FilesTabProps {
  files: ProjectFile[]
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
                <Icon name="image" className="w-5 h-5 qt-text-secondary" />
              ) : (
                <Icon name="file" className="w-5 h-5 qt-text-secondary" />
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
