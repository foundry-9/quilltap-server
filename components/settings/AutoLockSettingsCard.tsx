'use client'

import { useState, useEffect, useCallback } from 'react'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'AutoLockSettingsCard' })

interface AutoLockConfig {
  enabled: boolean
  idleMinutes: number
}

/**
 * AutoLockSettingsCard
 *
 * Settings UI for configuring the auto-lock idle timer.
 * Only functional when a user passphrase is set.
 */
export function AutoLockSettingsCard() {
  const [hasPassphrase, setHasPassphrase] = useState<boolean | null>(null)
  const [config, setConfig] = useState<AutoLockConfig>({ enabled: false, idleMinutes: 15 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      log.debug('Fetching auto-lock state...')

      // Check if user has a passphrase
      const unlockRes = await fetch('/api/v1/system/unlock')
      if (unlockRes.ok) {
        const unlockData = await unlockRes.json()
        setHasPassphrase(unlockData.hasUserPassphrase ?? false)
        log.debug('Passphrase state fetched', { hasPassphrase: unlockData.hasUserPassphrase })
      }

      // Fetch current auto-lock settings from chat settings
      const settingsRes = await fetch('/api/v1/settings/chat')
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        if (settingsData.autoLockSettings) {
          setConfig({
            enabled: settingsData.autoLockSettings.enabled ?? false,
            idleMinutes: settingsData.autoLockSettings.idleMinutes ?? 15,
          })
          log.debug('Auto-lock settings fetched', { config: settingsData.autoLockSettings })
        }
      }
    } catch (err) {
      log.debug('Error fetching auto-lock state', err instanceof Error ? err : undefined)
      // Non-critical — defaults are fine
    }
  }, [])

  useEffect(() => {
    fetchState()

    // Re-fetch when the passphrase changes (e.g., user sets or removes one)
    const handlePassphraseChanged = () => fetchState()
    window.addEventListener('quilltap-passphrase-changed', handlePassphraseChanged)
    return () => window.removeEventListener('quilltap-passphrase-changed', handlePassphraseChanged)
  }, [fetchState])

  const handleSave = async (newConfig: AutoLockConfig) => {
    setSaving(true)
    setError('')
    setSaved(false)

    try {
      log.debug('Saving auto-lock settings', { config: newConfig })

      const res = await fetch('/api/v1/settings/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoLockSettings: newConfig,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        log.warn('Failed to save auto-lock settings', { error: data.error })
        setError(data.error || 'Failed to save auto-lock settings')
        return
      }

      setConfig(newConfig)
      setSaved(true)
      log.info('Auto-lock settings saved successfully', { config: newConfig })
      setTimeout(() => setSaved(false), 2000)

      // Notify the AutoLockProvider to re-fetch settings
      window.dispatchEvent(new CustomEvent('quilltap-autolock-settings-changed'))
    } catch (err) {
      log.error('Error saving auto-lock settings', err instanceof Error ? err : undefined)
      setError('Failed to save auto-lock settings')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = (enabled: boolean) => {
    handleSave({ ...config, enabled })
  }

  const handleMinutesChange = (value: string) => {
    const minutes = parseInt(value, 10)
    if (!isNaN(minutes) && minutes >= 1) {
      setConfig(prev => ({ ...prev, idleMinutes: minutes }))
    }
  }

  const handleMinutesBlur = () => {
    if (config.idleMinutes >= 1) {
      handleSave(config)
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
          <label className="qt-text-small">Lock after</label>
          <input
            type="number"
            min={1}
            value={config.idleMinutes}
            onChange={(e) => handleMinutesChange(e.target.value)}
            onBlur={handleMinutesBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleMinutesBlur()}
            disabled={saving}
            className="qt-input w-20 p-1 text-center"
          />
          <span className="qt-text-small">minutes of inactivity</span>
        </div>
      )}

      {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
      {saved && <p className="qt-text-xs qt-text-success">Settings saved</p>}
    </div>
  )
}
