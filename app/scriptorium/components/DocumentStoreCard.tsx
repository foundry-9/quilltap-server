'use client'

/**
 * Document Store Card
 *
 * Displays a single document store with status and actions.
 */

import type { DocumentStore } from '../types'

interface DocumentStoreCardProps {
  store: DocumentStore
  onClick: (e: React.MouseEvent) => void
  onEdit: () => void
  onDelete: () => void
  onScan: () => void
  onConvert: () => void
  onDeconvert: () => void
  scanning: boolean
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5 5 5M12 5v12" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function ScanStatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'scanning') {
    return (
      <span className="qt-badge-warning inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full qt-dot-warning" />
        Scanning
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="qt-badge-destructive inline-flex items-center gap-1" title={error || 'Scan error'}>
        Error
      </span>
    )
  }
  return null
}

function EmbeddingStatusBadge({ embedded, total }: { embedded: number; total: number }) {
  if (total === 0) return null

  if (embedded === total) {
    return (
      <span className="qt-badge-success inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full qt-dot-success" />
        Embedded
      </span>
    )
  }

  const pct = Math.round((embedded / total) * 100)
  return (
    <span className="qt-badge-warning inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full qt-dot-warning" />
      {pct}% embedded
    </span>
  )
}

function MountTypeBadge({ type }: { type: string }) {
  let badgeClass = 'qt-badge-info'
  let label = 'Filesystem'
  if (type === 'obsidian') {
    badgeClass = 'qt-badge-related'
    label = 'Obsidian'
  } else if (type === 'database') {
    badgeClass = 'qt-badge-success'
    label = 'Database'
  }
  return (
    <span className={`${badgeClass} inline-flex items-center`}>
      {label}
    </span>
  )
}

function StoreTypeBadge({ type }: { type: string }) {
  if (type === 'character') {
    return (
      <span className="qt-badge-related inline-flex items-center" title="Character store">
        Character
      </span>
    )
  }
  return (
    <span className="qt-badge-info inline-flex items-center" title="Documents store">
      Documents
    </span>
  )
}

function ConversionStatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'converting') {
    return (
      <span className="qt-badge-warning inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full qt-dot-warning" />
        Converting
      </span>
    )
  }
  if (status === 'deconverting') {
    return (
      <span className="qt-badge-warning inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full qt-dot-warning" />
        Deconverting
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="qt-badge-destructive inline-flex items-center gap-1" title={error || 'Conversion error'}>
        Conversion error
      </span>
    )
  }
  return null
}

export function DocumentStoreCard({ store, onClick, onEdit, onDelete, onScan, onConvert, onDeconvert, scanning }: DocumentStoreCardProps) {
  const lastScanned = store.lastScannedAt
    ? new Date(store.lastScannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Never'

  const isDatabaseBacked = store.mountType === 'database'
  const conversionInFlight =
    store.conversionStatus === 'converting' || store.conversionStatus === 'deconverting'
  const actionsDisabled = scanning || store.scanStatus === 'scanning' || conversionInFlight

  return (
    <div
      className={`qt-entity-card cursor-pointer hover:qt-border-primary/50 transition-colors ${!store.enabled ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted shrink-0">
            <DatabaseIcon className="w-5 h-5 qt-text-secondary" />
          </div>
          <div className="min-w-0">
            <h2 className="qt-section-title truncate">{store.name}</h2>
            <p className="qt-text-small truncate" title={store.basePath || 'Database-backed — no path'}>
              {store.basePath || <em className="qt-text-secondary">Database-backed — no path</em>}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <StoreTypeBadge type={store.storeType} />
        <MountTypeBadge type={store.mountType} />
        <ScanStatusBadge status={store.scanStatus} error={store.lastScanError} />
        <ConversionStatusBadge status={store.conversionStatus} error={store.conversionError} />
        <EmbeddingStatusBadge embedded={store.embeddedChunkCount} total={store.chunkCount} />
        {!store.enabled && (
          <span className="qt-badge-disabled inline-flex items-center">
            Disabled
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-lg qt-bg-muted/50 px-2 py-1.5">
          <div className="qt-section-title">{store.fileCount}</div>
          <div className="text-xs qt-text-secondary">Files</div>
        </div>
        <div className="rounded-lg qt-bg-muted/50 px-2 py-1.5">
          <div className="qt-section-title">{formatBytes(store.totalSizeBytes)}</div>
          <div className="text-xs qt-text-secondary">Total Size</div>
        </div>
        <div className="rounded-lg qt-bg-muted/50 px-2 py-1.5">
          <div className="text-xs qt-text-secondary mt-1">Scanned</div>
          <div className="text-xs font-medium text-foreground">{lastScanned}</div>
        </div>
      </div>

      <div className="qt-entity-card-actions flex gap-2 flex-wrap">
        <button
          onClick={(e) => { e.stopPropagation(); onScan() }}
          disabled={actionsDisabled}
          className={`qt-button-secondary flex-1 inline-flex items-center justify-center gap-1.5 ${actionsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Scan for changes"
        >
          <RefreshIcon className={`w-4 h-4 ${scanning || store.scanStatus === 'scanning' ? 'animate-spin' : ''}`} />
          {scanning || store.scanStatus === 'scanning' ? 'Scanning...' : 'Scan'}
        </button>
        {isDatabaseBacked ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDeconvert() }}
            disabled={actionsDisabled}
            className={`qt-button-secondary inline-flex items-center justify-center gap-1.5 ${actionsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Export everything out to a filesystem directory and switch to filesystem-backed"
          >
            <DownloadIcon className={`w-4 h-4 ${store.conversionStatus === 'deconverting' ? 'animate-pulse' : ''}`} />
            {store.conversionStatus === 'deconverting' ? 'Deconverting...' : 'Deconvert'}
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onConvert() }}
            disabled={actionsDisabled}
            className={`qt-button-secondary inline-flex items-center justify-center gap-1.5 ${actionsDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Move every file into the encrypted database and switch to database-backed"
          >
            <UploadIcon className={`w-4 h-4 ${store.conversionStatus === 'converting' ? 'animate-pulse' : ''}`} />
            {store.conversionStatus === 'converting' ? 'Converting...' : 'Convert'}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          disabled={conversionInFlight}
          className={`qt-button-secondary ${conversionInFlight ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Edit document store"
        >
          <PencilIcon className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          disabled={conversionInFlight}
          className={`qt-button-destructive qt-shadow-sm ${conversionInFlight ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Delete document store"
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
