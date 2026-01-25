'use client'

import { useState, useEffect } from 'react'
import { DatabaseMigrationDialog } from './database-migration-dialog'

interface DatabaseStatus {
  currentBackend: 'mongodb' | 'sqlite'
  preferredBackend: 'mongodb' | 'sqlite' | null
  mongoAvailable: boolean
  sqliteAvailable: boolean
  health: {
    healthy: boolean
    latencyMs: number
    message?: string
  }
}

export function DatabaseCard() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  const [showSwitchBackDialog, setShowSwitchBackDialog] = useState(false)
  const [switchingBack, setSwitchingBack] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/v1/system/tools?action=database-status', {
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error('Failed to fetch database status')
      }
      const data = await res.json()
      setStatus(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }

  const handleSwitchBack = async () => {
    if (confirmText !== 'I understand') {
      setError('Please type "I understand" to confirm')
      return
    }

    try {
      setSwitchingBack(true)
      setError(null)

      const res = await fetch('/api/v1/system/tools?action=switch-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: 'mongodb',
          confirm: 'I_UNDERSTAND_DATA_WILL_BE_LOST',
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to switch backend')
      }

      // Show success and close dialog
      setShowSwitchBackDialog(false)
      setConfirmText('')

      // Refresh status
      await fetchStatus()

      // Alert user to restart
      alert('Backend preference updated. Please restart the application to apply changes.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch backend')
    } finally {
      setSwitchingBack(false)
    }
  }

  const handleMigrationComplete = () => {
    fetchStatus()
  }

  const canMigrate = status?.currentBackend === 'mongodb' && status?.sqliteAvailable
  const canSwitchBack = status?.currentBackend === 'sqlite' && status?.mongoAvailable

  return (
    <>
      <div className="qt-card p-6">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-foreground mb-1">Database</h2>
            <p className="qt-text-small">
              Manage your database backend and migrate data between MongoDB and SQLite
            </p>
          </div>
          <div className="flex-shrink-0 text-primary">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
              />
            </svg>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="text-center py-6 text-muted-foreground">
            <svg className="animate-spin h-6 w-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Loading database status...
          </div>
        ) : status ? (
          <>
            {/* Current Status */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Current Status
              </h3>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    status.currentBackend === 'mongodb'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}
                >
                  {status.currentBackend === 'mongodb' ? 'MongoDB' : 'SQLite'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-sm ${
                    status.health.healthy
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status.health.healthy ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  {status.health.healthy ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>

            {/* Backend Availability */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Available Backends
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`p-3 rounded-lg border ${
                    status.mongoAvailable
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                      : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status.mongoAvailable ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="font-medium">MongoDB</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status.mongoAvailable ? 'Available' : 'Not configured'}
                  </p>
                </div>
                <div
                  className={`p-3 rounded-lg border ${
                    status.sqliteAvailable
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                      : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status.sqliteAvailable ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="font-medium">SQLite</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status.sqliteAvailable ? 'Available' : 'Not available'}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              {canMigrate && (
                <button
                  onClick={() => setShowMigrationDialog(true)}
                  className="qt-button qt-button-primary w-full flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Migrate to SQLite
                </button>
              )}

              {canSwitchBack && (
                <button
                  onClick={() => setShowSwitchBackDialog(true)}
                  className="qt-button qt-button-secondary w-full flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  Switch Back to MongoDB
                </button>
              )}

              {!canMigrate && !canSwitchBack && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  {status.currentBackend === 'sqlite'
                    ? 'You are using SQLite. Configure MONGODB_URI to enable MongoDB.'
                    : 'No migration options available.'}
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Migration Dialog */}
      <DatabaseMigrationDialog
        isOpen={showMigrationDialog}
        onClose={() => setShowMigrationDialog(false)}
        onMigrationComplete={handleMigrationComplete}
      />

      {/* Switch Back Confirmation Dialog */}
      {showSwitchBackDialog && (
        <>
          <button
            className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
            onClick={() => {
              setShowSwitchBackDialog(false)
              setConfirmText('')
              setError(null)
            }}
            aria-label="Close dialog"
            type="button"
          />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <div className="qt-dialog max-w-md">
              <div className="qt-dialog-header">
                <div className="flex items-center justify-between">
                  <h2 className="qt-dialog-title text-amber-600 dark:text-amber-400">
                    Switch Back to MongoDB
                  </h2>
                  <button
                    onClick={() => {
                      setShowSwitchBackDialog(false)
                      setConfirmText('')
                      setError(null)
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close dialog"
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
              </div>

              <div className="qt-dialog-body space-y-4">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200 px-4 py-3 rounded">
                  <div className="flex items-start gap-2">
                    <svg
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div>
                      <p className="font-semibold">Warning: Data Loss</p>
                      <p className="text-sm mt-1">
                        Any data created or modified since migrating to SQLite will be{' '}
                        <strong>permanently lost</strong>. MongoDB was not updated during SQLite
                        operation.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Type &quot;I understand&quot; to confirm:
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="qt-input w-full"
                    placeholder="I understand"
                  />
                </div>

                {error && (
                  <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-2 rounded text-sm">
                    {error}
                  </div>
                )}
              </div>

              <div className="qt-dialog-footer">
                <button
                  onClick={() => {
                    setShowSwitchBackDialog(false)
                    setConfirmText('')
                    setError(null)
                  }}
                  disabled={switchingBack}
                  className="qt-button qt-button-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSwitchBack}
                  disabled={switchingBack || confirmText !== 'I understand'}
                  className="qt-button bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {switchingBack ? (
                    <>
                      <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Switching...
                    </>
                  ) : (
                    'Switch to MongoDB'
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
