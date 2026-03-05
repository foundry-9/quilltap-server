'use client'

import { useState, useCallback } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function ChangePassphraseCard() {
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const mismatch = newPassphrase.length > 0 && confirmPassphrase.length > 0 && newPassphrase !== confirmPassphrase
  const isValid = !mismatch && (newPassphrase === confirmPassphrase) && status !== 'submitting'

  const resetForm = useCallback(() => {
    setCurrentPassphrase('')
    setNewPassphrase('')
    setConfirmPassphrase('')
    setErrorMessage('')
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    setStatus('submitting')
    setErrorMessage('')

    try {
      const res = await fetch('/api/v1/system/unlock?action=change-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassphrase: currentPassphrase,
          newPassphrase,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setStatus('error')
        setErrorMessage(data.error || data.message || 'Failed to change passphrase')
        return
      }

      setStatus('success')
      resetForm()
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred')
    }
  }, [isValid, currentPassphrase, newPassphrase, resetForm])

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Change the passphrase that protects your encryption key file. This does not
        re-encrypt your database — it only re-wraps the key with a new passphrase.
        Leave the new passphrase empty to remove passphrase protection entirely.
      </p>

      <div>
        <label htmlFor="cp-current" className="block qt-text-label mb-2">
          Current Passphrase
        </label>
        <input
          type="password"
          id="cp-current"
          value={currentPassphrase}
          onChange={(e) => { setCurrentPassphrase(e.target.value); setStatus('idle') }}
          placeholder="Leave empty if no passphrase is set"
          className="qt-input"
          autoComplete="current-password"
        />
        <p className="qt-text-xs mt-1 qt-text-muted">
          If you have not previously set a passphrase, leave this field empty.
        </p>
      </div>

      <div>
        <label htmlFor="cp-new" className="block qt-text-label mb-2">
          New Passphrase
        </label>
        <input
          type="password"
          id="cp-new"
          value={newPassphrase}
          onChange={(e) => { setNewPassphrase(e.target.value); setStatus('idle') }}
          placeholder="Enter new passphrase (or leave empty to remove)"
          className="qt-input"
          autoComplete="new-password"
        />
      </div>

      <div>
        <label htmlFor="cp-confirm" className="block qt-text-label mb-2">
          Confirm New Passphrase
        </label>
        <input
          type="password"
          id="cp-confirm"
          value={confirmPassphrase}
          onChange={(e) => { setConfirmPassphrase(e.target.value); setStatus('idle') }}
          placeholder="Confirm new passphrase"
          className="qt-input"
          autoComplete="new-password"
        />
        {mismatch && (
          <p className="qt-text-xs mt-1 qt-text-error">Passphrases do not match</p>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <div className="qt-alert-error">{errorMessage}</div>
      )}

      {status === 'success' && (
        <div className="qt-alert-success">
          Passphrase changed successfully. The new passphrase will be required on the next restart.
        </div>
      )}

      <button
        type="submit"
        disabled={!isValid || mismatch}
        className="qt-button-primary"
      >
        {status === 'submitting' ? 'Changing...' : 'Change Passphrase'}
      </button>
    </form>
  )
}

export default ChangePassphraseCard
