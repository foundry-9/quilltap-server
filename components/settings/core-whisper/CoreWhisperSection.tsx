'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { SettingsCard } from '@/components/ui/SettingsCard'
import {
  DEFAULT_CORE_WHISPER_SETTINGS,
  type ChatSettings,
  type CoreWhisperSettings,
} from '@/components/settings/chat-settings/types'

const INTERVAL_OPTIONS = [3, 6, 9, 12, 15, 20, 25, 30, 40, 50] as const
const SILENCE_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20] as const
const BUDGET_OPTIONS = [
  { value: 1024, label: '1,024 tokens' },
  { value: 2048, label: '2,048 tokens' },
  { value: 4096, label: '4,096 tokens (default)' },
  { value: 6144, label: '6,144 tokens' },
  { value: 8192, label: '8,192 tokens' },
  { value: 12288, label: '12,288 tokens' },
] as const

export function CoreWhisperSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettings>('/api/v1/settings/chat', { signal }),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current: CoreWhisperSettings = useMemo(
    () => ({
      ...DEFAULT_CORE_WHISPER_SETTINGS,
      ...(settings?.coreWhisper ?? {}),
    }),
    [settings?.coreWhisper],
  )

  const applyPatch = useCallback(
    async (patch: Partial<CoreWhisperSettings>) => {
      if (!settings) return
      setSaving(true)
      setError(null)
      try {
        const nextCoreWhisper: CoreWhisperSettings = { ...current, ...patch }
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coreWhisper: nextCoreWhisper }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to update Core whisper settings')
        }
        const updated = await res.json()
        // Optimistic, no-revalidate write (was SWR `mutate(updated, false)`).
        queryClient.setQueryData(queryKeys.settings.chat, updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setSaving(false)
      }
    },
    [settings, current, queryClient],
  )

  return (
    <SettingsCard
      title="Aurora's Core Whisper"
      subtitle="A periodic, character-private re-offering of each character's own Core/ vault folder"
    >
      <div className="space-y-6">
        <p className="qt-text-small qt-text-muted italic">
          Now and again, before a character takes the floor, Aurora pauses by the workbench and sets the character&apos;s own plumb line into their hand &mdash; whatever they have filed in their vault under <code className="qt-bg-muted px-1 rounded">Core/</code>. It is an <em>offering</em>, not a reminder; it permits growth, and it does not override the scene.
        </p>

        {/* Master switch */}
        <div>
          <label className="qt-settings-toggle-row">
            <input
              type="checkbox"
              checked={current.enabled !== false}
              onChange={(e) => applyPatch({ enabled: e.target.checked })}
              disabled={saving}
              className="qt-checkbox mt-1"
            />
            <div className="flex-1">
              <div className="qt-settings-section-heading">Enable Aurora&apos;s Core whisper</div>
              <div className="qt-text-small mt-1">
                The master switch. When off, no Core whispers fire anywhere &mdash; regardless of per-chat or per-character overrides.
              </div>
            </div>
          </label>
        </div>

        {/* Interval */}
        <div className="qt-settings-field-group">
          <label className="block qt-settings-section-heading">
            Whisper Cadence
          </label>
          <p className="qt-text-small">
            How many of a character&apos;s own turns may pass between offerings. Lower is more attentive; higher is more spacious.
          </p>
          <select
            value={current.interval ?? 12}
            onChange={(e) => applyPatch({ interval: parseInt(e.target.value, 10) })}
            disabled={saving}
            className="qt-select max-w-xs"
          >
            {INTERVAL_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Every {n} turns{n === 12 ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Silence threshold */}
        <div className="qt-settings-field-group">
          <label className="block qt-settings-section-heading">
            Silence Threshold
          </label>
          <p className="qt-text-small">
            When a character has been quiet while this many <em>other</em> voices have taken the floor in turn, Aurora offers the packet before they re-enter. Useful in busier rooms where convergence pressure builds quickly.
          </p>
          <select
            value={current.silenceThreshold ?? 3}
            onChange={(e) => applyPatch({ silenceThreshold: parseInt(e.target.value, 10) })}
            disabled={saving}
            className="qt-select max-w-xs"
          >
            {SILENCE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                After {n} other-voice turn{n === 1 ? '' : 's'}{n === 3 ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Packet token budget */}
        <div className="qt-settings-field-group">
          <label className="block qt-settings-section-heading">
            Soft Packet Budget
          </label>
          <p className="qt-text-small">
            A hint, not a hard ceiling. When an assembled <code className="qt-bg-muted px-1 rounded">Core/</code> packet exceeds this size, the logs make a polite note suggesting the operator consider refactoring those documents. The packet is always delivered in full.
          </p>
          <select
            value={current.packetTokenBudget ?? 4096}
            onChange={(e) => applyPatch({ packetTokenBudget: parseInt(e.target.value, 10) })}
            disabled={saving}
            className="qt-select max-w-xs"
          >
            {BUDGET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Fire on context transition */}
        <div>
          <label className="qt-settings-toggle-row">
            <input
              type="checkbox"
              checked={current.fireOnContextTransition !== false}
              onChange={(e) => applyPatch({ fireOnContextTransition: e.target.checked })}
              disabled={saving}
              className="qt-checkbox mt-1"
            />
            <div className="flex-1">
              <div className="qt-settings-section-heading">Offer the packet after major context transitions</div>
              <div className="qt-text-small mt-1">
                When the Librarian folds the recent record into a rolling summary, Aurora offers the next-to-speak character their <code className="qt-bg-muted px-1 rounded">Core/</code> packet on the way back in. After memory has been folded, identity is the proper grounding.
              </div>
            </div>
          </label>
        </div>

        {/* Info box */}
        <div className="rounded-lg border qt-border-default qt-bg-muted/50 p-4 qt-text-small space-y-1">
          <p className="qt-settings-section-heading">A note on overrides</p>
          <p>
            Per-chat and per-character overrides are available on their respective settings panels. Resolution precedence is <strong>chat &rarr; character &rarr; global</strong> &mdash; an explicit value on a chat wins over an explicit value on a character, which in turn wins over these global defaults.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border qt-border-default p-3 qt-text-small text-destructive">
            {error}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
