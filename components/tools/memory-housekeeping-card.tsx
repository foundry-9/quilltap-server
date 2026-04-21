'use client'

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

interface HousekeepingConfig {
  enabled: boolean
  perCharacterCap: number
  perCharacterCapOverrides: Record<string, number>
  autoMergeSimilarThreshold: number
  mergeSimilar: boolean
}

const DEFAULT_CONFIG: HousekeepingConfig = {
  enabled: false,
  perCharacterCap: 2000,
  perCharacterCapOverrides: {},
  autoMergeSimilarThreshold: 0.9,
  mergeSimilar: false,
}

export function MemoryHousekeepingCard() {
  const [config, setConfig] = useState<HousekeepingConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/memories?action=housekeeping-config')
        if (!response.ok) {
          throw new Error('Failed to load housekeeping settings')
        }
        const data = await response.json()
        if (!cancelled && data.settings) {
          setConfig({ ...DEFAULT_CONFIG, ...data.settings })
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load housekeeping settings'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveConfig = async (next: Partial<HousekeepingConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/memories?action=housekeeping-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save housekeeping settings')
      }
      const data = await response.json()
      setConfig({ ...DEFAULT_CONFIG, ...data.settings })
      showSuccessToast('Housekeeping settings saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save housekeeping settings')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = () => {
    const next = !config.enabled
    setConfig(c => ({ ...c, enabled: next }))
    void saveConfig({ enabled: next })
  }

  const handleCapBlur = (value: number) => {
    if (!Number.isFinite(value) || value < 100 || value > 100000) return
    if (value === config.perCharacterCap) return
    void saveConfig({ perCharacterCap: Math.floor(value) })
  }

  const handleToggleMergeSimilar = () => {
    const next = !config.mergeSimilar
    setConfig(c => ({ ...c, mergeSimilar: next }))
    void saveConfig({ mergeSimilar: next })
  }

  const handleRunNow = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/memories?action=housekeep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to run housekeeping')
      }
      showSuccessToast('Housekeeping job enqueued — it will run in the background')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to run housekeeping')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading housekeeping settings&hellip;</p>
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Automatic housekeeping prunes low-importance, stale memories once a character approaches its cap. High-importance, manually added, recently accessed, and well-reinforced memories are never touched. Off by default — toggle on once you&rsquo;ve reviewed the limits below.
      </p>

      <label className="flex items-center gap-3 qt-text-body">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={saving}
          onChange={handleToggleEnabled}
          className="qt-checkbox"
        />
        <span>Enable automatic housekeeping</span>
      </label>

      <div className="flex items-center gap-3">
        <label className="qt-text-small qt-text-muted" htmlFor="perCharacterCap">
          Per-character cap
        </label>
        <input
          id="perCharacterCap"
          type="number"
          min={100}
          max={100000}
          step={100}
          value={config.perCharacterCap}
          disabled={saving}
          onChange={(e) =>
            setConfig(c => ({ ...c, perCharacterCap: Number(e.target.value) }))
          }
          onBlur={(e) => handleCapBlur(Number(e.target.value))}
          className="qt-input w-32"
        />
        <span className="qt-text-small qt-text-muted">memories per character</span>
      </div>

      <label className="flex items-center gap-3 qt-text-body">
        <input
          type="checkbox"
          checked={config.mergeSimilar}
          disabled={saving}
          onChange={handleToggleMergeSimilar}
          className="qt-checkbox"
        />
        <span>Also merge semantically similar memories during the sweep</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="qt-button qt-button-secondary"
          disabled={saving}
          onClick={handleRunNow}
        >
          Run housekeeping now
        </button>
        <span className="qt-text-small qt-text-muted">
          Sweeps every character. Runs in the background.
        </span>
      </div>

      {error && <p className="qt-text-small qt-text-error">{error}</p>}
    </div>
  )
}
