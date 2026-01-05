'use client'

/**
 * FolderPicker Component
 *
 * Reusable component for selecting a folder within project or general files.
 * Shows existing folders and allows creating new ones.
 */

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface FolderInfo {
  path: string
  name: string
  depth: number
  fileCount: number
}

interface FolderPickerProps {
  /** Current selected folder path */
  value: string
  /** Called when folder selection changes */
  onChange: (path: string) => void
  /** Project ID to list folders from (null for general files) */
  projectId: string | null
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Optional class name */
  className?: string
}

export default function FolderPicker({
  value,
  onChange,
  projectId,
  disabled = false,
  className = '',
}: Readonly<FolderPickerProps>) {
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)

  const fetchFolders = useCallback(async () => {
    try {
      setLoading(true)
      const scope = projectId ? 'project' : 'general'
      const url = projectId
        ? `/api/projects/${projectId}/files`
        : '/api/files/general'

      clientLogger.debug('[FolderPicker] Fetching folders', { scope, projectId })

      // For now, we'll get folders from the file list
      // A dedicated endpoint would be more efficient
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const files = data.files || []

        // Extract unique folder paths
        const folderPaths = new Set<string>(['/'])
        for (const file of files) {
          const path = file.folderPath || '/'
          folderPaths.add(path)
          // Also add parent paths
          const parts = path.split('/').filter(Boolean)
          let current = '/'
          for (const part of parts) {
            current = current === '/' ? `/${part}/` : `${current}${part}/`
            folderPaths.add(current)
          }
        }

        // Convert to FolderInfo array
        const folderList: FolderInfo[] = Array.from(folderPaths)
          .sort()
          .map(path => {
            const parts = path.split('/').filter(Boolean)
            const name = parts.length === 0 ? 'Root' : parts[parts.length - 1]
            const depth = parts.length
            const fileCount = files.filter((f: { folderPath?: string }) => (f.folderPath || '/') === path).length
            return { path, name, depth, fileCount }
          })

        setFolders(folderList)
        clientLogger.debug('[FolderPicker] Loaded folders', { count: folderList.length })
      }
    } catch (error) {
      clientLogger.error('[FolderPicker] Failed to fetch folders', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  const handleCreateFolder = () => {
    if (!newFolderInput.trim()) return

    // Normalize the new folder path
    let newPath = newFolderInput.trim()
    if (!newPath.startsWith('/')) newPath = '/' + newPath
    if (!newPath.endsWith('/')) newPath = newPath + '/'

    // Add to local list (will be created when a file is written to it)
    if (!folders.some(f => f.path === newPath)) {
      const parts = newPath.split('/').filter(Boolean)
      const name = parts[parts.length - 1]
      const depth = parts.length
      setFolders([...folders, { path: newPath, name, depth, fileCount: 0 }].sort((a, b) => a.path.localeCompare(b.path)))
    }

    onChange(newPath)
    setNewFolderInput('')
    setShowNewFolderInput(false)
    clientLogger.debug('[FolderPicker] Created new folder', { path: newPath })
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          className="qt-select flex-1"
        >
          {loading ? (
            <option value="/">Loading...</option>
          ) : (
            folders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {'  '.repeat(folder.depth)}
                {folder.depth > 0 ? '└ ' : ''}
                {folder.name === 'Root' ? '/ (Root)' : folder.name}
                {folder.fileCount > 0 && ` (${folder.fileCount} files)`}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={() => setShowNewFolderInput(!showNewFolderInput)}
          disabled={disabled}
          className="qt-button qt-button-secondary px-3"
          title="Create new folder"
        >
          +
        </button>
      </div>

      {showNewFolderInput && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder="/path/to/folder/"
            disabled={disabled}
            className="qt-input flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreateFolder()
              } else if (e.key === 'Escape') {
                setShowNewFolderInput(false)
                setNewFolderInput('')
              }
            }}
          />
          <button
            type="button"
            onClick={handleCreateFolder}
            disabled={disabled || !newFolderInput.trim()}
            className="qt-button qt-button-primary px-3"
          >
            Create
          </button>
        </div>
      )}
    </div>
  )
}
