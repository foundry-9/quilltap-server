'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

interface TrustedDevice {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export default function SecuritySettingsPage() {
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'complete'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [encryptedData, setEncryptedData] = useState<any>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Trusted devices state
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState('')

  // Load trusted devices on mount
  useEffect(() => {
    loadTrustedDevices()
  }, [])

  async function loadTrustedDevices() {
    setDevicesLoading(true)
    setDevicesError('')

    try {
      const res = await fetch('/api/auth/2fa/trusted-devices')
      if (res.ok) {
        const data = await res.json()
        setTrustedDevices(data.devices || [])
      } else {
        const data = await res.json()
        setDevicesError(data.error || 'Failed to load trusted devices')
      }
    } catch (err: any) {
      setDevicesError('Failed to load trusted devices')
    } finally {
      setDevicesLoading(false)
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    if (!confirm('Are you sure you want to revoke this device? You will need to enter a 2FA code when logging in from this device.')) {
      return
    }

    try {
      const res = await fetch(`/api/auth/2fa/trusted-devices?deviceId=${deviceId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setTrustedDevices(devices => devices.filter(d => d.id !== deviceId))
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to revoke device')
      }
    } catch (err) {
      alert('Failed to revoke device')
    }
  }

  async function handleRevokeAllDevices() {
    if (!confirm('Are you sure you want to revoke ALL trusted devices? You will need to enter a 2FA code when logging in from any device.')) {
      return
    }

    try {
      const res = await fetch('/api/auth/2fa/trusted-devices?all=true', {
        method: 'DELETE',
      })

      if (res.ok) {
        setTrustedDevices([])
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to revoke devices')
      }
    } catch (err) {
      alert('Failed to revoke devices')
    }
  }

  async function handleSetup2FA() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to setup 2FA')
      }

      const data = await res.json()
      setQrCode(data.qrCode)
      setSecret(data.secret)
      setEncryptedData(data.encrypted)
      setSetupStep('qr')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedSecret: encryptedData.secret,
          encryptedIv: encryptedData.iv,
          encryptedAuthTag: encryptedData.authTag,
          verificationCode
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enable 2FA')
      }

      const data = await res.json()
      setBackupCodes(data.backupCodes)
      setSetupStep('complete')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable2FA() {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return
    }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disable 2FA')
      }

      setSetupStep('idle')
      // Clear trusted devices as well since 2FA is disabled
      setTrustedDevices([])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6 dark:text-white">Security Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-6 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 dark:bg-slate-800">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Two-Factor Authentication</h2>

        {setupStep === 'idle' && (
          <div>
            <p className="text-gray-600 mb-4 dark:text-gray-300">
              Add an extra layer of security to your account by requiring a code from your
              authenticator app when signing in.
            </p>
            <button
              onClick={handleSetup2FA}
              disabled={loading}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Setting up...' : 'Enable 2FA'}
            </button>
          </div>
        )}

        {setupStep === 'qr' && (
          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-300">
              Scan this QR code with your authenticator app (1Password, Google Authenticator, Authy, etc.)
            </p>

            {qrCode && (
              <div className="flex justify-center">
                <Image src={qrCode} alt="2FA QR Code" width={200} height={200} />
              </div>
            )}

            <div>
              <p className="text-sm text-gray-600 mb-2 dark:text-gray-400">
                Or enter this code manually:
              </p>
              <code className="block bg-gray-100 p-2 rounded font-mono text-sm dark:bg-slate-700 dark:text-gray-200">
                {secret}
              </code>
            </div>

            <div>
              <label htmlFor="verificationCode" className="block text-sm font-medium mb-2 dark:text-gray-200">
                Enter the 6-digit code from your app:
              </label>
              <input
                id="verificationCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="block w-full rounded border-gray-300 shadow-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleVerify}
                disabled={loading || verificationCode.length !== 6}
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify and Enable'}
              </button>
              <button
                onClick={() => setSetupStep('idle')}
                disabled={loading}
                className="bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400 disabled:opacity-50 dark:bg-slate-600 dark:text-gray-200 dark:hover:bg-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {setupStep === 'complete' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded dark:bg-green-900/20 dark:border-green-900/50 dark:text-green-200">
              2FA has been enabled successfully!
            </div>

            <div>
              <p className="font-semibold mb-2 dark:text-white">Save these backup codes</p>
              <p className="text-sm text-gray-600 mb-4 dark:text-gray-400">
                If you lose access to your authenticator app, you can use these codes to sign in.
                Each code can only be used once. Store them in a safe place.
              </p>

              <div className="bg-gray-100 p-4 rounded dark:bg-slate-700">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm dark:text-gray-200">
                  {backupCodes.map((code, index) => (
                    <div key={index}>{code}</div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  const text = backupCodes.join('\n')
                  navigator.clipboard.writeText(text)
                  alert('Backup codes copied to clipboard')
                }}
                className="mt-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Copy backup codes
              </button>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Trusted Devices Section */}
      <div className="bg-white rounded-lg shadow p-6 mt-6 dark:bg-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold dark:text-white">Trusted Devices</h2>
          {trustedDevices.length > 0 && (
            <button
              onClick={handleRevokeAllDevices}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Revoke all
            </button>
          )}
        </div>

        <p className="text-gray-600 mb-4 dark:text-gray-300">
          Devices where you&apos;ve checked &quot;Remember this device&quot; won&apos;t require a 2FA code for 30 days.
        </p>

        {devicesLoading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading trusted devices...</p>
        ) : devicesError ? (
          <p className="text-red-600 dark:text-red-400">{devicesError}</p>
        ) : trustedDevices.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No trusted devices. Check &quot;Remember this device&quot; when logging in with 2FA to add one.</p>
        ) : (
          <div className="space-y-3">
            {trustedDevices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg dark:bg-slate-700"
              >
                <div>
                  <p className="font-medium dark:text-white">{device.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Added: {formatDate(device.createdAt)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Last used: {formatDate(device.lastUsedAt)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expires: {formatDate(device.expiresAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeDevice(device.id)}
                  className="text-red-600 hover:text-red-700 text-sm dark:text-red-400 dark:hover:text-red-300"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disable 2FA section (show if already enabled) */}
      <div className="bg-white rounded-lg shadow p-6 mt-6 dark:bg-slate-800">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Disable 2FA</h2>
        <p className="text-gray-600 mb-4 dark:text-gray-300">
          This will remove two-factor authentication from your account.
        </p>
        <button
          onClick={handleDisable2FA}
          disabled={loading}
          className="bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Disabling...' : 'Disable 2FA'}
        </button>
      </div>
    </div>
  )
}
