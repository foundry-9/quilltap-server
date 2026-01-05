'use client'

/**
 * FileBrowser Component
 *
 * File explorer UI for browsing files within a project or general files.
 * Shows folder structure and file list with basic operations.
 */

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import FolderPicker from './FolderPicker'

interface FileInfo {
  id: string
  originalFilename: string
  filename?: string
  mimeType: string
  size: number
  category: string
  folderPath?: string
  description?: string | null
  filepath?: string
  createdAt: string
  updatedAt: string
}

interface FileBrowserProps {
  /** Project ID to browse (null for general files) */
  projectId: string | null
  /** Optional title override */
  title?: string
  /** Called when a file is clicked */
  onFileClick?: (file: FileInfo) => void
  /** Whether to show upload functionality */
  showUpload?: boolean
  /** Optional class name */
  className?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript')) return '📜'
  if (mimeType.startsWith('text/')) return '📃'
  return '📁'
}

export default function FileBrowser({
  projectId,
  title,
  onFileClick,
  showUpload = false,
  className = '',
}: Readonly<FileBrowserProps>) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolder, setCurrentFolder] = useState('/')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true)
      const url = projectId
        ? `/api/projects/${projectId}/files`
        : '/api/files/general'

      clientLogger.debug('[FileBrowser] Fetching files', { projectId, url })

      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
        clientLogger.debug('[FileBrowser] Loaded files', {
          count: data.files?.length || 0,
        })
      } else {
        throw new Error('Failed to fetch files')
      }
    } catch (error) {
      clientLogger.error('[FileBrowser] Failed to fetch files', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Filter files by current folder
  const filteredFiles = files.filter(file => {
    const fileFolderPath = file.folderPath || '/'
    return fileFolderPath === currentFolder
  })

  // Get subfolders in current folder
  const subfolders = new Set<string>()
  for (const file of files) {
    const fileFolderPath = file.folderPath || '/'
    if (fileFolderPath.startsWith(currentFolder) && fileFolderPath !== currentFolder) {
      // Get the immediate subfolder
      const remainder = fileFolderPath.slice(currentFolder.length)
      const nextSlash = remainder.indexOf('/')
      if (nextSlash > 0) {
        const subfolder = currentFolder + remainder.slice(0, nextSlash + 1)
        subfolders.add(subfolder)
      }
    }
  }

  const handleFolderClick = (folder: string) => {
    setCurrentFolder(folder)
    clientLogger.debug('[FileBrowser] Changed folder', { folder })
  }

  const handleFileClick = (file: FileInfo) => {
    if (onFileClick) {
      onFileClick(file)
    } else if (file.filepath) {
      // Default: open in new tab
      window.open(file.filepath, '_blank')
    }
  }

  const handleGoUp = () => {
    if (currentFolder === '/') return
    const parts = currentFolder.split('/').filter(Boolean)
    parts.pop()
    const parent = parts.length === 0 ? '/' : '/' + parts.join('/') + '/'
    setCurrentFolder(parent)
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return

    try {
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' })
      if (res.ok) {
        setFiles(files.filter(f => f.id !== fileId))
        showSuccessToast('File deleted')
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete file')
    }
  }

  const displayTitle = title || (projectId ? 'Project Files' : 'General Files')

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{displayTitle}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="qt-button qt-button-secondary p-2"
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
          >
            {viewMode === 'list' ? '▦' : '☰'}
          </button>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="qt-button qt-button-secondary p-2"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Breadcrumb / Folder picker */}
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setCurrentFolder('/')}
            className="hover:text-primary"
          >
            Root
          </button>
          {currentFolder !== '/' && (
            <>
              {currentFolder.split('/').filter(Boolean).map((part, index, arr) => {
                const path = '/' + arr.slice(0, index + 1).join('/') + '/'
                return (
                  <span key={path} className="flex items-center gap-2">
                    <span>/</span>
                    <button
                      onClick={() => setCurrentFolder(path)}
                      className="hover:text-primary"
                    >
                      {part}
                    </button>
                  </span>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="qt-text-small text-muted-foreground">Loading files...</span>
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto ${viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4' : 'space-y-1'}`}>
          {/* Go up button */}
          {currentFolder !== '/' && (
            <button
              onClick={handleGoUp}
              className={`flex items-center gap-2 p-2 rounded hover:bg-muted text-left w-full ${viewMode === 'grid' ? 'flex-col' : ''}`}
            >
              <span className="text-xl">📁</span>
              <span className="qt-text-small">..</span>
            </button>
          )}

          {/* Subfolders */}
          {Array.from(subfolders).sort().map(folder => {
            const name = folder.split('/').filter(Boolean).pop() || folder
            return (
              <button
                key={folder}
                onClick={() => handleFolderClick(folder)}
                className={`flex items-center gap-2 p-2 rounded hover:bg-muted text-left w-full ${viewMode === 'grid' ? 'flex-col' : ''}`}
              >
                <span className="text-xl">📁</span>
                <span className="font-medium truncate">{name}</span>
              </button>
            )
          })}

          {/* Files */}
          {filteredFiles.map(file => (
            <div
              key={file.id}
              className={`flex items-center gap-2 p-2 rounded hover:bg-muted group ${viewMode === 'grid' ? 'flex-col text-center' : ''}`}
            >
              <button
                onClick={() => handleFileClick(file)}
                className={`flex items-center gap-2 flex-1 text-left ${viewMode === 'grid' ? 'flex-col' : ''}`}
              >
                <span className="text-xl">{getFileIcon(file.mimeType)}</span>
                <div className={`flex-1 min-w-0 ${viewMode === 'grid' ? 'text-center' : ''}`}>
                  <div className="font-medium truncate">{file.originalFilename || file.filename}</div>
                  {viewMode === 'list' && (
                    <div className="qt-text-xs text-muted-foreground">
                      {formatFileSize(file.size)} • {new Date(file.createdAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </button>
              <button
                onClick={() => handleDeleteFile(file.id)}
                className="qt-button qt-button-secondary p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete file"
              >
                🗑️
              </button>
            </div>
          ))}

          {/* Empty state */}
          {filteredFiles.length === 0 && subfolders.size === 0 && currentFolder === '/' && (
            <div className="flex-1 flex items-center justify-center col-span-full">
              <div className="text-center text-muted-foreground">
                <div className="text-4xl mb-2">📂</div>
                <p>No files yet</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer with file count */}
      <div className="mt-4 pt-2 border-t border-border">
        <span className="qt-text-xs text-muted-foreground">
          {files.length} file{files.length !== 1 ? 's' : ''} total
          {currentFolder !== '/' && ` • ${filteredFiles.length} in current folder`}
        </span>
      </div>
    </div>
  )
}
