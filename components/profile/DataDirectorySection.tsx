'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Data directory info from the API
 */
interface DataDirInfo {
  path: string
  source: 'environment' | 'platform-default'
  sourceDescription: string
  platform: 'docker' | 'linux' | 'darwin' | 'win32'
  isDocker: boolean
  canOpen: boolean
}

/**
 * Folder icon SVG
 */
function FolderIcon({ className }: { className?: string }) {
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
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/**
 * External link icon SVG
 */
function ExternalLinkIcon({ className }: { className?: string }) {
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
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/**
 * Copy icon SVG
 */
function CopyIcon({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/**
 * Check icon SVG
 */
function CheckIcon({ className }: { className?: string }) {
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
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * Platform display names
 */
const platformNames: Record<string, string> = {
  docker: 'Docker',
  linux: 'Linux',
  darwin: 'macOS',
  win32: 'Windows',
}

/**
 * DataDirectorySection Component
 *
 * Displays data directory information and provides a button to open it
 * in the system file browser (on non-Docker environments).
 */
export function DataDirectorySection() {
  const [dirInfo, setDirInfo] = useState<DataDirInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchDirInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/data-dir')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to load data directory info')
      }

      const data = await res.json()
      setDirInfo(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load data directory info'
      setError(message)
      console.error('Failed to load data directory info', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDirInfo()
  }, [fetchDirInfo])

  const handleOpenFolder = async () => {
    if (!dirInfo?.canOpen) return

    setOpening(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/system/data-dir?action=open', {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to open folder')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open folder'
      setError(message)
      console.error('Failed to open data directory', { error: message })
    } finally {
      setOpening(false)
    }
  }

  const handleCopyPath = async () => {
    if (!dirInfo?.path) return

    try {
      await navigator.clipboard.writeText(dirInfo.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard', { error: err })
    }
  }

  if (loading) {
    return (
      <div className="qt-card">
        <div className="qt-card-header">
          <h2 className="text-xl font-semibold">Data Directory</h2>
        </div>
        <div className="qt-card-content">
          <div className="qt-text-muted text-sm">Loading...</div>
        </div>
      </div>
    )
  }

  if (!dirInfo) {
    return (
      <div className="qt-card">
        <div className="qt-card-header">
          <h2 className="text-xl font-semibold">Data Directory</h2>
        </div>
        <div className="qt-card-content">
          <div className="qt-text-error text-sm">
            {error || 'Unable to load data directory information'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-card">
      <div className="qt-card-header">
        <h2 className="text-xl font-semibold">Data Directory</h2>
        <p className="qt-text-muted text-sm mt-1">
          Where Quilltap stores your data, files, and logs
        </p>
      </div>
      <div className="qt-card-content space-y-4">
        {/* Path display */}
        <div>
          <div className="qt-text-label text-sm mb-1">Location</div>
          <div className="flex items-center gap-2">
            <code className="qt-text-primary font-mono text-sm bg-muted/50 px-2 py-1 rounded flex-1 overflow-x-auto">
              {dirInfo.path}
            </code>
            <button
              onClick={handleCopyPath}
              className={`qt-copy-button qt-copy-button-icon shrink-0 ${copied ? 'qt-copy-button-success' : ''}`}
              title="Copy path to clipboard"
              aria-label="Copy path"
            >
              {copied ? (
                <CheckIcon className="w-4 h-4" />
              ) : (
                <CopyIcon className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Source info */}
        <div>
          <div className="qt-text-label text-sm mb-1">Configuration</div>
          <div className="qt-text-secondary text-sm">
            {dirInfo.sourceDescription}
          </div>
        </div>

        {/* Platform info */}
        <div>
          <div className="qt-text-label text-sm mb-1">Platform</div>
          <div className="qt-text-secondary text-sm">
            {platformNames[dirInfo.platform] || dirInfo.platform}
          </div>
        </div>

        {/* Action buttons and messages */}
        {error && (
          <div className="qt-text-error text-sm">{error}</div>
        )}

        {dirInfo.canOpen ? (
          <button
            onClick={handleOpenFolder}
            disabled={opening}
            className="qt-button qt-button-secondary inline-flex items-center gap-2"
          >
            <FolderIcon className="w-4 h-4" />
            {opening ? 'Opening...' : 'Open in File Browser'}
          </button>
        ) : (
          <div className="qt-text-muted text-sm bg-muted/30 p-3 rounded">
            <div className="flex items-start gap-2">
              <ExternalLinkIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Docker Environment</p>
                <p className="mt-1">
                  The data directory is mounted from your host system. Access it through your
                  host&apos;s file browser at the location configured in your docker-compose.yml
                  (typically <code className="text-xs bg-muted px-1 rounded">~/.quilltap</code> or
                  the value of <code className="text-xs bg-muted px-1 rounded">QUILLTAP_HOST_DATA_DIR</code>).
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
