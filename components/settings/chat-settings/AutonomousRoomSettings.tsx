'use client'

import { useState } from 'react'
import type { AutonomousRoomSettings, ChatSettings } from './types'

const DEFAULTS: Required<Omit<AutonomousRoomSettings, 'dailyTokenBudget'>> & Pick<AutonomousRoomSettings, 'dailyTokenBudget'> = {
  dailyTokenBudget: null,
  defaultFreshnessWindowMs: 12 * 60 * 60 * 1000,
  visibilityDefault: 'owner_only',
  destructiveToolPolicy: 'opt_in_per_room',
}

export interface AutonomousRoomSettingsProps {
  settings: ChatSettings
  saving: boolean
  onUpdate: (next: Partial<AutonomousRoomSettings>) => Promise<void>
}

export function AutonomousRoomSettingsComponent({
  settings,
  saving,
  onUpdate,
}: AutonomousRoomSettingsProps) {
  const current: Required<Pick<AutonomousRoomSettings, 'defaultFreshnessWindowMs' | 'visibilityDefault' | 'destructiveToolPolicy'>> & { dailyTokenBudget: number | null } = {
    dailyTokenBudget: settings.autonomousRoomSettings?.dailyTokenBudget ?? null,
    defaultFreshnessWindowMs: settings.autonomousRoomSettings?.defaultFreshnessWindowMs ?? DEFAULTS.defaultFreshnessWindowMs,
    visibilityDefault: settings.autonomousRoomSettings?.visibilityDefault ?? DEFAULTS.visibilityDefault,
    destructiveToolPolicy: settings.autonomousRoomSettings?.destructiveToolPolicy ?? DEFAULTS.destructiveToolPolicy,
  }

  // Local state for the numeric inputs — typing 5 then 0 should not race the
  // autosave handler. We commit on blur. After a successful save, the form
  // re-renders with the new saved value; we key the inputs on that value so
  // they reset only when the persisted value genuinely changes.
  const savedDailyTokenKey = current.dailyTokenBudget != null ? String(current.dailyTokenBudget) : ''
  const savedFreshnessKey = String(Math.round(current.defaultFreshnessWindowMs / (60 * 60 * 1000)))

  return (
    <div className="space-y-4">
      <div>
        <label className="block">
          <span className="font-medium text-foreground">Daily token budget</span>
          <span className="block qt-text-small mt-1 mb-2">
            Caps the cumulative input + output tokens spent across every autonomous room you own,
            rolled over at instance-local midnight. Leave blank for no cap. Pilot value: 1,000,000.
          </span>
          <DailyTokenBudgetInput
            key={savedDailyTokenKey}
            initial={savedDailyTokenKey}
            saving={saving}
            onCommit={(parsed) => onUpdate({ dailyTokenBudget: parsed })}
          />
        </label>
      </div>

      <div>
        <label className="block">
          <span className="font-medium text-foreground">Default freshness window</span>
          <span className="block qt-text-small mt-1 mb-2">
            How long after a missed scheduled run the scheduler should still consider catching up,
            in hours. Per-room overrides are honored. Default: 12 hours.
          </span>
          <FreshnessHoursInput
            key={savedFreshnessKey}
            initial={savedFreshnessKey}
            saving={saving}
            onCommit={(hours) => onUpdate({ defaultFreshnessWindowMs: hours * 60 * 60 * 1000 })}
          />
        </label>
      </div>

      <div>
        <label className="block">
          <span className="font-medium text-foreground">Default visibility</span>
          <span className="block qt-text-small mt-1 mb-2">
            Where new autonomous rooms appear by default. Per-room overrides are honored at creation.
          </span>
          <select
            className="qt-input"
            value={current.visibilityDefault}
            onChange={(e) => onUpdate({ visibilityDefault: e.target.value as AutonomousRoomSettings['visibilityDefault'] })}
            disabled={saving}
          >
            <option value="owner_only">Owner only — hidden from the main Salon list</option>
            <option value="household">Household — visible per chat-sharing rules</option>
            <option value="open">Open — visible in the main Salon list</option>
          </select>
        </label>
      </div>

      <div>
        <label className="block">
          <span className="font-medium text-foreground">Destructive-tool policy</span>
          <span className="block qt-text-small mt-1 mb-2">
            Acts as a ceiling: <em>Always refuse</em> blocks destructive tools across every autonomous
            room regardless of per-room settings; <em>Opt in per room</em> honors a room&rsquo;s explicit
            pre-authorization.
          </span>
          <select
            className="qt-input"
            value={current.destructiveToolPolicy}
            onChange={(e) => onUpdate({ destructiveToolPolicy: e.target.value as AutonomousRoomSettings['destructiveToolPolicy'] })}
            disabled={saving}
          >
            <option value="always_refuse">Always refuse — destructive tools never available</option>
            <option value="opt_in_per_room">Opt in per room — honor per-room authorization</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function DailyTokenBudgetInput({
  initial,
  saving,
  onCommit,
}: {
  initial: string
  saving: boolean
  onCommit: (value: number | null) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  const commit = async () => {
    const trimmed = value.trim()
    if (trimmed === '') {
      await onCommit(null)
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValue(initial)
      return
    }
    await onCommit(parsed)
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="(no cap)"
        className="qt-input w-48"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
        disabled={saving}
      />
      <span className="qt-text-small">tokens / day</span>
    </div>
  )
}

function FreshnessHoursInput({
  initial,
  saving,
  onCommit,
}: {
  initial: string
  saving: boolean
  onCommit: (hours: number) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  const commit = async () => {
    const parsed = Number.parseInt(value.trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setValue(initial)
      return
    }
    await onCommit(parsed)
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="qt-input w-24"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
        disabled={saving}
      />
      <span className="qt-text-small">hours</span>
    </div>
  )
}
