'use client'

import { useState, useEffect } from 'react'
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

  // Local state for the daily-token-budget input — typing 5 then 0 should not
  // race the autosave handler. We commit on blur.
  const [dailyTokenInput, setDailyTokenInput] = useState<string>(
    current.dailyTokenBudget != null ? String(current.dailyTokenBudget) : '',
  )
  const [freshnessHoursInput, setFreshnessHoursInput] = useState<string>(
    String(Math.round(current.defaultFreshnessWindowMs / (60 * 60 * 1000))),
  )

  useEffect(() => {
    setDailyTokenInput(current.dailyTokenBudget != null ? String(current.dailyTokenBudget) : '')
    setFreshnessHoursInput(String(Math.round(current.defaultFreshnessWindowMs / (60 * 60 * 1000))))
  }, [current.dailyTokenBudget, current.defaultFreshnessWindowMs])

  const commitDailyTokenBudget = async () => {
    const trimmed = dailyTokenInput.trim()
    if (trimmed === '') {
      await onUpdate({ dailyTokenBudget: null })
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDailyTokenInput(current.dailyTokenBudget != null ? String(current.dailyTokenBudget) : '')
      return
    }
    await onUpdate({ dailyTokenBudget: parsed })
  }

  const commitFreshnessHours = async () => {
    const parsed = Number.parseInt(freshnessHoursInput.trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFreshnessHoursInput(String(Math.round(current.defaultFreshnessWindowMs / (60 * 60 * 1000))))
      return
    }
    await onUpdate({ defaultFreshnessWindowMs: parsed * 60 * 60 * 1000 })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block">
          <span className="font-medium text-foreground">Daily token budget</span>
          <span className="block qt-text-small mt-1 mb-2">
            Caps the cumulative input + output tokens spent across every autonomous room you own,
            rolled over at instance-local midnight. Leave blank for no cap. Pilot value: 1,000,000.
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="(no cap)"
              className="qt-input w-48"
              value={dailyTokenInput}
              onChange={(e) => setDailyTokenInput(e.target.value)}
              onBlur={commitDailyTokenBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') commitDailyTokenBudget() }}
              disabled={saving}
            />
            <span className="qt-text-small">tokens / day</span>
          </div>
        </label>
      </div>

      <div>
        <label className="block">
          <span className="font-medium text-foreground">Default freshness window</span>
          <span className="block qt-text-small mt-1 mb-2">
            How long after a missed scheduled run the scheduler should still consider catching up,
            in hours. Per-room overrides are honored. Default: 12 hours.
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="qt-input w-24"
              value={freshnessHoursInput}
              onChange={(e) => setFreshnessHoursInput(e.target.value)}
              onBlur={commitFreshnessHours}
              onKeyDown={(e) => { if (e.key === 'Enter') commitFreshnessHours() }}
              disabled={saving}
            />
            <span className="qt-text-small">hours</span>
          </div>
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
            room regardless of per-room settings; <em>Opt in per room</em> honors a room's explicit
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
