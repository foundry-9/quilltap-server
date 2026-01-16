'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrustedDevice } from './types'

export interface TrustedDevicesSectionProps {
  totpEnabled: boolean
}

/**
 * Monitor icon SVG
 */
function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

/**
 * Trash icon SVG
 */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

/**
 * Format a date string for display
 */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * TrustedDevicesSection Component
 *
 * Displays and manages trusted devices:
 * - List all trusted devices
 * - Remove individual devices
 * - Remove all devices
 */
export function TrustedDevicesSection({ totpEnabled }: TrustedDevicesSectionProps) {
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')


  const loadDevices = useCallback(async () => {
    if (!totpEnabled) {
      setDevices([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/v1/auth/2fa/trusted-devices')
      if (res.ok) {
        const data = await res.json()
        setDevices(data.devices || [])
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to load trusted devices')
        console.error('Failed to load trusted devices', { error: data.error })
      }
    } catch (err: unknown) {
      const message = 'Failed to load trusted devices'
      setError(message)
      console.error('Failed to load trusted devices', { error: err })
    } finally {
      setLoading(false)
    }
  }, [totpEnabled])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  async function handleRevokeDevice(deviceId: string) {
    if (!confirm('Are you sure you want to revoke this device? You will need to enter a 2FA code when logging in from this device.')) {
      return
    }

    try {
      const res = await fetch(`/api/v1/auth/2fa/trusted-devices?deviceId=${deviceId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId))
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to revoke device')
        console.error('Failed to revoke device', { error: data.error })
      }
    } catch (err) {
      alert('Failed to revoke device')
      console.error('Failed to revoke device', { error: err })
    }
  }

  async function handleRevokeAllDevices() {
    if (!confirm('Are you sure you want to revoke ALL trusted devices? You will need to enter a 2FA code when logging in from any device.')) {
      return
    }

    try {
      const res = await fetch('/api/v1/auth/2fa/trusted-devices?all=true', {
        method: 'DELETE',
      })

      if (res.ok) {
        setDevices([])
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to revoke devices')
        console.error('Failed to revoke all devices', { error: data.error })
      }
    } catch (err) {
      alert('Failed to revoke devices')
      console.error('Failed to revoke all devices', { error: err })
    }
  }

  // Don't show if 2FA is not enabled
  if (!totpEnabled) {
    return null
  }

  return (
    <div className="qt-card">
      <div className="qt-card-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MonitorIcon className="w-6 h-6 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">Trusted Devices</h2>
              <p className="qt-text-muted text-sm mt-1">
                Devices that don&apos;t require 2FA for 30 days
              </p>
            </div>
          </div>
          {devices.length > 0 && (
            <button
              onClick={handleRevokeAllDevices}
              className="qt-button qt-button-ghost text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Revoke all
            </button>
          )}
        </div>
      </div>

      <div className="qt-card-content">
        {loading ? (
          <p className="qt-text-muted">Loading trusted devices...</p>
        ) : error ? (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        ) : devices.length === 0 ? (
          <p className="qt-text-muted">
            No trusted devices. Check &quot;Remember this device&quot; when logging in with 2FA to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-4 rounded-lg bg-muted/50"
              >
                <div className="space-y-1">
                  <p className="font-medium">{device.name}</p>
                  <div className="space-y-0.5 qt-text-xs text-muted-foreground">
                    <p>Added: {formatDate(device.createdAt)}</p>
                    <p>Last used: {formatDate(device.lastUsedAt)}</p>
                    <p>Expires: {formatDate(device.expiresAt)}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeDevice(device.id)}
                  className="qt-button qt-button-ghost p-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  title="Revoke device"
                  aria-label={`Revoke ${device.name}`}
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
