'use client'

/**
 * FileBrowserList Component
 *
 * Tabular list view for file browser with sortable columns.
 * Columns: Name | Associations | Type | Date
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { getFileIcon } from './FileThumbnail'
import {
  FileInfo,
  FolderInfo,
  SortField,
  SortState,
  formatFileSize,
  formatFileDate,
  getFileTypeLabel,
} from './types'

interface FileBrowserListProps {
  /** Files to display */
  files: FileInfo[]
  /** Subfolders to display */
  folders: FolderInfo[]
  /** Current folder path */
  currentFolder: string
  /** Current sort state */
  sort: SortState
  /** Called when sort changes */
  onSortChange: (sort: SortState) => void
  /** Called when a file is clicked */
  onFileClick: (file: FileInfo) => void
  /** Called when a folder is clicked */
  onFolderClick: (folderPath: string) => void
  /** Called when go up is clicked */
  onGoUp: () => void
  /** Called when delete is clicked */
  onDeleteFile: (fileId: string) => void
}

interface SortableHeaderProps {
  field: SortField
  label: string
  currentSort: SortState
  onSort: (sort: SortState) => void
  className?: string
}

function SortableHeader({
  field,
  label,
  currentSort,
  onSort,
  className = '',
}: Readonly<SortableHeaderProps>) {
  const isActive = currentSort.field === field
  const icon = isActive
    ? currentSort.direction === 'asc'
      ? '\u25B2' // up triangle
      : '\u25BC' // down triangle
    : '\u25B6' // right triangle (neutral)

  const handleClick = () => {
    if (isActive) {
      // Toggle direction
      onSort({
        field,
        direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
      })
    } else {
      // New field, default to ascending
      onSort({ field, direction: 'asc' })
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1 text-left font-medium hover:text-primary transition-colors ${className}`}
    >
      <span>{label}</span>
      <span
        className={`text-xs transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`}
      >
        {icon}
      </span>
    </button>
  )
}

export default function FileBrowserList({
  files,
  folders,
  currentFolder,
  sort,
  onSortChange,
  onFileClick,
  onFolderClick,
  onGoUp,
  onDeleteFile,
}: Readonly<FileBrowserListProps>) {
  useEffect(() => {
    clientLogger.debug('[FileBrowserList] Rendered', {
      fileCount: files.length,
      folderCount: folders.length,
      currentFolder,
      sort,
    })
  }, [files.length, folders.length, currentFolder, sort])

  const isEmpty = files.length === 0 && folders.length === 0 && currentFolder === '/'

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2 w-12"></th>
            <th className="text-left p-2">
              <SortableHeader
                field="name"
                label="Name"
                currentSort={sort}
                onSort={onSortChange}
              />
            </th>
            <th className="text-left p-2 hidden md:table-cell">
              <span className="font-medium">Associations</span>
            </th>
            <th className="text-left p-2 hidden sm:table-cell w-28">
              <SortableHeader
                field="type"
                label="Type"
                currentSort={sort}
                onSort={onSortChange}
              />
            </th>
            <th className="text-left p-2 hidden lg:table-cell w-24">
              <SortableHeader
                field="size"
                label="Size"
                currentSort={sort}
                onSort={onSortChange}
              />
            </th>
            <th className="text-left p-2 hidden sm:table-cell w-28">
              <SortableHeader
                field="date"
                label="Date"
                currentSort={sort}
                onSort={onSortChange}
              />
            </th>
            <th className="w-12"></th>
          </tr>
        </thead>
        <tbody>
          {/* Go up row */}
          {currentFolder !== '/' && (
            <tr
              onClick={onGoUp}
              className="border-b border-border hover:bg-muted cursor-pointer transition-colors"
            >
              <td className="p-2 text-xl">{'\u{1F4C1}'}</td>
              <td className="p-2 font-medium text-muted-foreground">..</td>
              <td className="p-2 hidden md:table-cell"></td>
              <td className="p-2 hidden sm:table-cell"></td>
              <td className="p-2 hidden lg:table-cell"></td>
              <td className="p-2 hidden sm:table-cell"></td>
              <td className="p-2"></td>
            </tr>
          )}

          {/* Folder rows */}
          {folders.map(folder => (
            <tr
              key={folder.path}
              onClick={() => onFolderClick(folder.path)}
              className="border-b border-border hover:bg-muted cursor-pointer transition-colors"
            >
              <td className="p-2 text-xl">{'\u{1F4C1}'}</td>
              <td className="p-2">
                <span className="font-medium">{folder.name}</span>
              </td>
              <td className="p-2 hidden md:table-cell text-muted-foreground">
                {folder.fileCount} file{folder.fileCount !== 1 ? 's' : ''}
              </td>
              <td className="p-2 hidden sm:table-cell text-muted-foreground">
                Folder
              </td>
              <td className="p-2 hidden lg:table-cell text-muted-foreground">
                --
              </td>
              <td className="p-2 hidden sm:table-cell text-muted-foreground">
                --
              </td>
              <td className="p-2"></td>
            </tr>
          ))}

          {/* File rows */}
          {files.map(file => (
            <tr
              key={file.id}
              className="border-b border-border hover:bg-muted transition-colors group"
            >
              <td className="p-2 text-xl">{getFileIcon(file.mimeType)}</td>
              <td className="p-2">
                <button
                  onClick={() => onFileClick(file)}
                  className="text-left font-medium hover:text-primary transition-colors truncate max-w-xs block"
                  title={file.originalFilename || file.filename}
                >
                  {file.originalFilename || file.filename}
                </button>
              </td>
              <td className="p-2 hidden md:table-cell">
                {file.linkedTo && file.linkedTo.length > 0 ? (
                  <span className="qt-text-xs text-muted-foreground">
                    {file.linkedTo.length} link{file.linkedTo.length !== 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="qt-text-xs text-muted-foreground">--</span>
                )}
              </td>
              <td className="p-2 hidden sm:table-cell text-muted-foreground qt-text-small">
                {getFileTypeLabel(file.mimeType)}
              </td>
              <td className="p-2 hidden lg:table-cell text-muted-foreground qt-text-small">
                {formatFileSize(file.size)}
              </td>
              <td className="p-2 hidden sm:table-cell text-muted-foreground qt-text-small">
                {formatFileDate(file.createdAt)}
              </td>
              <td className="p-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteFile(file.id)
                  }}
                  className="qt-button qt-button-secondary p-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  title="Delete file"
                >
                  {'\u{1F5D1}\uFE0F'}
                </button>
              </td>
            </tr>
          ))}

          {/* Empty state */}
          {isEmpty && (
            <tr>
              <td colSpan={7} className="p-8 text-center text-muted-foreground">
                <div className="text-5xl mb-3">{'\u{1F4C2}'}</div>
                <p className="text-lg">No files yet</p>
                <p className="qt-text-small">Upload files to get started</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
