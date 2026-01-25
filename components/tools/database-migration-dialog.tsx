'use client'

import { useState, useEffect, useCallback } from 'react'

interface MigrationReadiness {
  ready: boolean
  sourceConnected: boolean
  targetWritable: boolean
  collectionCounts: Record<string, number>
  totalRecords: number
  errors: string[]
  warnings: string[]
}

interface MigrationProgress {
  phase: 'preparing' | 'migrating' | 'verifying' | 'complete' | 'failed'
  currentCollection: string | null
  collectionsCompleted: number
  collectionsTotal: number
  recordsCompleted: number
  recordsTotal: number
  errors: string[]
  startedAt: string | null
  completedAt: string | null
}

interface DatabaseMigrationDialogProps {
  isOpen: boolean
  onClose: () => void
  onMigrationComplete: () => void
}

type DialogStep = 'preflight' | 'confirm' | 'progress' | 'complete'

export function DatabaseMigrationDialog({
  isOpen,
  onClose,
  onMigrationComplete,
}: DatabaseMigrationDialogProps) {
  const [step, setStep] = useState<DialogStep>('preflight')
  const [readiness, setReadiness] = useState<MigrationReadiness | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationStarted, setMigrationStarted] = useState(false)

  const fetchReadiness = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/v1/system/tools?action=migration-readiness', {
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error('Failed to check migration readiness')
      }
      const data = await res.json()
      setReadiness(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check readiness')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/tools?action=migration-progress', {
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error('Failed to fetch migration progress')
      }
      const data = await res.json()
      if (data.progress) {
        setProgress(data.progress)

        // Update step based on progress
        if (data.progress.phase === 'complete') {
          setStep('complete')
        } else if (data.progress.phase === 'failed') {
          setError(data.progress.errors.join(', ') || 'Migration failed')
        }
      }
    } catch (err) {
      // Don't show error for progress polling
      console.error('Progress fetch error:', err)
    }
  }, [])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('preflight')
      setReadiness(null)
      setProgress(null)
      setError(null)
      setMigrationStarted(false)
      fetchReadiness()
    }
  }, [isOpen, fetchReadiness])

  // Poll for progress when migration is running
  useEffect(() => {
    if (!migrationStarted || step === 'complete') return

    const interval = setInterval(fetchProgress, 1000)
    return () => clearInterval(interval)
  }, [migrationStarted, step, fetchProgress])

  const handleStartMigration = async () => {
    try {
      setLoading(true)
      setError(null)
      setMigrationStarted(true)
      setStep('progress')

      const res = await fetch('/api/v1/system/tools?action=start-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'mongo-to-sqlite' }),
      })

      const data = await res.json()

      if (data.success) {
        setStep('complete')
        onMigrationComplete()
      } else {
        setError(data.result?.errors?.join(', ') || data.message || 'Migration failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start migration')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (step === 'progress' && migrationStarted) {
      // Don't allow closing during migration
      return
    }
    onClose()
  }

  if (!isOpen) return null

  const getProgressPercentage = () => {
    if (!progress) return 0
    if (progress.recordsTotal === 0) return 0
    return Math.round((progress.recordsCompleted / progress.recordsTotal) * 100)
  }

  const formatNumber = (n: number) => n.toLocaleString()

  return (
    <>
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={handleClose}
        disabled={step === 'progress'}
        aria-label="Close dialog"
        type="button"
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto">
        <div className="qt-dialog max-w-lg">
          {/* Header */}
          <div className="qt-dialog-header">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title">Migrate to SQLite</h2>
              {step !== 'progress' && (
                <button
                  onClick={handleClose}
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
              )}
            </div>
            <p className="qt-dialog-description">
              {step === 'preflight' && 'Checking migration requirements...'}
              {step === 'confirm' && 'Review and confirm migration'}
              {step === 'progress' && 'Migration in progress...'}
              {step === 'complete' && 'Migration complete!'}
            </p>
          </div>

          {/* Body */}
          <div className="qt-dialog-body space-y-4">
            {/* Error Display */}
            {error && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
                {error}
              </div>
            )}

            {/* Pre-flight Check Step */}
            {step === 'preflight' && (
              <>
                {loading ? (
                  <div className="text-center py-8">
                    <svg
                      className="animate-spin h-8 w-8 mx-auto mb-3 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                    <p className="text-muted-foreground">Checking migration requirements...</p>
                  </div>
                ) : readiness ? (
                  <div className="space-y-4">
                    {/* Checks */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center ${
                            readiness.sourceConnected
                              ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          }`}
                        >
                          {readiness.sourceConnected ? (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </span>
                        <span>MongoDB connected</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center ${
                            readiness.targetWritable
                              ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          }`}
                        >
                          {readiness.targetWritable ? (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </span>
                        <span>SQLite target writable</span>
                      </div>
                    </div>

                    {/* Record counts */}
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm font-medium mb-2">
                        Records to migrate: {formatNumber(readiness.totalRecords)}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground max-h-32 overflow-y-auto">
                        {Object.entries(readiness.collectionCounts)
                          .filter(([, count]) => count > 0)
                          .map(([name, count]) => (
                            <div key={name} className="flex justify-between">
                              <span>{name}</span>
                              <span>{formatNumber(count)}</span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Errors */}
                    {readiness.errors.length > 0 && (
                      <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded text-sm">
                        <p className="font-medium mb-1">Cannot proceed:</p>
                        <ul className="list-disc list-inside">
                          {readiness.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Warnings */}
                    {readiness.warnings.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200 px-4 py-3 rounded text-sm">
                        <p className="font-medium mb-1">Warnings:</p>
                        <ul className="list-disc list-inside">
                          {readiness.warnings.map((warn, i) => (
                            <li key={i}>{warn}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}

            {/* Confirmation Step */}
            {step === 'confirm' && readiness && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200 px-4 py-3 rounded">
                  <p className="font-medium">Ready to migrate</p>
                  <p className="text-sm mt-1">
                    This will copy {formatNumber(readiness.totalRecords)} records from MongoDB to
                    SQLite. Your MongoDB data will not be modified.
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200 px-4 py-3 rounded">
                  <p className="font-medium">Important</p>
                  <ul className="text-sm mt-1 list-disc list-inside space-y-1">
                    <li>The application will need to be restarted after migration</li>
                    <li>New data will only be written to SQLite after switching</li>
                    <li>You can switch back to MongoDB, but new SQLite data will be lost</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Progress Step */}
            {step === 'progress' && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <svg
                    className="animate-spin h-10 w-10 mx-auto mb-4 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
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
                  {progress && (
                    <>
                      <p className="font-medium">
                        {progress.phase === 'preparing' && 'Preparing migration...'}
                        {progress.phase === 'migrating' &&
                          `Migrating: ${progress.currentCollection || '...'}`}
                        {progress.phase === 'verifying' && 'Verifying data...'}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {formatNumber(progress.recordsCompleted)} of{' '}
                        {formatNumber(progress.recordsTotal)} records
                      </p>
                    </>
                  )}
                </div>

                {/* Progress bar */}
                {progress && (
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${getProgressPercentage()}%` }}
                    />
                  </div>
                )}

                <p className="text-center text-sm text-muted-foreground">
                  Please do not close this window during migration.
                </p>
              </div>
            )}

            {/* Complete Step */}
            {step === 'complete' && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-green-600 dark:text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-green-600 dark:text-green-400">
                    Migration Complete!
                  </h3>
                  {progress && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Successfully migrated {formatNumber(progress.recordsCompleted)} records.
                    </p>
                  )}
                </div>

                <div className="bg-blue-50 border border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200 px-4 py-3 rounded">
                  <p className="font-medium">Restart Required</p>
                  <p className="text-sm mt-1">
                    Please restart the application to start using the SQLite database.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer">
            {step === 'preflight' && (
              <>
                <button onClick={handleClose} className="qt-button qt-button-secondary">
                  Cancel
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={loading || !readiness?.ready}
                  className="qt-button qt-button-primary disabled:opacity-50"
                >
                  Continue
                </button>
              </>
            )}

            {step === 'confirm' && (
              <>
                <button
                  onClick={() => setStep('preflight')}
                  disabled={loading}
                  className="qt-button qt-button-secondary"
                >
                  Back
                </button>
                <button
                  onClick={handleStartMigration}
                  disabled={loading}
                  className="qt-button qt-button-primary disabled:opacity-50"
                >
                  {loading ? 'Starting...' : 'Start Migration'}
                </button>
              </>
            )}

            {step === 'progress' && (
              <p className="text-sm text-muted-foreground text-center w-full">
                Migration in progress...
              </p>
            )}

            {step === 'complete' && (
              <button onClick={handleClose} className="qt-button qt-button-primary w-full">
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
