'use client'

import { useState, useEffect, useCallback } from 'react'
import { useOrphanScan, OrphanFile } from './hooks/useOrphanScan'
import type { MountPoint } from './types'

interface OrphanScanModalProps {
  isOpen: boolean
  onClose: () => void
  mountPoint: MountPoint
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Modal for scanning and adopting orphan files in a mount point
 */
export function OrphanScanModal({
  isOpen,
  onClose,
  mountPoint,
}: OrphanScanModalProps) {
  const {
    scanning,
    adopting,
    scanResult,
    adoptResult,
    error,
    scanForOrphans,
    adoptOrphans,
    clearResults,
  } = useOrphanScan()

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [computeHashes, setComputeHashes] = useState(false)

  // Log modal state changes
  useEffect(() => {
  }, [isOpen, mountPoint.id])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !scanning && !adopting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, scanning, adopting, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleScan = useCallback(async () => {
    await scanForOrphans(mountPoint.id)
  }, [mountPoint.id, scanForOrphans])

  const handleToggleSelect = useCallback((storageKey: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(storageKey)) {
        next.delete(storageKey)
      } else {
        next.add(storageKey)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (scanResult) {
      setSelectedKeys(new Set(scanResult.orphans.map((o) => o.storageKey)))
    }
  }, [scanResult])

  const handleDeselectAll = useCallback(() => {
    setSelectedKeys(new Set())
  }, [])

  const handleAdopt = useCallback(async () => {
    if (selectedKeys.size === 0) return
    await adoptOrphans(mountPoint.id, Array.from(selectedKeys), computeHashes)
    setSelectedKeys(new Set())
  }, [mountPoint.id, selectedKeys, computeHashes, adoptOrphans])

  if (!isOpen) {
    return null
  }

  const orphans = scanResult?.orphans || []
  const allSelected = orphans.length > 0 && selectedKeys.size === orphans.length

  return (
    <div className="qt-dialog-overlay">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        onClick={!scanning && !adopting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative qt-card w-full max-w-2xl max-h-[90vh] overflow-hidden mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="qt-text-large font-semibold">
            Scan for Orphan Files
          </h2>
          <button
            onClick={onClose}
            disabled={scanning || adopting}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error display */}
          {error && (
            <div className="mb-4 qt-alert-error">
              {error}
            </div>
          )}

          {/* Success message for adoption */}
          {adoptResult && adoptResult.adopted > 0 && (
            <div className="mb-4 qt-alert-success">
              Successfully adopted {adoptResult.adopted} file{adoptResult.adopted !== 1 ? 's' : ''}.
              {adoptResult.failed.length > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                  {adoptResult.failed.length} failed.
                </span>
              )}
            </div>
          )}

          {/* Mount point info */}
          <div className="mb-4 p-3 rounded bg-gray-50 dark:bg-gray-800">
            <p className="qt-text">
              <strong>Mount Point:</strong> {mountPoint.name}
            </p>
            <p className="qt-text-small text-muted-foreground">
              Backend: {mountPoint.backendType}
            </p>
          </div>

          {/* Initial state - no scan yet */}
          {!scanResult && !scanning && (
            <div className="text-center py-8">
              <p className="qt-text text-muted-foreground mb-4">
                Scan this mount point to find files that exist in storage but are not tracked in the database.
              </p>
              <button
                onClick={handleScan}
                className="qt-button qt-button-primary"
              >
                Start Scan
              </button>
            </div>
          )}

          {/* Scanning */}
          {scanning && (
            <div className="text-center py-8">
              <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="qt-text text-muted-foreground">
                Scanning storage backend...
              </p>
            </div>
          )}

          {/* Scan results */}
          {scanResult && !scanning && (
            <>
              {/* Summary */}
              <div className="mb-4 grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded bg-blue-50 dark:bg-blue-900/20">
                  <p className="qt-text-large font-semibold text-blue-700 dark:text-blue-300">
                    {scanResult.totalFilesInStorage}
                  </p>
                  <p className="qt-text-small text-muted-foreground">In Storage</p>
                </div>
                <div className="p-3 rounded bg-green-50 dark:bg-green-900/20">
                  <p className="qt-text-large font-semibold text-green-700 dark:text-green-300">
                    {scanResult.totalFilesInDatabase}
                  </p>
                  <p className="qt-text-small text-muted-foreground">In Database</p>
                </div>
                <div className="p-3 rounded bg-yellow-50 dark:bg-yellow-900/20">
                  <p className="qt-text-large font-semibold text-yellow-700 dark:text-yellow-300">
                    {orphans.length}
                  </p>
                  <p className="qt-text-small text-muted-foreground">Orphaned</p>
                </div>
              </div>

              {/* No orphans */}
              {orphans.length === 0 && (
                <div className="text-center py-8">
                  <p className="qt-text text-green-600 dark:text-green-400">
                    No orphaned files found. All files in storage are tracked in the database.
                  </p>
                </div>
              )}

              {/* Orphan list */}
              {orphans.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={allSelected ? handleDeselectAll : handleSelectAll}
                        className="qt-text-small text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                      <span className="qt-text-small text-muted-foreground">
                        ({selectedKeys.size} selected)
                      </span>
                    </div>
                    <button
                      onClick={handleScan}
                      className="qt-text-small text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Rescan
                    </button>
                  </div>

                  <div className="border rounded dark:border-gray-700 max-h-64 overflow-y-auto">
                    {orphans.map((orphan) => (
                      <OrphanFileRow
                        key={orphan.storageKey}
                        orphan={orphan}
                        selected={selectedKeys.has(orphan.storageKey)}
                        onToggle={() => handleToggleSelect(orphan.storageKey)}
                      />
                    ))}
                  </div>

                  {/* Adoption options */}
                  <div className="mt-4 flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={computeHashes}
                        onChange={(e) => setComputeHashes(e.target.checked)}
                        className="rounded"
                      />
                      <span className="qt-text-small">
                        Compute file hashes (slower but enables deduplication)
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Scan errors */}
              {scanResult.errors.length > 0 && (
                <div className="mt-4 qt-alert-warning">
                  <p className="font-medium mb-1">Scan warnings:</p>
                  <ul className="list-disc list-inside">
                    {scanResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {scanResult.errors.length > 5 && (
                      <li>...and {scanResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={scanning || adopting}
            className="qt-button qt-button-secondary"
          >
            Close
          </button>
          {scanResult && orphans.length > 0 && (
            <button
              onClick={handleAdopt}
              disabled={scanning || adopting || selectedKeys.size === 0}
              className="qt-button qt-button-primary"
            >
              {adopting ? 'Adopting...' : `Adopt ${selectedKeys.size} File${selectedKeys.size !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Row component for an orphan file
 */
function OrphanFileRow({
  orphan,
  selected,
  onToggle,
}: {
  orphan: OrphanFile
  selected: boolean
  onToggle: () => void
}) {
  const filename = orphan.parsed?.filename || orphan.storageKey.split('/').pop() || 'Unknown'
  const folder = orphan.parsed?.folderPath || '/'

  return (
    <label
      className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 border-b last:border-b-0 dark:border-gray-700 ${
        selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="rounded"
      />
      <div className="flex-1 min-w-0">
        <p className="qt-text truncate">{filename}</p>
        <p className="qt-text-small text-muted-foreground truncate">
          {folder} &bull; {orphan.mimeType} &bull; {formatFileSize(orphan.size)}
        </p>
      </div>
    </label>
  )
}
