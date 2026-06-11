'use client'

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

type ScopePolicy = 'down-weight' | 'exclude'

interface RecallConfig {
  scopePolicy: ScopePolicy
}

const DEFAULT_CONFIG: RecallConfig = {
  scopePolicy: 'down-weight',
}

const SCOPE_POLICY_OPTIONS: ReadonlyArray<{
  value: ScopePolicy
  label: string
  description: string
}> = [
  {
    value: 'down-weight',
    label: 'Down-weight (recommended)',
    description:
      'Apply a strong penalty so a memory tied to another project rarely surfaces here — but never fully hide it. A powerful match can still break through.',
  },
  {
    value: 'exclude',
    label: 'Exclude',
    description:
      'Drop project-specific memories from other projects out of this chat entirely. The firmest guard against cross-project leakage.',
  },
]

/**
 * The cross-project scope policy for the Commonplace Book recall path. Instance-
 * wide setting (`instance_settings['memoryRecall']`) read on every turn by the
 * recall path; see lib/memory/recall-tags.ts.
 */
export function MemoryRecallCard() {
  const [config, setConfig] = useState<RecallConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/memories?action=recall-config')
        if (!response.ok) {
          throw new Error('Failed to load recall settings')
        }
        const data = await response.json()
        if (!cancelled && data.settings) {
          setConfig({ ...DEFAULT_CONFIG, ...data.settings })
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load recall settings'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveConfig = async (next: Partial<RecallConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/memories?action=recall-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save recall settings')
      }
      const data = await response.json()
      setConfig({ ...DEFAULT_CONFIG, ...data.settings })
      showSuccessToast('Recall settings saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save recall settings')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleScopePolicyChange = (value: ScopePolicy) => {
    setConfig(c => ({ ...c, scopePolicy: value }))
    void saveConfig({ scopePolicy: value })
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading recall settings&hellip;</p>
  }

  const activePolicy = SCOPE_POLICY_OPTIONS.find(o => o.value === config.scopePolicy)

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        When a character files away something true only inside a particular project or story, that memory shouldn&rsquo;t come wandering into an unrelated conversation. This setting decides what becomes of such a memory when it tries to surface in a chat belonging to a different project.
      </p>

      <div>
        <label className="qt-text-label block mb-2">Cross-project memories:</label>
        <select
          value={config.scopePolicy}
          onChange={e => handleScopePolicyChange(e.target.value as ScopePolicy)}
          disabled={saving}
          className="qt-select w-full"
        >
          {SCOPE_POLICY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {activePolicy && (
          <p className="qt-text-xs qt-text-secondary mt-1">{activePolicy.description}</p>
        )}
      </div>

      {error && <p className="qt-text-small qt-text-error">{error}</p>}
    </div>
  )
}
