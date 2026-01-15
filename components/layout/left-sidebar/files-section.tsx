'use client'

/**
 * Files Section
 *
 * Displays user's general (non-project) files in the sidebar.
 * Uses a direct API call for simplicity since files don't change as frequently.
 *
 * @module components/layout/left-sidebar/files-section
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { SidebarSection } from './sidebar-section'
import { ViewAllLink } from './sidebar-item'
import { clientLogger } from '@/lib/client-logger'

/**
 * File icon
 */
function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/**
 * Image icon for image files
 */
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

interface SidebarFile {
  id: string
  originalFilename: string
  mimeType: string
  size: number
  folderPath?: string
  createdAt: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileItem({
  file,
  isCollapsed,
  onClick,
}: {
  file: SidebarFile
  isCollapsed: boolean
  onClick: () => void
}) {
  const isImage = file.mimeType.startsWith('image/')

  return (
    <Link
      href={`/files?fileId=${file.id}`}
      className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}
      onClick={onClick}
      title={isCollapsed ? `${file.originalFilename} (${formatFileSize(file.size)})` : undefined}
    >
      <span className="qt-left-sidebar-item-icon flex-shrink-0">
        {isImage ? (
          <ImageIcon className="w-4 h-4" />
        ) : (
          <FileIcon className="w-4 h-4" />
        )}
      </span>
      {!isCollapsed && (
        <>
          <span className="qt-left-sidebar-item-label flex-1 truncate">{file.originalFilename}</span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatFileSize(file.size)}
          </span>
        </>
      )}
    </Link>
  )
}

export function FilesSection() {
  const { isCollapsed, closeMobile, isMobile } = useSidebar()
  const [files, setFiles] = useState<SidebarFile[]>([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)

  const fetchFiles = useCallback(async () => {
    try {
      clientLogger.debug('FilesSection: Fetching general files')
      const response = await fetch('/api/v1/files?filter=general')
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.status}`)
      }
      const data = await response.json()
      const allFiles = data.files || []
      setFiles(allFiles.slice(0, 5)) // Show only first 5
      setTotalCount(allFiles.length)
      clientLogger.debug('FilesSection: Fetched files', {
        count: allFiles.length,
        showing: Math.min(allFiles.length, 5),
      })
    } catch (error) {
      clientLogger.error('FilesSection: Failed to fetch files', {
        error: error instanceof Error ? error.message : String(error),
      })
      setFiles([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const handleItemClick = () => {
    if (isMobile) {
      closeMobile()
    }
  }

  // Loading state
  if (loading) {
    return (
      <SidebarSection id="files" title="Files">
        <div className="px-2 py-1 text-xs text-muted-foreground animate-pulse">
          {!isCollapsed && 'Loading...'}
        </div>
      </SidebarSection>
    )
  }

  // Empty state
  if (files.length === 0) {
    return (
      <SidebarSection id="files" title="Files">
        <div className="px-2 py-1 text-xs text-muted-foreground">
          <FileIcon className="w-4 h-4 inline-block mr-2 opacity-50" />
          {!isCollapsed && <span className="opacity-50">No files yet</span>}
        </div>
        <ViewAllLink href="/files" label="Browse files" />
      </SidebarSection>
    )
  }

  return (
    <SidebarSection id="files" title="Files">
      {files.map(file => (
        <FileItem
          key={file.id}
          file={file}
          isCollapsed={isCollapsed}
          onClick={handleItemClick}
        />
      ))}
      {totalCount > 5 && <ViewAllLink href="/files" label={`${totalCount - 5} more...`} />}
      {totalCount <= 5 && <ViewAllLink href="/files" />}
    </SidebarSection>
  )
}
