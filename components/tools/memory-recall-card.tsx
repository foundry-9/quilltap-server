'use client'

import { useId } from 'react'
import { queryKeys } from '@/lib/query/keys'
import { MEMORY_SETTING_DEFAULTS } from '@/lib/memory/settings-defaults'
import type { MemoryRecallSettings } from '@/lib/schemas/settings.types'
import { useMemorySettingsDocument } from './hooks/useMemorySettingsDocument'

type ScopePolicy = MemoryRecallSettings['scopePolicy']

const RECALL_CONFIG_URL = '/api/v1/memories?action=recall-config'

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
  const id = useId()
  const { config, setConfig, loading, saving, error, save } = useMemorySettingsDocument<MemoryRecallSettings>({
    queryKey: queryKeys.memories.recallConfig,
    url: RECALL_CONFIG_URL,
    defaults: MEMORY_SETTING_DEFAULTS.recall,
    noun: 'recall settings',
  })

  const handleScopePolicyChange = (value: ScopePolicy) => {
    setConfig(c => ({ ...c, scopePolicy: value }))
    void save({ scopePolicy: value })
  }

  const handleExpandRelatedChange = (value: boolean) => {
    setConfig(c => ({ ...c, expandRelated: value }))
    void save({ expandRelated: value })
  }

  const handlePerTurnConversationsChange = (value: boolean) => {
    setConfig(c => ({ ...c, perTurnConversationSummaries: value }))
    void save({ perTurnConversationSummaries: value })
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
        <label htmlFor={`${id}-scope-policy`} className="qt-text-label block mb-2">Cross-project memories:</label>
        <select
          id={`${id}-scope-policy`}
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

      <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
        <input
          type="checkbox"
          checked={config.expandRelated}
          onChange={e => handleExpandRelatedChange(e.target.checked)}
          disabled={saving}
          className="mt-1 qt-checkbox"
        />
        <div className="flex-1">
          <div className="font-medium qt-text">Follow the threads between memories</div>
          <div className="qt-text-small mt-1">
            When a memory surfaces, gather the handful of others it is bound to and let them
            compete for a place in the recollection too. This rescues the memory that is plainly
            relevant by association yet never quite matched the words of the moment. A touch more
            work each turn; left off unless you ask for it.
          </div>
        </div>
      </label>

      <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
        <input
          type="checkbox"
          checked={config.perTurnConversationSummaries}
          onChange={e => handlePerTurnConversationsChange(e.target.checked)}
          disabled={saving}
          className="mt-1 qt-checkbox"
        />
        <div className="flex-1">
          <div className="font-medium qt-text">Consult past conversations every turn</div>
          <div className="qt-text-small mt-1">
            Ordinarily the Book re-reads its shelf of past conversations only at the opening of a
            chat, whenever it takes down a fresh summary, and when somebody speaks of days gone by.
            Switch this on and it consults that shelf on <em>every</em> turn, so the list of
            pertinent past dialogues never lags behind the talk at hand. It rides along on the
            reckoning already made for the memory search, so it asks nothing further of your
            embedding provider — merely a little more reading, and a few more lines in each
            whisper. Off unless you ask for it, and it applies to every conversation alike.
          </div>
        </div>
      </label>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
