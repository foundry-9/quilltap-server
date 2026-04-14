'use client'

/**
 * Document Store Detail Page
 *
 * Shows a single document store's details and its indexed files
 * with size, sync status, conversion status, and embedding info.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDocumentStoreDetail } from './hooks/useDocumentStoreDetail'
import { FileTable } from './components'
import { EditDocumentStoreDialog } from '../components/EditDocumentStoreDialog'
import type { UpdateDocumentStoreData } from '../types'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )
}

export default function DocumentStoreDetailPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = params.id as string
  const {
    store,
    files,
    loading,
    filesLoading,
    error,
    scanning,
    fetchStore,
    fetchFiles,
    updateStore,
    scanStore,
  } = useDocumentStoreDetail(storeId)

  const [editDialogOpen, setEditDialogOpen] = useState(false)

  useEffect(() => {
    fetchStore()
    fetchFiles()
  }, [fetchStore, fetchFiles])

  const handleUpdate = async (id: string, data: UpdateDocumentStoreData) => {
    const result = await updateStore(data)
    if (result) {
      setEditDialogOpen(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading document store...</p>
      </div>
    )
  }

  if (error || !store) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">{error || 'Document store not found'}</p>
          <button onClick={() => router.push('/scriptorium')} className="qt-button-secondary">
            Back to The Scriptorium
          </button>
        </div>
      </div>
    )
  }

  const lastScanned = store.lastScannedAt
    ? new Date(store.lastScannedAt).toLocaleString()
    : 'Never'

  return (
    <div className="qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/scriptorium.webp)' } as React.CSSProperties}>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/scriptorium')}
          className="inline-flex items-center gap-1 text-sm qt-text-secondary hover:text-foreground mb-4 transition-colors"
        >
          <ChevronLeftIcon className="w-4 h-4" />
          Back to The Scriptorium
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold leading-tight">{store.name}</h1>
              {!store.enabled && (
                <span className="qt-badge-disabled inline-flex items-center">
                  Disabled
                </span>
              )}
            </div>
            <p className="mt-1 qt-text-small font-mono text-xs">{store.basePath}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={scanStore}
              disabled={scanning || store.scanStatus === 'scanning'}
              className={`qt-button-secondary inline-flex items-center gap-1.5 ${scanning || store.scanStatus === 'scanning' ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <RefreshIcon className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Now'}
            </button>
            <button
              onClick={() => setEditDialogOpen(true)}
              className="qt-button-secondary inline-flex items-center gap-1.5"
            >
              <PencilIcon className="w-4 h-4" />
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="text-2xl font-bold text-foreground">{store.fileCount}</div>
          <div className="text-xs qt-text-secondary">Indexed Files</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="text-2xl font-bold text-foreground">{formatBytes(store.totalSizeBytes)}</div>
          <div className="text-xs qt-text-secondary">Total Size</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <div className="text-sm font-medium text-foreground">{lastScanned}</div>
          <div className="text-xs qt-text-secondary">Last Scanned</div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          {store.chunkCount === 0 ? (
            <>
              <div className="text-sm font-medium qt-text-secondary">No chunks</div>
              <div className="text-xs qt-text-secondary">Embedding Status</div>
            </>
          ) : store.embeddedChunkCount === store.chunkCount ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full qt-dot-success" />
                <span className="text-sm font-medium qt-text-success">Complete</span>
              </div>
              <div className="text-xs qt-text-secondary">{store.embeddedChunkCount}/{store.chunkCount} chunks embedded</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full qt-dot-warning" />
                <span className="text-sm font-medium qt-text-warning">{Math.round((store.embeddedChunkCount / store.chunkCount) * 100)}%</span>
              </div>
              <div className="text-xs qt-text-secondary">{store.embeddedChunkCount}/{store.chunkCount} chunks embedded</div>
            </>
          )}
        </div>
      </div>

      {/* Scan error display */}
      {store.scanStatus === 'error' && store.lastScanError && (
        <div className="mb-6 rounded-xl qt-border-destructive/30 qt-bg-destructive/10 border p-4">
          <h3 className="text-sm font-semibold qt-text-destructive mb-1">Last Scan Error</h3>
          <p className="text-sm qt-text-destructive">{store.lastScanError}</p>
        </div>
      )}

      {/* Pattern info */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <h3 className="text-xs font-medium qt-text-secondary uppercase tracking-wider mb-2">Include Patterns</h3>
          <div className="flex flex-wrap gap-1.5">
            {store.includePatterns.map((p, i) => (
              <span key={i} className="inline-flex rounded qt-bg-success/10 qt-text-success px-2 py-0.5 text-xs font-mono">
                {p}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl qt-bg-card border qt-border-default p-4">
          <h3 className="text-xs font-medium qt-text-secondary uppercase tracking-wider mb-2">Exclude Patterns</h3>
          <div className="flex flex-wrap gap-1.5">
            {store.excludePatterns.map((p, i) => (
              <span key={i} className="inline-flex rounded qt-bg-destructive/10 qt-text-destructive px-2 py-0.5 text-xs font-mono">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Files section */}
      <div className="border-t qt-border-default/60 pt-6">
        <h2 className="text-xl font-semibold mb-4">Indexed Files</h2>
        <FileTable files={files} loading={filesLoading} />
      </div>

      {/* Edit dialog */}
      {editDialogOpen && (
        <EditDocumentStoreDialog
          store={store}
          onClose={() => setEditDialogOpen(false)}
          onSubmit={handleUpdate}
        />
      )}
    </div>
  )
}
