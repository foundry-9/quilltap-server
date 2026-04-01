'use client'

/**
 * API Key Panel
 *
 * UI component for managing sync API keys.
 * Allows users to generate, view, and revoke API keys for sync authentication.
 *
 * @module components/settings/sync/components/ApiKeyPanel
 */

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { SyncApiKeyDisplay } from '../types'

interface ApiKeyPanelProps {
  keys: SyncApiKeyDisplay[]
  newlyCreatedKey: string | null
  isLoading: boolean
  isCreating: boolean
  deleteConfirmId: string | null
  success: string | null
  error: string | null
  onCreateKey: (name: string) => Promise<any>
  onDeleteKey: (keyId: string) => Promise<void>
  onDeleteConfirmToggle: (keyId: string | null) => void
  onClearNewKey: () => void
}

export function ApiKeyPanel({
  keys,
  newlyCreatedKey,
  isLoading,
  isCreating,
  deleteConfirmId,
  success,
  error,
  onCreateKey,
  onDeleteKey,
  onDeleteConfirmToggle,
  onClearNewKey,
}: ApiKeyPanelProps) {
  const [keyName, setKeyName] = useState('')
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // Log renders
  useEffect(() => {
    clientLogger.debug('ApiKeyPanel: rendered', {
      keyCount: keys.length,
      hasNewKey: !!newlyCreatedKey,
      isExpanded,
    })
  }, [keys.length, newlyCreatedKey, isExpanded])

  // Handle create
  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyName.trim()) return

    clientLogger.debug('ApiKeyPanel: creating key', { name: keyName })
    const result = await onCreateKey(keyName.trim())
    if (result) {
      setKeyName('')
    }
  }, [keyName, onCreateKey])

  // Handle copy
  const handleCopy = useCallback(async () => {
    if (!newlyCreatedKey) return

    try {
      await navigator.clipboard.writeText(newlyCreatedKey)
      setCopied(true)
      clientLogger.debug('ApiKeyPanel: key copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      clientLogger.error('ApiKeyPanel: failed to copy key', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [newlyCreatedKey])

  // Format date for display
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="qt-bg-surface qt-border rounded-lg">
      {/* Header - clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 qt-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <h3 className="qt-text-primary font-medium">Your Sync API Key</h3>
          {keys.length > 0 && (
            <span className="qt-bg-muted px-2 py-0.5 rounded-full text-xs qt-text-muted">
              {keys.length} key{keys.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 qt-text-muted transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t qt-border">
          {/* Description */}
          <p className="qt-text-small text-muted-foreground mt-3">
            Generate an API key to allow other Quilltap instances to sync with this one.
            Share this key with your other instance to enable bidirectional sync.
          </p>

          {/* New key display */}
          {newlyCreatedKey && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-900/20 dark:border-green-800">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-green-800 dark:text-green-200 font-medium mb-2">
                    API Key Created Successfully
                  </p>
                  <p className="text-green-700 dark:text-green-300 text-sm mb-3">
                    Copy this key now. It will not be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="bg-green-100 dark:bg-green-900/40 px-3 py-2 rounded text-sm font-mono text-green-900 dark:text-green-100 break-all">
                      {newlyCreatedKey}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex-shrink-0 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClearNewKey}
                  className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 text-sm">
              {error}
            </div>
          )}

          {/* Create form */}
          {!newlyCreatedKey && (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Key name (e.g., Home Server)"
                className="flex-1 qt-input px-3 py-2 rounded"
                disabled={isCreating}
              />
              <button
                type="submit"
                disabled={isCreating || !keyName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCreating ? 'Creating...' : 'Generate Key'}
              </button>
            </form>
          )}

          {/* Existing keys */}
          {keys.length > 0 && (
            <div className="space-y-2">
              <h4 className="qt-text-secondary text-sm font-medium">Existing Keys</h4>
              <div className="space-y-2">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between qt-bg-card p-3 rounded-lg qt-border"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="qt-text-primary font-medium">{key.name}</span>
                        <code className="qt-bg-muted px-2 py-0.5 rounded text-xs font-mono qt-text-muted">
                          qt_sync_{key.keyPrefix}...
                        </code>
                        {!key.isActive && (
                          <span className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded text-xs">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="qt-text-small text-muted-foreground mt-1">
                        Created {formatDate(key.createdAt)}
                        {key.lastUsedAt && ` • Last used ${formatDate(key.lastUsedAt)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {deleteConfirmId === key.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onDeleteKey(key.id)}
                            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteConfirmToggle(null)}
                            className="px-3 py-1 qt-bg-muted qt-text-secondary rounded text-sm hover:opacity-80 transition-opacity"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDeleteConfirmToggle(key.id)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                          title="Delete key"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {keys.length === 0 && !isLoading && !newlyCreatedKey && (
            <p className="text-center qt-text-muted py-4">
              No API keys yet. Generate one to enable sync from other instances.
            </p>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
