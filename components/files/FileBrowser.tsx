'use client'

/**
 * FileBrowser Component
 *
 * File explorer UI for the general files (those in no project).
 *
 * Reads and writes the legacy files table through /api/v1/files. A document
 * store (a project's included) is browsed with the Scriptorium's folder
 * browser instead (`components/document-browser`).
 *
 * Supports grid and list view modes with sorting.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import FileBrowserGrid from './FileBrowserGrid'
import FileBrowserList from './FileBrowserList'
import { FilePreviewModal } from './FilePreview'
import { CreateFolderModal } from './FolderManagement'
import MoveToProjectModal from './MoveToProjectModal'
import FileDeleteConfirmation from './FileDeleteConfirmation'
import OrphanCleanupModal from './OrphanCleanupModal'
import { FileInfo, FolderInfo, SortState, sortFiles } from './types'

// Re-export FileInfo for backwards compatibility
export type { FileInfo }

interface FileBrowserProps {
  /** Optional title override */
  title?: string
  /** Called when a file is clicked */
  onFileClick?: (file: FileInfo) => void
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
  title,
  onFileClick,
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
  const [isSyncing, setIsSyncing] = useState(false)
  const [isCleaningUp, setIsCleaningUp] = useState(false)
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleanupStats, setCleanupStats] = useState<{
    orphanedCount: number
    rescuedCount: number
    duplicateCount: number
    uniqueCount: number
    totalSize: number
    uniqueSize: number
  } | null>(null)

  const fetchFiles = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      // A silent refresh (workspace tab re-activation) keeps the current
      // listing on screen instead of flipping back to the loading state.
      if (!opts?.silent) setLoading(true)

      const [filesRes, foldersRes] = await Promise.all([
        fetch('/api/v1/files?filter=general'),
        fetch('/api/v1/files/folders'),
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
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the initial load
    fetchFiles()
  }, [fetchFiles])

  // Navigating back to the containing workspace tab refreshes the listing in
  // place.
  useOnTabActivated(() => {
    void fetchFiles({ silent: true })
  })

  // Batch thumbnail pre-generation: a server-side sharp pipeline keyed by
  // files.id.
  useEffect(() => {
    if (loading || files.length === 0) return

    const imageFileIds = files
      .filter(f => f.mimeType?.startsWith('image/'))
      .map(f => f.id)

    if (imageFileIds.length === 0) return

    fetch('/api/v1/files?action=generate-thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: imageFileIds.slice(0, 100) }),
    }).catch(() => { /* best-effort */ })
  }, [loading, files])

  const orphanedCount = useMemo(() =>
    files.filter(f => f.fileStatus === 'orphaned').length,
    [files]
  )

  const filteredFiles = useMemo(() => {
    const filtered = files.filter(file => {
      const fileFolderPath = file.folderPath || '/'
      return fileFolderPath === currentFolder
    })
    return sortFiles(filtered, sort)
  }, [files, currentFolder, sort])

  const subfolders = useMemo(() => {
    const folderMap = new Map<string, FolderInfo>()

    for (const dbFolder of dbFolders) {
      const folderPath = dbFolder.path
      if (folderPath === currentFolder) continue

      const pathParts = folderPath.split('/').filter(Boolean)
      const currentParts = currentFolder.split('/').filter(Boolean)

      if (pathParts.length === currentParts.length + 1) {
        const parentPath = currentParts.length === 0 ? '/' : '/' + currentParts.join('/') + '/'
        if (parentPath === currentFolder) {
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

    for (const file of files) {
      const fileFolderPath = file.folderPath || '/'
      if (fileFolderPath.startsWith(currentFolder) && fileFolderPath !== currentFolder) {
        const remainder = fileFolderPath.slice(currentFolder.length)
        const nextSlash = remainder.indexOf('/')
        if (nextSlash > 0) {
          const subfolder = currentFolder + remainder.slice(0, nextSlash + 1)
          const existing = folderMap.get(subfolder)

          if (existing) {
            if (!existing.isDbFolder) {
              existing.fileCount++
            }
          } else {
            const name = subfolder.split('/').filter(Boolean).pop() || subfolder
            folderMap.set(subfolder, {
              path: subfolder,
              name,
              fileCount: 1,
              isDbFolder: false,
            })
          }
        }
      }
    }

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

  const handleMoveToProject = useCallback((fileId: string, fileName: string) => {
    setMoveModalFile({ id: fileId, name: fileName })
  }, [])

  const handleMoveSuccess = useCallback((_targetProjectId: string | null, _targetName: string) => {
    if (moveModalFile) {
      setFiles(prev => prev.filter(f => f.id !== moveModalFile.id))
      setMoveModalFile(null)
      if (selectedFile?.id === moveModalFile.id) {
        setSelectedFile(null)
      }
      onFilesChange?.()
    }
  }, [moveModalFile, selectedFile, onFilesChange])

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await fetch('/api/v1/files?action=sync', { method: 'POST' })
      if (res.ok) {
        showSuccessToast('Filesystem sync complete')
        fetchFiles()
      } else {
        throw new Error('Sync failed')
      }
    } catch (error) {
      showErrorToast('Failed to sync filesystem')
    } finally {
      setIsSyncing(false)
    }
  }, [fetchFiles])

  const handleCleanupClick = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      if (!res.ok) throw new Error('Failed to analyze orphaned files')
      const data = await res.json()
      setCleanupStats({
        orphanedCount: data.orphanedCount,
        rescuedCount: data.rescuedCount || 0,
        duplicateCount: data.duplicateCount,
        uniqueCount: data.uniqueCount,
        totalSize: data.totalSize,
        uniqueSize: data.uniqueSize,
      })
      setShowCleanupModal(true)
    } catch (error) {
      showErrorToast('Failed to analyze orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [])

  const handleCleanupMove = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'move', dryRun: false }),
      })
      if (!res.ok) throw new Error('Cleanup failed')
      const data = await res.json()
      const parts = [`Moved ${data.moved} file${data.moved !== 1 ? 's' : ''} to /orphans/`]
      if (data.deleted > 0) parts.push(`removed ${data.deleted} duplicate${data.deleted !== 1 ? 's' : ''}`)
      if (data.rescuedCount > 0) parts.push(`rescued ${data.rescuedCount} referenced file${data.rescuedCount !== 1 ? 's' : ''}`)
      showSuccessToast(parts.join(', '))
      setShowCleanupModal(false)
      setCleanupStats(null)
      fetchFiles()
    } catch (error) {
      showErrorToast('Failed to clean up orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [fetchFiles])

  const handleCleanupDelete = useCallback(async () => {
    setIsCleaningUp(true)
    try {
      const res = await fetch('/api/v1/files?action=cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'delete', dryRun: false }),
      })
      if (!res.ok) throw new Error('Cleanup failed')
      const data = await res.json()
      const parts = [`Removed ${data.deleted} orphaned file${data.deleted !== 1 ? 's' : ''}`]
      if (data.rescuedCount > 0) parts.push(`rescued ${data.rescuedCount} referenced file${data.rescuedCount !== 1 ? 's' : ''}`)
      showSuccessToast(parts.join(', '))
      setShowCleanupModal(false)
      setCleanupStats(null)
      fetchFiles()
    } catch (error) {
      showErrorToast('Failed to delete orphaned files')
    } finally {
      setIsCleaningUp(false)
    }
  }, [fetchFiles])

  const displayTitle = title || 'General Files'

  const showCleanupButton = orphanedCount > 0

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="qt-heading-4">{displayTitle}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateFolder(true)}
            className="qt-button qt-button-secondary p-2"
            title="New Folder"
            aria-label="New folder"
          >
            <span aria-hidden="true">{'\u{1F4C1}'}+</span>
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="qt-button qt-button-secondary p-2"
            title={viewMode === 'list' ? 'Grid view' : 'List view'}
            aria-label={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            <span aria-hidden="true">{viewMode === 'list' ? '▦' : '☰'}</span>
          </button>
          {showCleanupButton && (
            <button
              onClick={handleCleanupClick}
              disabled={isCleaningUp || loading}
              className="qt-button qt-button-secondary p-2 flex items-center gap-1"
              title={`${orphanedCount} untracked file${orphanedCount !== 1 ? 's' : ''} — click to clean up`}
              aria-label={`Clean up ${orphanedCount} untracked file${orphanedCount !== 1 ? 's' : ''}`}
            >
              <span aria-hidden="true">{isCleaningUp ? '⏳' : '\u{1F9F9}'}</span>
              <span className="text-xs qt-text-warning">{orphanedCount}</span>
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing || loading}
            className="qt-button qt-button-secondary p-2"
            title="Sync filesystem — scan disk for new or removed files"
            aria-label="Sync filesystem"
          >
            <span aria-hidden="true">{isSyncing ? '⏳' : '\u{1F504}'}</span>
          </button>
          <button
            onClick={() => { void fetchFiles() }}
            disabled={loading}
            className="qt-button qt-button-secondary p-2"
            title="Refresh"
            aria-label="Refresh file list"
          >
            <span aria-hidden="true">{'↻'}</span>
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <button
            onClick={() => setCurrentFolder('/')}
            className="hover:qt-text-brand transition-colors"
          >
            Root
          </button>
          {currentFolder !== '/' && (
            <>
              {currentFolder.split('/').filter(Boolean).map((part, index, arr) => {
                const path = '/' + arr.slice(0, index + 1).join('/') + '/'
                return (
                  <span key={path} className="flex items-center gap-2">
                    <span className="qt-text-secondary">/</span>
                    <button
                      onClick={() => setCurrentFolder(path)}
                      className="hover:qt-text-brand transition-colors"
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

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="qt-text-small qt-text-secondary">Loading files...</span>
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

      <div className="mt-4 pt-2 border-t qt-border-default">
        <span className="qt-text-xs qt-text-secondary">
          {files.length} file{files.length !== 1 ? 's' : ''} total
          {currentFolder !== '/' && ` • ${filteredFiles.length} in current folder`}
        </span>
      </div>

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
            if (file.folderPath && file.folderPath !== currentFolder) {
              setCurrentFolder(file.folderPath)
            }
          }}
        />
      )}

      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        currentFolder={currentFolder}
        projectId={null}
        onSuccess={(folderPath) => {
          fetchFiles()
          setCurrentFolder(folderPath)
        }}
      />

      {moveModalFile && (
        <MoveToProjectModal
          isOpen={!!moveModalFile}
          onClose={() => setMoveModalFile(null)}
          fileId={moveModalFile.id}
          fileName={moveModalFile.name}
          currentProjectId={null}
          onSuccess={handleMoveSuccess}
        />
      )}

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

      {showCleanupModal && cleanupStats && (
        <OrphanCleanupModal
          isOpen={showCleanupModal}
          stats={cleanupStats}
          onMove={handleCleanupMove}
          onDelete={handleCleanupDelete}
          onCancel={() => {
            setShowCleanupModal(false)
            setCleanupStats(null)
          }}
          isProcessing={isCleaningUp}
        />
      )}

    </div>
  )
}
