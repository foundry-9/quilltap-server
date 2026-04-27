'use client'

/**
 * FileBrowserGrid Component
 *
 * Grid view for file browser with image thumbnails and hard-wrapped filenames.
 */

import { useEffect } from 'react'
import FileThumbnail from './FileThumbnail'
import { FileInfo, FolderInfo, formatFileSize } from './types'

interface FileBrowserGridProps {
  /** Files to display */
  files: FileInfo[]
  /** Subfolders to display */
  folders: FolderInfo[]
  /** Current folder path */
  currentFolder: string
  /** Called when a file is clicked */
  onFileClick: (file: FileInfo) => void
  /** Called when a folder is clicked */
  onFolderClick: (folderPath: string) => void
  /** Called when go up is clicked */
  onGoUp: () => void
  /** Called when delete is clicked */
  onDeleteFile: (fileId: string) => void
  /** Called when move to project is clicked (only for general files) */
  onMoveToProject?: (fileId: string, fileName: string) => void
  /** Thumbnail size in pixels */
  thumbnailSize?: number
}

export default function FileBrowserGrid({
  files,
  folders,
  currentFolder,
  onFileClick,
  onFolderClick,
  onGoUp,
  onDeleteFile,
  onMoveToProject,
  thumbnailSize = 120,
}: Readonly<FileBrowserGridProps>) {
  useEffect(() => {
    // Grid rendered
  }, [files.length, folders.length, currentFolder])

  const isEmpty = files.length === 0 && folders.length === 0 && currentFolder === '/'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {/* Go up button */}
      {currentFolder !== '/' && (
        <button
          onClick={onGoUp}
          className="flex flex-col items-center gap-2 p-3 rounded-lg hover:qt-bg-surface-alt transition-colors group"
        >
          <div
            className="flex items-center justify-center qt-bg-muted rounded-lg text-3xl"
            style={{ width: thumbnailSize, height: thumbnailSize }}
          >
            {'\u{1F4C1}'} {/* folder icon */}
          </div>
          <span className="qt-text-small qt-text-secondary">..</span>
        </button>
      )}

      {/* Subfolders */}
      {folders.map(folder => (
        <button
          key={folder.path}
          onClick={() => onFolderClick(folder.path)}
          className="flex flex-col items-center gap-2 p-3 rounded-lg hover:qt-bg-surface-alt transition-colors group"
        >
          <div
            className="flex items-center justify-center qt-bg-muted rounded-lg text-3xl"
            style={{ width: thumbnailSize, height: thumbnailSize }}
          >
            {'\u{1F4C1}'} {/* folder icon */}
          </div>
          <div className="w-full text-center">
            <span
              className="font-medium text-sm break-all line-clamp-2"
              title={folder.name}
            >
              {folder.name}
            </span>
            <span className="qt-text-xs qt-text-secondary block">
              {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''}
            </span>
          </div>
        </button>
      ))}

      {/* Files */}
      {files.map(file => (
        <div
          key={file.id}
          className={`flex flex-col items-center gap-2 p-3 rounded-lg hover:qt-bg-surface-alt transition-colors group relative ${file.fileStatus === 'orphaned' ? 'ring-1 qt-border-warning/50' : ''}`}
        >
          {/* Thumbnail/Icon */}
          <button
            onClick={() => onFileClick(file)}
            className="flex flex-col items-center gap-2 w-full"
          >
            <FileThumbnail
              fileId={file.id}
              mimeType={file.mimeType}
              alt={file.originalFilename || file.filename || 'File'}
              size={thumbnailSize}
              className="rounded-lg flex-shrink-0"
              mountPointId={file.mountPointId}
              relativePath={file.relativePath}
            />

            {/* Filename - hard wrapped */}
            <div className="w-full text-center">
              <span
                className="font-medium text-sm break-all line-clamp-2"
                title={file.originalFilename || file.filename}
              >
                {file.originalFilename || file.filename}
              </span>
              <span className="qt-text-xs qt-text-secondary block">
                {formatFileSize(file.size)}
              </span>
              {file.fileStatus === 'orphaned' && (
                <span className="qt-text-xs qt-text-warning block" title="Untracked file found on disk">
                  untracked
                </span>
              )}
            </div>
          </button>

          {/* Action buttons - show on hover */}
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onMoveToProject && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMoveToProject(file.id, file.originalFilename || file.filename || 'file')
                }}
                className="qt-button qt-button-secondary p-1.5 text-xs"
                title="Move to Project"
              >
                {'\u{1F4C1}'} {/* folder icon */}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDeleteFile(file.id)
              }}
              className="qt-button qt-button-secondary p-1.5 text-xs"
              title="Delete file"
            >
              {'\u{1F5D1}\uFE0F'} {/* wastebasket */}
            </button>
          </div>
        </div>
      ))}

      {/* Empty state */}
      {isEmpty && (
        <div className="col-span-full flex flex-col items-center justify-center py-12 text-center qt-text-secondary">
          <div className="text-5xl mb-3">{'\u{1F4C2}'}</div>
          <p className="text-lg">No files yet</p>
          <p className="qt-text-small">Upload files to get started</p>
        </div>
      )}
    </div>
  )
}
