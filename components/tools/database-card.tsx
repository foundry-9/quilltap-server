'use client'

import { useState, useEffect } from 'react'

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

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">Database</h2>
          <p className="qt-text-small">
            Current database backend status
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

          {/* Migration Info */}
          {status.mongoAvailable && status.currentBackend === 'mongodb' && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200 px-4 py-3 rounded text-sm">
              <p className="font-medium mb-1">Migration to SQLite</p>
              <p>
                To migrate from MongoDB to SQLite, use the standalone CLI tool:
              </p>
              <code className="block mt-2 p-2 bg-blue-100 dark:bg-blue-900/50 rounded text-xs font-mono break-all">
                node scripts/mongo-to-sqlite-cli.js -m &quot;{'{'}MONGODB_URI{'}'}&quot; -o ./quilttap.db
              </code>
              <p className="mt-2 text-xs">
                See <code>node scripts/mongo-to-sqlite-cli.js --help</code> for more options.
              </p>
            </div>
          )}

          {status.currentBackend === 'sqlite' && (
            <p className="text-sm text-muted-foreground text-center py-2">
              You are using SQLite as your database backend.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
