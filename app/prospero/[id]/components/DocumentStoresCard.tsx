'use client'

/**
 * Document Stores Card
 *
 * Expandable card displaying document stores linked to this project.
 * Users can link/unlink stores and see file counts and status information.
 */

import { useState } from 'react'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import type { DocumentStore } from '@/app/scriptorium/types'

interface DocumentStoresCardProps {
  linkedStores: DocumentStore[]
  allStores: DocumentStore[]
  expanded: boolean
  onToggle: () => void
  onLink: (storeId: string) => Promise<boolean>
  onUnlink: (storeId: string) => Promise<boolean>
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
      />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentStoresCard({
  linkedStores,
  allStores,
  expanded,
  onToggle,
  onLink,
  onUnlink,
}: DocumentStoresCardProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState<string | null>(null)

  const linkedStoreIds = new Set(linkedStores.map((s) => s.id))
  const unlinkedStores = allStores.filter((s) => !linkedStoreIds.has(s.id))

  const handleLink = async () => {
    if (!selectedStoreId) return

    setLinking(true)
    try {
      const success = await onLink(selectedStoreId)
      if (success) {
        setShowPicker(false)
        setSelectedStoreId(null)
      }
    } finally {
      setLinking(false)
    }
  }

  const handleUnlink = async (storeId: string) => {
    setUnlinking(storeId)
    try {
      await onUnlink(storeId)
    } finally {
      setUnlinking(null)
    }
  }

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <DatabaseIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">The Scriptorium</h3>
            <p className="qt-text-small qt-text-secondary">
              {linkedStores.length} store{linkedStores.length !== 1 ? 's' : ''} linked
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default">
          {linkedStores.length === 0 ? (
            <div className="p-4 text-center qt-text-secondary">
              <p>No document stores linked.</p>
              <p className="qt-text-small mt-1">
                Link a document store to enable AI-powered file editing and search.
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {linkedStores.map((store) => (
                <div
                  key={store.id}
                  className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                    store.enabled ? 'hover:qt-bg-muted' : 'qt-bg-muted'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground truncate">{store.name}</p>
                      <span className="qt-text-xs qt-bg-muted px-2 py-0.5 rounded-full flex-shrink-0">
                        {store.mountType}
                      </span>
                      {!store.enabled && (
                        <span className="qt-text-xs qt-text-secondary flex-shrink-0">(disabled)</span>
                      )}
                    </div>
                    <p className="qt-text-xs qt-text-secondary mt-1">
                      {store.fileCount} file{store.fileCount !== 1 ? 's' : ''} &bull;{' '}
                      {formatBytes(store.totalSizeBytes)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnlink(store.id)}
                    disabled={unlinking === store.id}
                    className="ml-2 flex-shrink-0 p-1.5 rounded hover:qt-text-destructive transition-colors disabled:opacity-50"
                    title="Unlink document store"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons or picker */}
          <div className="p-2 border-t qt-border-default">
            {!showPicker ? (
              <button
                onClick={() => setShowPicker(true)}
                disabled={unlinkedStores.length === 0}
                className="w-full qt-button qt-button-primary text-sm"
                title={unlinkedStores.length === 0 ? 'All document stores are already linked' : ''}
              >
                Link Document Store
              </button>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedStoreId || ''}
                  onChange={(e) => setSelectedStoreId(e.target.value || null)}
                  className="w-full px-3 py-2 rounded border qt-border-default bg-transparent text-foreground text-sm"
                >
                  <option value="">Select a document store...</option>
                  {unlinkedStores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={handleLink}
                    disabled={!selectedStoreId || linking}
                    className="flex-1 qt-button qt-button-primary text-sm"
                  >
                    {linking ? 'Linking...' : 'Link'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPicker(false)
                      setSelectedStoreId(null)
                    }}
                    className="flex-1 qt-button qt-button-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
