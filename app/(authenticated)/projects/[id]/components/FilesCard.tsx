'use client'

/**
 * Files Card
 *
 * Expandable/scrollable card displaying project files.
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import type { ProjectFile } from '../types'

interface FilesCardProps {
  files: ProjectFile[]
  expanded: boolean
  onToggle: () => void
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

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilesCard({ files, expanded, onToggle }: FilesCardProps) {
  useEffect(() => {
    clientLogger.debug('FilesCard: rendered', { fileCount: files.length, expanded })
  }, [files.length, expanded])

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <FolderIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Files</h3>
            <p className="qt-text-small qt-text-secondary">
              {files.length} file{files.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t border-border">
          {files.length === 0 ? (
            <div className="p-4 text-center qt-text-secondary">
              <p>No files in this project yet.</p>
              <p className="qt-text-small mt-1">Files will appear here when added to project chats.</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:qt-bg-muted transition-colors"
                >
                  <div className="w-8 h-8 rounded qt-bg-muted flex items-center justify-center flex-shrink-0">
                    {file.mimeType.startsWith('image/') ? (
                      <ImageIcon className="w-4 h-4 qt-text-secondary" />
                    ) : (
                      <DocumentIcon className="w-4 h-4 qt-text-secondary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.originalFilename}
                    </p>
                    <p className="qt-text-xs qt-text-secondary">
                      {formatBytes(file.size)} &bull; {file.category}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
