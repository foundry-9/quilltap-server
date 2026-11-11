'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useChatSettingsMutation } from '@/hooks/useChatSettingsMutation'
import { useDraft } from '@/lib/hooks/use-draft'
import type { AutoLockSettings } from '@/components/settings/chat-settings/types'

const DEFAULT_AUTO_LOCK: AutoLockSettings = { enabled: false, idleMinutes: 15 }

/**
 * AutoLockSettingsCard
 *
 * Settings UI for configuring the auto-lock idle timer.
 * Only functional when a user passphrase is set.
 */
export function AutoLockSettingsCard() {
  const id = useId()
  const queryClient = useQueryClient()

  const { data: unlockData } = useQuery({
    queryKey: queryKeys.system.unlock,
    queryFn: ({ signal }) => apiFetch<{ hasUserPassphrase: boolean }>('/api/v1/system/unlock', { signal }),
  })
  const hasPassphrase = unlockData ? unlockData.hasUserPassphrase ?? false : null

  const { data: stored } = useChatSettingsQuery((settings) => settings.autoLockSettings)
  const config = useMemo<AutoLockSettings>(
    () => ({
      enabled: stored?.enabled ?? DEFAULT_AUTO_LOCK.enabled,
      idleMinutes: stored?.idleMinutes ?? DEFAULT_AUTO_LOCK.idleMinutes,
    }),
    [stored?.enabled, stored?.idleMinutes],
  )
  // The minutes field is typed into and saved on blur; a refetch while it is
  // being edited leaves it alone.
  const [minutesDraft, setMinutesDraft] = useDraft(String(config.idleMinutes))

  const [saved, setSaved] = useState(false)
  const { save, saving } = useChatSettingsMutation({
    onSaved: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Notify the AutoLockProvider to re-read its settings.
      window.dispatchEvent(new CustomEvent('quilltap-autolock-settings-changed'))
    },
  })

  useEffect(() => {
    // Setting or removing a passphrase changes whether this card applies.
    const handlePassphraseChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.unlock })
    }
    window.addEventListener('quilltap-passphrase-changed', handlePassphraseChanged)
    return () => window.removeEventListener('quilltap-passphrase-changed', handlePassphraseChanged)
  }, [queryClient])

  const handleSave = (next: AutoLockSettings) => {
    void save({ autoLockSettings: next }, { failure: 'Failed to save auto-lock settings' })
  }

  const handleToggle = (enabled: boolean) => {
    handleSave({ ...config, enabled })
  }

  const handleMinutesBlur = () => {
    const minutes = parseInt(minutesDraft, 10)
    if (!isNaN(minutes) && minutes >= 1) {
      if (minutes !== config.idleMinutes) handleSave({ ...config, idleMinutes: minutes })
    } else {
      // Not a usable number: put the stored value back rather than save it.
      setMinutesDraft(String(config.idleMinutes))
    }
  }

  if (hasPassphrase === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="qt-text-muted text-sm">Loading...</div>
      </div>
    )
  }

  if (!hasPassphrase) {
    return (
      <div className="space-y-3">
        <p className="qt-text-small qt-text-muted">
          Auto-lock requires a passphrase to be set. Without one, there is nothing to lock behind,
          rather like installing a deadbolt on a door that has no frame. Set a passphrase under
          &ldquo;Encryption Passphrase&rdquo; above, then return here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={saving}
          className="qt-checkbox"
        />
        <span className="qt-text-small">Automatically lock after idle period</span>
      </label>

      {config.enabled && (
        <div className="flex items-center gap-2">
          <label className="qt-text-small" htmlFor={`${id}-minutes`}>Lock after</label>
          <input
            id={`${id}-minutes`}
            type="number"
            min={1}
            value={minutesDraft}
            onChange={(e) => setMinutesDraft(e.target.value)}
            onBlur={handleMinutesBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleMinutesBlur()}
            disabled={saving}
            className="qt-input w-20 p-1 text-center"
          />
          <span className="qt-text-small">minutes of inactivity</span>
        </div>
      )}

      {saved && <p className="qt-text-xs qt-text-success">Settings saved</p>}
    </div>
  )
}
