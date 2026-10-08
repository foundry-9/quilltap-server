'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface HousekeepingDetail {
  memoryId: string
  action: 'deleted' | 'demoted' | 'merged' | 'kept'
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
  const [maxMemories, setMaxMemories] = useState(1000)
  const [maxAgeMonths, setMaxAgeMonths] = useState(6)
  const [minImportance, setMinImportance] = useState(0.3)

  // Fetch preview when options change
  useEffect(() => {
    const fetchPreview = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          maxMemories: maxMemories.toString(),
          maxAgeMonths: maxAgeMonths.toString(),
          minImportance: minImportance.toString(),
        })

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
  }, [characterId, maxMemories, maxAgeMonths, minImportance])

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await fetch(`/api/v1/memories?characterId=${characterId}&action=housekeep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          maxMemories,
          maxAgeMonths,
          minImportance,
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
            Old and low-importance memories are retired to the archive, never destroyed. They stay searchable by the gate and can return should the world ask for them again.
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
                value={maxMemories}
                onChange={(e) => setMaxMemories(parseInt(e.target.value) || 1000)}
                min={10}
                max={10000}
                className="qt-input"
              />
              <div className="mt-1 qt-text-xs space-y-0.5">
                <p>Never archiving memories that are:</p>
                <ul className="list-disc pl-4">
                  <li>Importance &ge; 70%</li>
                  <li>Reinforced 5+ times</li>
                  <li>Manually created</li>
                  <li>Accessed within last 3 months</li>
                </ul>
              </div>
            </div>

            <div>
              <label className="qt-label mb-1">
                Max Age (months)
              </label>
              <input
                type="number"
                value={maxAgeMonths}
                onChange={(e) => setMaxAgeMonths(parseInt(e.target.value) || 6)}
                min={1}
                max={120}
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                Archive old low-importance memories
              </p>
            </div>
          </div>

          <div>
            <label className="qt-label mb-1">
              Min Importance: {(minImportance * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              value={minImportance}
              onChange={(e) => setMinImportance(parseFloat(e.target.value))}
              min={0}
              max={0.7}
              step={0.1}
              className="qt-range w-full"
            />
            <div className="flex justify-between qt-text-xs mt-1">
              <span>0%</span>
              <span>Threshold for archiving</span>
              <span>70%</span>
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
