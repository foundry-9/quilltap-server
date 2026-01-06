'use client'

/**
 * FileBrowser Component
 *
 * File explorer UI for browsing files within a project or general files.
 * Shows folder structure and file list with basic operations.
 * Supports grid and list view modes with sorting.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import FileBrowserGrid from './FileBrowserGrid'
import FileBrowserList from './FileBrowserList'
import { FilePreviewModal } from './FilePreview'
import { CreateFolderModal } from './FolderManagement'
import { useProjectFileUpload } from './useProjectFileUpload'
import { FileInfo, FolderInfo, SortState, sortFiles } from './types'

// Re-export FileInfo for backwards compatibility
export type { FileInfo }

interface FileBrowserProps {
  /** Project ID to browse (null for general files) */
  projectId: string | null
  /** Optional title override */
  title?: string
  /** Called when a file is clicked */
  onFileClick?: (file: FileInfo) => void
  /** Whether to show upload functionality */
  showUpload?: boolean
  /** Called when files are added/removed (for parent refresh) */
  onFilesChange?: () => void
  /** Optional class name */
  className?: string
}

export default function FileBrowser({
  projectId,
  title,
  onFileClick,
  showUpload = false,
  onFilesChange,
  className = '',
}: Readonly<FileBrowserProps>) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolder, setCurrentFolder] = useState('/')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  const [sort, setSort] = useState<SortState>({ field: 'name', direction: 'asc' })
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)

  // Upload functionality (only enabled when showUpload=true and projectId is provided)
  const {
    uploading,
    uploadProgress,
    fileInputRef,
    handleFileSelect,
    triggerFileSelect,
  } = useProjectFileUpload({
    projectId: projectId || '',
    folderPath: currentFolder,
    onSuccess: () => {
      // Refresh file list after upload
      fetchFiles()
      // Notify parent so it can refresh too
      onFilesChange?.()
    },
  })

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

  // Filter files by current folder and sort them
  const filteredFiles = useMemo(() => {
    const filtered = files.filter(file => {
      const fileFolderPath = file.folderPath || '/'
      return fileFolderPath === currentFolder
    })
    return sortFiles(filtered, sort)
  }, [files, currentFolder, sort])

  // Get subfolders in current folder
  const subfolders = useMemo(() => {
    const folderSet = new Map<string, number>()

    for (const file of files) {
      const fileFolderPath = file.folderPath || '/'
      if (fileFolderPath.startsWith(currentFolder) && fileFolderPath !== currentFolder) {
        // Get the immediate subfolder
        const remainder = fileFolderPath.slice(currentFolder.length)
        const nextSlash = remainder.indexOf('/')
        if (nextSlash > 0) {
          const subfolder = currentFolder + remainder.slice(0, nextSlash + 1)
          folderSet.set(subfolder, (folderSet.get(subfolder) || 0) + 1)
        }
      }
    }

    const result: FolderInfo[] = []
    for (const [path, count] of folderSet) {
      const name = path.split('/').filter(Boolean).pop() || path
      result.push({ path, name, fileCount: count })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [files, currentFolder])

  const handleFolderClick = (folder: string) => {
    setCurrentFolder(folder)
    clientLogger.debug('[FileBrowser] Changed folder', { folder })
  }

  const handleFileClick = (file: FileInfo) => {
    clientLogger.debug('[FileBrowser] File clicked', { fileId: file.id, filename: file.originalFilename })
    if (onFileClick) {
      onFileClick(file)
    } else {
      // Set selected file for preview modal (to be implemented)
      setSelectedFile(file)
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
      clientLogger.debug('[FileBrowser] Deleting file', { fileId })
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' })
      if (res.ok) {
        setFiles(files.filter(f => f.id !== fileId))
        showSuccessToast('File deleted')
        clientLogger.debug('[FileBrowser] File deleted', { fileId })
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      clientLogger.error('[FileBrowser] Failed to delete file', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      })
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
          {/* Upload button - only show when enabled and projectId is set */}
          {showUpload && projectId && (
            <button
              onClick={triggerFileSelect}
              disabled={uploading}
              className="qt-button qt-button-secondary p-2"
              title={uploading ? `Uploading ${uploadProgress?.current}/${uploadProgress?.total}...` : 'Upload Files'}
            >
              {uploading ? '\u23F3' : '\u{1F4E4}'}
            </button>
          )}
          <button
            onClick={() => setShowCreateFolder(true)}
            className="qt-button qt-button-secondary p-2"
            title="New Folder"
          >
            {'\u{1F4C1}'}+
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="qt-button qt-button-secondary p-2"
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
          >
            {viewMode === 'list' ? '\u25A6' : '\u2630'}
          </button>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="qt-button qt-button-secondary p-2"
            title="Refresh"
          >
            {'\u21BB'}
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <button
            onClick={() => setCurrentFolder('/')}
            className="hover:text-primary transition-colors"
          >
            Root
          </button>
          {currentFolder !== '/' && (
            <>
              {currentFolder.split('/').filter(Boolean).map((part, index, arr) => {
                const path = '/' + arr.slice(0, index + 1).join('/') + '/'
                return (
                  <span key={path} className="flex items-center gap-2">
                    <span className="text-muted-foreground">/</span>
                    <button
                      onClick={() => setCurrentFolder(path)}
                      className="hover:text-primary transition-colors"
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
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'grid' ? (
            <FileBrowserGrid
              files={filteredFiles}
              folders={subfolders}
              currentFolder={currentFolder}
              onFileClick={handleFileClick}
              onFolderClick={handleFolderClick}
              onGoUp={handleGoUp}
              onDeleteFile={handleDeleteFile}
            />
          ) : (
            <FileBrowserList
              files={filteredFiles}
              folders={subfolders}
              currentFolder={currentFolder}
              sort={sort}
              onSortChange={setSort}
              onFileClick={handleFileClick}
              onFolderClick={handleFolderClick}
              onGoUp={handleGoUp}
              onDeleteFile={handleDeleteFile}
            />
          )}
        </div>
      )}

      {/* Footer with file count */}
      <div className="mt-4 pt-2 border-t border-border">
        <span className="qt-text-xs text-muted-foreground">
          {files.length} file{files.length !== 1 ? 's' : ''} total
          {currentFolder !== '/' && ` \u2022 ${filteredFiles.length} in current folder`}
        </span>
      </div>

      {/* File Preview Modal */}
      {selectedFile && (
        <FilePreviewModal
          file={selectedFile}
          files={files}
          onClose={() => setSelectedFile(null)}
          onDelete={(fileId) => {
            setFiles(files.filter(f => f.id !== fileId))
            setSelectedFile(null)
          }}
          onNavigate={(file, _heading) => {
            setSelectedFile(file)
            // If navigating to a file in a different folder, update current folder
            if (file.folderPath && file.folderPath !== currentFolder) {
              setCurrentFolder(file.folderPath)
            }
            // Note: heading is handled internally by FilePreviewModal
          }}
        />
      )}

      {/* Create Folder Modal */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        currentFolder={currentFolder}
        projectId={projectId}
        onSuccess={(folderPath) => {
          clientLogger.debug('[FileBrowser] Folder created', { folderPath })
          // Navigate to the new folder
          setCurrentFolder(folderPath)
        }}
      />

      {/* Hidden file input for uploads */}
      {showUpload && projectId && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
        />
      )}
    </div>
  )
}
