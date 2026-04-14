'use client'

/**
 * Directory Picker Component
 *
 * A server-backed directory browser that lets users navigate and select
 * a folder from the host filesystem. Works in both Electron and
 * standalone Next.js environments.
 */

import { useState, useEffect, useCallback } from 'react'

interface DirectoryEntry {
  name: string
  path: string
}

interface BrowseResult {
  path: string
  parent: string | null
  directories: DirectoryEntry[]
  error?: string
}

interface DirectoryPickerProps {
  value: string
  onChange: (path: string) => void
  name?: string
  placeholder?: string
  required?: boolean
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  )
}

export function DirectoryPicker({ value, onChange, name, placeholder, required }: DirectoryPickerProps) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browsePath, setBrowsePath] = useState<string | null>(null)
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)

  const fetchDirectory = useCallback(async (dirPath?: string) => {
    setBrowseLoading(true)
    setBrowseError(null)
    try {
      const url = dirPath
        ? `/api/v1/system/browse-directory?path=${encodeURIComponent(dirPath)}`
        : '/api/v1/system/browse-directory'
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to browse directory')
      }
      const data = await res.json()
      setBrowseResult(data)
      setBrowsePath(data.path)
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Failed to browse')
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  const handleOpenBrowser = () => {
    setBrowserOpen(true)
    // Start browsing from the current value if set, otherwise home
    fetchDirectory(value || undefined)
  }

  const handleNavigate = (dirPath: string) => {
    fetchDirectory(dirPath)
  }

  const handleSelect = () => {
    if (browsePath) {
      onChange(browsePath)
    }
    setBrowserOpen(false)
  }

  const handleCancel = () => {
    setBrowserOpen(false)
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder || '/path/to/documents'}
          className="qt-input flex-1"
        />
        <button
          type="button"
          onClick={handleOpenBrowser}
          className="qt-button-secondary inline-flex items-center gap-1.5 shrink-0"
          title="Browse folders"
        >
          <FolderIcon className="w-4 h-4" />
          Browse
        </button>
      </div>

      {browserOpen && (
        <div className="mt-2 rounded-xl border qt-border-default qt-bg-card overflow-hidden">
          {/* Current path header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b qt-border-default qt-bg-muted/30">
            {browseResult?.parent && (
              <button
                type="button"
                onClick={() => handleNavigate(browseResult.parent!)}
                className="p-1 rounded hover:qt-bg-muted transition-colors shrink-0"
                title="Go to parent directory"
              >
                <ChevronUpIcon className="w-4 h-4" />
              </button>
            )}
            <span className="text-xs font-mono qt-text-secondary truncate flex-1" title={browsePath || ''}>
              {browsePath || '...'}
            </span>
          </div>

          {/* Directory listing */}
          <div className="max-h-48 overflow-y-auto">
            {browseLoading ? (
              <div className="px-3 py-4 text-center text-sm qt-text-secondary">Loading...</div>
            ) : browseError ? (
              <div className="px-3 py-4 text-center text-sm qt-text-destructive">{browseError}</div>
            ) : browseResult?.error ? (
              <div className="px-3 py-4 text-center text-sm qt-text-warning">{browseResult.error}</div>
            ) : browseResult?.directories.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm qt-text-secondary">No subdirectories</div>
            ) : (
              browseResult?.directories.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  onClick={() => handleNavigate(dir.path)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:qt-bg-muted/50 transition-colors"
                >
                  <FolderIcon className="w-4 h-4 qt-text-secondary shrink-0" />
                  <span className="truncate">{dir.name}</span>
                </button>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t qt-border-default">
            <span className="text-xs qt-text-secondary truncate">
              {browsePath ? `Select: ${browsePath}` : 'Navigate to a folder'}
            </span>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={handleCancel} className="qt-button-secondary text-xs px-3 py-1">
                Cancel
              </button>
              <button type="button" onClick={handleSelect} className="qt-button-primary text-xs px-3 py-1">
                Select
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
