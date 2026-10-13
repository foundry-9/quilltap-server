'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { MEMORY_CAP_BOUNDS } from '@/lib/memory/settings-defaults'

interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'demoted' | 'kept'
  reason: string
  summary?: string
}

interface HousekeepingPreview {
  wouldDemote: number
  wouldDelete: number
  coldCount?: number
  wouldKeep: number
  totalBefore: number
  totalAfter: number
  /** The cap the preview applied: the one asked for, else the character's configured cap. */
  capUsed?: number
  details: HousekeepingDetail[]
}

interface HousekeepingDialogProps {
  characterId: string
  onClose: () => void
  onComplete: () => void
}

export function HousekeepingDialog({ characterId, onClose, onComplete }: HousekeepingDialogProps) {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [preview, setPreview] = useState<HousekeepingPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Options state
  // Null until the operator types one: the server then applies this
  // character's configured cap (its override, else the global cap), and the
  // preview reports which (`capUsed`).
  const [maxMemories, setMaxMemories] = useState<number | null>(null)

  // Fetch preview when options change
  useEffect(() => {
    const fetchPreview = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (maxMemories !== null) params.set('maxMemories', maxMemories.toString())

        const res = await fetch(`/api/v1/memories?characterId=${characterId}&action=housekeep&${params}`)
        if (!res.ok) throw new Error('Failed to fetch preview')

        const data = await res.json()
        setPreview(data.preview)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preview')
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(fetchPreview, 300)
    return () => clearTimeout(debounce)
  }, [characterId, maxMemories])

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await fetch(`/api/v1/memories?characterId=${characterId}&action=housekeep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          // Omitted when untouched, so the run uses the same configured cap the preview showed.
          ...(maxMemories !== null ? { maxMemories } : {}),
          dryRun: false,
        }),
      })

      if (!res.ok) throw new Error('Failed to run housekeeping')

      const data = await res.json()
      const moved = data.result.demoted ?? 0
      showSuccessToast(
        moved === 1
          ? 'One memory has been shown to the archive, where it will keep.'
          : `${moved} memories have been shown to the archive, where they will keep.`
      )
      onComplete()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to run cleanup')
    } finally {
      setRunning(false)
    }
  }

  const actionCounts = preview?.details.reduce(
    (acc, d) => {
      acc[d.action] = (acc[d.action] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  ) || {}

  return (
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="qt-dialog-header">
          <div className="flex items-center justify-between">
            <h2 className="qt-dialog-title">
              Memory Cleanup
            </h2>
            <button
              onClick={onClose}
              className="qt-text-secondary hover:text-foreground"
            >
              <Icon name="close" className="w-6 h-6" />
            </button>
          </div>
          <p className="qt-dialog-description">
            When a character holds more extracted memories than the cap allows, the least protected are retired to the archive, never destroyed. They stay searchable by the gate and can return should the world ask for them again.
          </p>
        </div>

        {/* Options */}
        <div className="qt-dialog-body border-b qt-border-default space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="qt-label mb-1">
                Maximum Unprotected Memories
              </label>
              <input
                type="number"
                value={maxMemories ?? preview?.capUsed ?? ''}
                onChange={(e) => {
                  const typed = parseInt(e.target.value, 10)
                  setMaxMemories(Number.isFinite(typed) ? typed : null)
                }}
                min={MEMORY_CAP_BOUNDS.min}
                max={MEMORY_CAP_BOUNDS.max}
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                Extracted memories only. Hand-written entries and digests are never archived and
                never counted; past the cap, the least protected memories (the old, unreinforced,
                unlinked and unconsulted) go to the archive first.
              </p>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="qt-text-small">Loading preview...</p>
            </div>
          ) : error ? (
            <div className="qt-bg-destructive/10 border qt-border-destructive/30 qt-text-destructive px-4 py-3 rounded">
              {error}
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="qt-bg-success/10 border qt-border-success/30 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold qt-text-success">
                    {preview.wouldKeep}
                  </p>
                  <p className="text-sm qt-text-success">Keep</p>
                </div>
                <div className="qt-bg-destructive/10 border qt-border-destructive/30 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold qt-text-destructive">
                    {preview.wouldDelete}
                  </p>
                  <p className="text-sm qt-text-destructive">Delete</p>
                </div>
                <div className="qt-bg-warning/10 border qt-border-warning/30 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold qt-text-warning">
                    {preview.wouldDemote}
                  </p>
                  <p className="text-sm qt-text-warning">Archive</p>
                </div>
              </div>

              {/* Details */}
              {preview.wouldDelete > 0 || preview.wouldDemote > 0 ? (
                <div>
                  <h3 className="text-sm qt-text-primary mb-2">
                    Changes Preview
                  </h3>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {preview.details
                      .filter(d => d.action !== 'kept')
                      .map((detail) => (
                        <div
                          key={detail.memoryId}
                          className={`p-3 rounded-lg qt-text-small ${
                            detail.action === 'deleted'
                              ? 'qt-bg-destructive/10 border qt-border-destructive/30'
                              : 'qt-bg-warning/10 border qt-border-warning/30'
                          }`}
                        >
                          <p className="qt-text-primary line-clamp-1">
                            {detail.summary || 'Untitled memory'}
                          </p>
                          <p className="qt-text-xs mt-1">
                            {detail.reason}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 qt-text-small">
                  <p>Nothing to send to the archive with current settings.</p>
                  <p className="qt-text-xs mt-1">All memories are within retention policy.</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer">
          <button
            type="button"
            onClick={onClose}
            className="qt-button qt-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={running || loading || !preview || (preview.wouldDelete === 0 && preview.wouldDemote === 0)}
            className="qt-button qt-button-primary"
          >
            {running ? 'Running...' : `Archive ${(preview?.wouldDemote || 0) + (preview?.wouldDelete || 0)} Memories`}
          </button>
        </div>
      </div>
    </div>
  )
}
