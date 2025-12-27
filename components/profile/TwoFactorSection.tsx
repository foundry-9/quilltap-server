'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { EncryptedTOTPData } from './types'
import { clientLogger } from '@/lib/client-logger'

export interface TwoFactorSectionProps {
  totpEnabled: boolean
  onStatusChange: (enabled: boolean) => void
}

/**
 * Shield icon SVG
 */
function ShieldIcon({ className }: { className?: string }) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

/**
 * Shield check icon SVG
 */
function ShieldCheckIcon({ className }: { className?: string }) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

/**
 * TwoFactorSection Component
 *
 * Manages TOTP two-factor authentication:
 * - Enable/disable 2FA
 * - Setup flow with QR code
 * - Backup codes display
 * - Regenerate backup codes
 */
export function TwoFactorSection({
  totpEnabled,
  onStatusChange,
}: TwoFactorSectionProps) {
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'complete'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [encryptedData, setEncryptedData] = useState<EncryptedTOTPData | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [codesCopied, setCodesCopied] = useState(false)

  useEffect(() => {
    clientLogger.debug('TwoFactorSection mounted', { totpEnabled })
  }, [totpEnabled])

  // Reset step when enabled status changes externally
  useEffect(() => {
    if (totpEnabled && setupStep === 'complete') {
      // User already has 2FA enabled, show idle state
      setSetupStep('idle')
      setBackupCodes([])
    }
  }, [totpEnabled, setupStep])

  async function handleSetup2FA() {
    setError('')
    setLoading(true)
    clientLogger.debug('Starting 2FA setup')

    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
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
      clientLogger.info('2FA setup initiated, showing QR code')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to setup 2FA'
      setError(message)
      clientLogger.error('2FA setup failed', { error: message })
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    setError('')
    setLoading(true)
    clientLogger.debug('Verifying 2FA code', { codeLength: verificationCode.length })

    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedSecret: encryptedData?.secret,
          encryptedIv: encryptedData?.iv,
          encryptedAuthTag: encryptedData?.authTag,
          verificationCode,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enable 2FA')
      }

      const data = await res.json()
      setBackupCodes(data.backupCodes)
      setSetupStep('complete')
      onStatusChange(true)
      clientLogger.info('2FA enabled successfully')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to verify code'
      setError(message)
      clientLogger.error('2FA verification failed', { error: message })
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
    clientLogger.debug('Disabling 2FA')

    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disable 2FA')
      }

      setSetupStep('idle')
      setVerificationCode('')
      setQrCode('')
      setSecret('')
      setEncryptedData(null)
      setBackupCodes([])
      onStatusChange(false)
      clientLogger.info('2FA disabled successfully')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disable 2FA'
      setError(message)
      clientLogger.error('2FA disable failed', { error: message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateBackupCodes() {
    if (!confirm('Are you sure you want to regenerate backup codes? This will invalidate all existing backup codes.')) {
      return
    }

    setError('')
    setLoading(true)
    clientLogger.debug('Regenerating backup codes')

    try {
      const res = await fetch('/api/auth/2fa/regenerate-backup-codes', {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to regenerate backup codes')
      }

      const data = await res.json()
      setBackupCodes(data.backupCodes)
      setSetupStep('complete')
      clientLogger.info('Backup codes regenerated')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate backup codes'
      setError(message)
      clientLogger.error('Backup codes regeneration failed', { error: message })
    } finally {
      setLoading(false)
    }
  }

  function handleCopyBackupCodes() {
    const text = backupCodes.join('\n')
    navigator.clipboard.writeText(text)
    setCodesCopied(true)
    clientLogger.debug('Backup codes copied to clipboard')
    setTimeout(() => setCodesCopied(false), 2000)
  }

  function handleCancel() {
    setSetupStep('idle')
    setVerificationCode('')
    setQrCode('')
    setSecret('')
    setEncryptedData(null)
    setError('')
    clientLogger.debug('2FA setup cancelled')
  }

  function handleDone() {
    setSetupStep('idle')
    setBackupCodes([])
    setVerificationCode('')
  }

  return (
    <div className="qt-card">
      <div className="qt-card-header">
        <div className="flex items-center gap-3">
          {totpEnabled ? (
            <ShieldCheckIcon className="w-6 h-6 text-green-500" />
          ) : (
            <ShieldIcon className="w-6 h-6 text-muted-foreground" />
          )}
          <div>
            <h2 className="text-xl font-semibold">Two-Factor Authentication</h2>
            <p className="qt-text-muted text-sm mt-1">
              {totpEnabled
                ? 'Your account is protected with 2FA'
                : 'Add an extra layer of security to your account'}
            </p>
          </div>
        </div>
      </div>

      <div className="qt-card-content">
        {error && (
          <div className="qt-alert-error mb-4">
            {error}
          </div>
        )}

        {/* Idle state - not enabled */}
        {setupStep === 'idle' && !totpEnabled && (
          <div>
            <p className="qt-text-muted mb-4">
              Two-factor authentication adds an extra layer of security by requiring a code from
              your authenticator app when signing in.
            </p>
            <button
              onClick={handleSetup2FA}
              disabled={loading}
              className="qt-button qt-button-primary"
            >
              {loading ? 'Setting up...' : 'Enable 2FA'}
            </button>
          </div>
        )}

        {/* Idle state - already enabled */}
        {setupStep === 'idle' && totpEnabled && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/50">
              <ShieldCheckIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-green-800 dark:text-green-200">
                Two-factor authentication is enabled
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleRegenerateBackupCodes}
                disabled={loading}
                className="qt-button qt-button-secondary"
              >
                {loading ? 'Regenerating...' : 'Regenerate Backup Codes'}
              </button>
              <button
                onClick={handleDisable2FA}
                disabled={loading}
                className="qt-button qt-button-danger"
              >
                {loading ? 'Disabling...' : 'Disable 2FA'}
              </button>
            </div>
          </div>
        )}

        {/* QR code step */}
        {setupStep === 'qr' && (
          <div className="space-y-4">
            <p className="qt-text-muted">
              Scan this QR code with your authenticator app (1Password, Google Authenticator, Authy, etc.)
            </p>

            {qrCode && (
              <div className="flex justify-center py-4">
                <div className="p-4 bg-white rounded-lg">
                  <Image src={qrCode} alt="2FA QR Code" width={200} height={200} />
                </div>
              </div>
            )}

            <div>
              <p className="qt-text-xs text-muted-foreground mb-2">
                Or enter this code manually:
              </p>
              <code className="block p-3 rounded bg-muted font-mono text-sm break-all">
                {secret}
              </code>
            </div>

            <div>
              <label htmlFor="verification-code" className="qt-label block mb-2">
                Enter the 6-digit code from your app:
              </label>
              <input
                id="verification-code"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="qt-input w-full font-mono text-center text-lg tracking-widest"
                autoComplete="one-time-code"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleVerify}
                disabled={loading || verificationCode.length !== 6}
                className="qt-button qt-button-primary"
              >
                {loading ? 'Verifying...' : 'Verify and Enable'}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="qt-button qt-button-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Complete step - show backup codes */}
        {setupStep === 'complete' && backupCodes.length > 0 && (
          <div className="space-y-4">
            <div className="qt-alert-success">
              {totpEnabled ? 'New backup codes generated!' : '2FA has been enabled successfully!'}
            </div>

            <div>
              <p className="font-semibold mb-2">Save these backup codes</p>
              <p className="qt-text-muted text-sm mb-4">
                If you lose access to your authenticator app, you can use these codes to sign in.
                Each code can only be used once. Store them in a safe place.
              </p>

              <div className="p-4 rounded-lg bg-muted">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {backupCodes.map((code, index) => (
                    <div key={index} className="py-1">{code}</div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleCopyBackupCodes}
                className="qt-button qt-button-ghost text-sm mt-4"
              >
                {codesCopied ? 'Copied!' : 'Copy backup codes'}
              </button>
            </div>

            <button
              onClick={handleDone}
              className="qt-button qt-button-primary"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
