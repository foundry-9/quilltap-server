'use client'

/**
 * FileBrowser Component
 *
 * File explorer UI for browsing files within a project or general files.
 * Shows folder structure and file list with basic operations.
 * Supports grid and list view modes with sorting.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import FileBrowserGrid from './FileBrowserGrid'
import FileBrowserList from './FileBrowserList'
import { FilePreviewModal } from './FilePreview'
import { CreateFolderModal } from './FolderManagement'
import MoveToProjectModal from './MoveToProjectModal'
import FileDeleteConfirmation from './FileDeleteConfirmation'
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

/** Database folder type from API */
interface DbFolder {
  id: string
  path: string
  name: string
  parentFolderId: string | null
  projectId: string | null
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
  const [dbFolders, setDbFolders] = useState<DbFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [currentFolder, setCurrentFolder] = useState('/')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  const [sort, setSort] = useState<SortState>({ field: 'name', direction: 'asc' })
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  // Move to project modal state
  const [moveModalFile, setMoveModalFile] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    fileId: string;
    filename: string;
    associations: {
      characters: { id: string; name: string; usage: string }[];
      messages: { chatId: string; chatName: string; messageId: string }[];
    };
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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
      const filesUrl = projectId
        ? `/api/v1/projects/${projectId}?action=list-files`
        : '/api/v1/files?filter=general'

      const foldersUrl = projectId
        ? `/api/v1/files/folders?projectId=${projectId}`
        : '/api/v1/files/folders'

      // Fetch files and folders in parallel
      const [filesRes, foldersRes] = await Promise.all([
        fetch(filesUrl),
        fetch(foldersUrl),
      ])

      if (filesRes.ok) {
        const data = await filesRes.json()
        setFiles(data.files || [])
      } else {
        throw new Error('Failed to fetch files')
      }

      if (foldersRes.ok) {
        const data = await foldersRes.json()
        setDbFolders(data.folders || [])
      } else {
        // Non-fatal - continue with derived folders only
        console.warn('[FileBrowser] Failed to fetch folders from DB, using derived folders')
        setDbFolders([])
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to fetch files', {
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

  // Trigger batch thumbnail pre-generation after files load
  useEffect(() => {
    if (loading || files.length === 0) return

    const imageFileIds = files
      .filter(f => f.mimeType?.startsWith('image/'))
      .map(f => f.id)

    if (imageFileIds.length === 0) return

    // Fire-and-forget — individual FileThumbnail components will pick up cached results
    fetch('/api/v1/files?action=generate-thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: imageFileIds.slice(0, 100) }),
    }).catch(() => {
      // Silently ignore — thumbnails will be generated on-demand as fallback
    })
  }, [loading, files])

  // Filter files by current folder and sort them
  const filteredFiles = useMemo(() => {
    const filtered = files.filter(file => {
      const fileFolderPath = file.folderPath || '/'
      return fileFolderPath === currentFolder
    })
    return sortFiles(filtered, sort)
  }, [files, currentFolder, sort])

  // Get subfolders in current folder (merge DB folders with derived folders)
  const subfolders = useMemo(() => {
    // Map to track folders by path
    const folderMap = new Map<string, FolderInfo>()

    // First, add DB folders that are direct children of currentFolder
    for (const dbFolder of dbFolders) {
      // Check if this folder is a direct child of currentFolder
      const folderPath = dbFolder.path
      if (folderPath === currentFolder) continue // Skip current folder itself

      // Determine parent path for comparison
      const pathParts = folderPath.split('/').filter(Boolean)
      const currentParts = currentFolder.split('/').filter(Boolean)

      // Check if this is a direct child (one level deeper)
      if (pathParts.length === currentParts.length + 1) {
        // Check if the parent path matches
        const parentPath = currentParts.length === 0 ? '/' : '/' + currentParts.join('/') + '/'
        if (parentPath === currentFolder) {
          // Count files in this folder
          const fileCount = files.filter(f => {
            const fp = f.folderPath || '/'
            return fp === folderPath || fp.startsWith(folderPath)
          }).length

          folderMap.set(folderPath, {
            path: folderPath,
            name: dbFolder.name,
            fileCount,
            id: dbFolder.id,
            isDbFolder: true,
          })
        }
      }
    }

    // Then, derive folders from file paths (for backwards compatibility)
    for (const file of files) {
      const fileFolderPath = file.folderPath || '/'
      if (fileFolderPath.startsWith(currentFolder) && fileFolderPath !== currentFolder) {
        // Get the immediate subfolder
        const remainder = fileFolderPath.slice(currentFolder.length)
        const nextSlash = remainder.indexOf('/')
        if (nextSlash > 0) {
          const subfolder = currentFolder + remainder.slice(0, nextSlash + 1)

          // Only add if not already in map from DB
          if (!folderMap.has(subfolder)) {
            const existing = folderMap.get(subfolder)
            if (existing) {
              // Increment file count
              existing.fileCount++
            } else {
              const name = subfolder.split('/').filter(Boolean).pop() || subfolder
              folderMap.set(subfolder, {
                path: subfolder,
                name,
                fileCount: 1,
                isDbFolder: false,
              })
            }
          } else {
            // Already exists from DB, just update file count if needed
            const existing = folderMap.get(subfolder)!
            // File count already computed for DB folders
          }
        }
      }
    }

    // Convert to array and sort
    const result: FolderInfo[] = Array.from(folderMap.values())
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [files, dbFolders, currentFolder])

  const handleFolderClick = (folder: string) => {
    setCurrentFolder(folder)
  }

  const handleFileClick = (file: FileInfo) => {
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
    const confirmed = await showConfirmation('Are you sure you want to delete this file? This cannot be undone.')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/v1/files/${fileId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setFiles(files.filter(f => f.id !== fileId))
        showSuccessToast('File deleted')
        onFilesChange?.()
      } else if (data.details?.code === 'FILE_HAS_ASSOCIATIONS') {
        // Show enhanced confirmation with association details
        const file = files.find(f => f.id === fileId)
        setDeleteConfirmation({
          fileId,
          filename: file?.originalFilename || file?.filename || 'file',
          associations: data.details.associations,
        })
      } else {
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to delete file', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete file')
    }
  }

  const handleConfirmDeleteWithDissociation = async () => {
    if (!deleteConfirmation) return

    setIsDeleting(true)
    try {
      const res = await fetch(
        `/api/v1/files/${deleteConfirmation.fileId}?dissociate=true`,
        { method: 'DELETE' }
      )

      if (res.ok) {
        setFiles(files.filter(f => f.id !== deleteConfirmation.fileId))
        showSuccessToast('File deleted')
        setDeleteConfirmation(null)
        onFilesChange?.()
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete file')
      }
    } catch (error) {
      console.error('[FileBrowser] Failed to delete file with dissociation', {
        fileId: deleteConfirmation.fileId,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete file')
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle opening move modal (works for both general files and project files)
  const handleMoveToProject = useCallback((fileId: string, fileName: string) => {
    setMoveModalFile({ id: fileId, name: fileName })
  }, [])

  // Handle successful move - remove file from current list since it moved somewhere else
  const handleMoveSuccess = useCallback((targetProjectId: string | null, targetName: string) => {
    if (moveModalFile) {
      // Remove from current view since file is no longer here
      setFiles(prev => prev.filter(f => f.id !== moveModalFile.id))
      setMoveModalFile(null)
      // Close preview if this file was being previewed
      if (selectedFile?.id === moveModalFile.id) {
        setSelectedFile(null)
      }
      onFilesChange?.()
    }
  }, [moveModalFile, selectedFile, onFilesChange])

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
              onMoveToProject={handleMoveToProject}
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
              onMoveToProject={handleMoveToProject}
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
            onFilesChange?.()
          }}
          onMoveToProject={(fileId) => {
            const file = files.find(f => f.id === fileId)
            if (file) {
              handleMoveToProject(fileId, file.originalFilename || file.filename || 'file')
            }
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
          // Refresh the file and folder list to include the new folder
          fetchFiles()
          // Navigate to the new folder
          setCurrentFolder(folderPath)
        }}
      />

      {/* Move File Modal */}
      {moveModalFile && (
        <MoveToProjectModal
          isOpen={!!moveModalFile}
          onClose={() => setMoveModalFile(null)}
          fileId={moveModalFile.id}
          fileName={moveModalFile.name}
          currentProjectId={projectId}
          onSuccess={handleMoveSuccess}
        />
      )}

      {/* File Delete Confirmation Dialog */}
      {deleteConfirmation && (
        <FileDeleteConfirmation
          isOpen={!!deleteConfirmation}
          filename={deleteConfirmation.filename}
          associations={deleteConfirmation.associations}
          onConfirm={handleConfirmDeleteWithDissociation}
          onCancel={() => setDeleteConfirmation(null)}
          isDeleting={isDeleting}
        />
      )}

      {/* Hidden file input for uploads */}
      {showUpload && projectId && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />
      )}
    </div>
  )
}
