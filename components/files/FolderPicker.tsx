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
  id?: string
  isDbFolder?: boolean
}

/** Database folder type from API */
interface DbFolder {
  id: string
  path: string
  name: string
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
      const filesUrl = projectId
        ? `/api/projects/${projectId}/files`
        : '/api/files/general'
      const foldersUrl = projectId
        ? `/api/files/folders?projectId=${projectId}`
        : '/api/files/folders'

      clientLogger.debug('[FolderPicker] Fetching folders', { scope, projectId })

      // Fetch files and DB folders in parallel
      const [filesRes, foldersRes] = await Promise.all([
        fetch(filesUrl),
        fetch(foldersUrl),
      ])

      let files: { folderPath?: string }[] = []
      let dbFolders: DbFolder[] = []

      if (filesRes.ok) {
        const data = await filesRes.json()
        files = data.files || []
      }

      if (foldersRes.ok) {
        const data = await foldersRes.json()
        dbFolders = data.folders || []
        clientLogger.debug('[FolderPicker] Loaded DB folders', { count: dbFolders.length })
      }

      // Build folder map, starting with DB folders
      const folderMap = new Map<string, FolderInfo>()

      // Always include root
      folderMap.set('/', {
        path: '/',
        name: 'Root',
        depth: 0,
        fileCount: files.filter((f) => (f.folderPath || '/') === '/').length,
        isDbFolder: false,
      })

      // Add DB folders
      for (const dbFolder of dbFolders) {
        const parts = dbFolder.path.split('/').filter(Boolean)
        const depth = parts.length
        const fileCount = files.filter((f) => (f.folderPath || '/') === dbFolder.path).length
        folderMap.set(dbFolder.path, {
          path: dbFolder.path,
          name: dbFolder.name,
          depth,
          fileCount,
          id: dbFolder.id,
          isDbFolder: true,
        })
      }

      // Extract unique folder paths from files (for backwards compatibility)
      for (const file of files) {
        const path = file.folderPath || '/'
        if (!folderMap.has(path)) {
          const parts = path.split('/').filter(Boolean)
          const name = parts.length === 0 ? 'Root' : parts[parts.length - 1]
          const depth = parts.length
          const fileCount = files.filter((f) => (f.folderPath || '/') === path).length
          folderMap.set(path, { path, name, depth, fileCount, isDbFolder: false })
        }
        // Also add parent paths
        const parts = path.split('/').filter(Boolean)
        let current = '/'
        for (const part of parts) {
          current = current === '/' ? `/${part}/` : `${current}${part}/`
          if (!folderMap.has(current)) {
            const depth = current.split('/').filter(Boolean).length
            const fileCount = files.filter((f) => (f.folderPath || '/') === current).length
            folderMap.set(current, { path: current, name: part, depth, fileCount, isDbFolder: false })
          }
        }
      }

      // Convert to sorted array
      const folderList: FolderInfo[] = Array.from(folderMap.values())
        .sort((a, b) => a.path.localeCompare(b.path))

      setFolders(folderList)
      clientLogger.debug('[FolderPicker] Loaded folders', { count: folderList.length })
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

  const handleCreateFolder = async () => {
    if (!newFolderInput.trim()) return

    // Normalize the new folder path
    let newPath = newFolderInput.trim()
    if (!newPath.startsWith('/')) newPath = '/' + newPath
    if (!newPath.endsWith('/')) newPath = newPath + '/'

    try {
      clientLogger.debug('[FolderPicker] Creating folder', { path: newPath, projectId })

      // Create the folder via API
      const res = await fetch('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: newPath,
          projectId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to create folder')
      }

      const data = await res.json()
      const folderPath = data.folder?.path || newPath

      // Refresh folder list to include the new folder
      await fetchFolders()

      onChange(folderPath)
      setNewFolderInput('')
      setShowNewFolderInput(false)
      clientLogger.info('[FolderPicker] Created folder', { path: folderPath, folderId: data.folder?.id })
    } catch (error) {
      clientLogger.error('[FolderPicker] Failed to create folder', {
        path: newPath,
        error: error instanceof Error ? error.message : String(error),
      })
      // Still add to local list as fallback
      if (!folders.some(f => f.path === newPath)) {
        const parts = newPath.split('/').filter(Boolean)
        const name = parts[parts.length - 1]
        const depth = parts.length
        setFolders([...folders, { path: newPath, name, depth, fileCount: 0 }].sort((a, b) => a.path.localeCompare(b.path)))
      }
      onChange(newPath)
      setNewFolderInput('')
      setShowNewFolderInput(false)
    }
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
