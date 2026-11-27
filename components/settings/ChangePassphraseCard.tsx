'use client'

import { useState, useCallback, useId } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

type Status = 'idle' | 'submitting' | 'success' | 'error'

interface ArchiveReencryptSummary {
  total: number
  reencrypted: number
  failures: Array<{ fileId: string; filename: string; reason: string }>
}

interface ChangePassphraseResponse {
  success?: boolean
  error?: string
  message?: string
  archives?: ArchiveReencryptSummary
}

export function ChangePassphraseCard() {
  const id = useId()
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  // The count the last change reported, which outranks the listing's.
  const [reportedArchiveCount, setReportedArchiveCount] = useState<number | null>(null)
  const [archiveSummary, setArchiveSummary] = useState<ArchiveReencryptSummary | null>(null)

  const mismatch = newPassphrase.length > 0 && confirmPassphrase.length > 0 && newPassphrase !== confirmPassphrase
  const isValid = !mismatch && (newPassphrase === confirmPassphrase) && status !== 'submitting'

  // Character archive bundles are encrypted under the passphrase, so changing
  // it rewrites each one. Tell the operator how many, up front. The count is a
  // courtesy (a failed read shows nothing); the change reports the real numbers.
  const { data: listedArchiveCount = null } = useQuery({
    queryKey: queryKeys.files.list({ category: 'ARCHIVE' }),
    queryFn: ({ signal }) => apiFetch<{ files?: unknown[] }>('/api/v1/files?category=ARCHIVE', { signal }),
    select: (data) => (data.files ? data.files.length : null),
    retry: false,
  })
  const archiveCount = reportedArchiveCount ?? listedArchiveCount

  const changeMutation = useMutation({
    mutationFn: (body: { oldPassphrase: string; newPassphrase: string }) =>
      apiFetch<ChangePassphraseResponse>('/api/v1/system/unlock?action=change-passphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })
  const { mutateAsync: changeAsync } = changeMutation

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
    setArchiveSummary(null)

    try {
      const data = await changeAsync({
        oldPassphrase: currentPassphrase,
        newPassphrase,
      })

      if (!data.success) {
        setStatus('error')
        setErrorMessage(data.error || data.message || 'Failed to change passphrase')
        return
      }

      setStatus('success')
      if (data.archives) {
        setArchiveSummary(data.archives)
        if (data.archives.total >= 0) setReportedArchiveCount(data.archives.total)
      }
      resetForm()

      // Notify other components (e.g., AutoLockSettingsCard) that passphrase state changed
      window.dispatchEvent(new CustomEvent('quilltap-passphrase-changed'))
    } catch (err) {
      setStatus('error')
      setErrorMessage(apiErrorMessage(err, 'Failed to change passphrase'))
    }
  }, [isValid, currentPassphrase, newPassphrase, resetForm, changeAsync])

  const archiveFailures = archiveSummary?.failures ?? []

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Change the passphrase that protects your encryption key file. This does not
        re-encrypt your database — it only re-wraps the key with a new passphrase.
        Leave the new passphrase empty to remove passphrase protection entirely.
      </p>

      {archiveCount !== null && archiveCount > 0 && (
        <p className="qt-text-small qt-text-muted">
          {archiveCount === 1
            ? 'Your 1 archived-character bundle is sealed under this passphrase and will be rewritten to open with the new one.'
            : `Your ${archiveCount} archived-character bundles are sealed under this passphrase and will each be rewritten to open with the new one.`}{' '}
          This cannot be interrupted halfway without leaving some archives on the old
          passphrase; if that happens, the ones left behind are named below.
        </p>
      )}

      <div>
        <label htmlFor={`${id}-current`} className="block qt-text-label mb-2">
          Current Passphrase
        </label>
        <input
          type="password"
          id={`${id}-current`}
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
        <label htmlFor={`${id}-new`} className="block qt-text-label mb-2">
          New Passphrase
        </label>
        <input
          type="password"
          id={`${id}-new`}
          value={newPassphrase}
          onChange={(e) => { setNewPassphrase(e.target.value); setStatus('idle') }}
          placeholder="Enter new passphrase (or leave empty to remove)"
          className="qt-input"
          autoComplete="new-password"
        />
      </div>

      <div>
        <label htmlFor={`${id}-confirm`} className="block qt-text-label mb-2">
          Confirm New Passphrase
        </label>
        <input
          type="password"
          id={`${id}-confirm`}
          value={confirmPassphrase}
          onChange={(e) => { setConfirmPassphrase(e.target.value); setStatus('idle') }}
          placeholder="Confirm new passphrase"
          className="qt-input"
          autoComplete="new-password"
        />
        {mismatch && (
          <p className="qt-text-xs mt-1 qt-text-destructive">Passphrases do not match</p>
        )}
      </div>

      {status === 'error' && errorMessage && (
        <div className="qt-alert-error">{errorMessage}</div>
      )}

      {status === 'success' && (
        <div className="qt-alert-success">
          Passphrase changed successfully. The new passphrase will be required on the next restart.
          {archiveSummary && archiveSummary.reencrypted > 0 && archiveFailures.length === 0 && (
            <> {archiveSummary.reencrypted === 1
              ? 'Your archived-character bundle was rewritten under the new passphrase.'
              : `All ${archiveSummary.reencrypted} archived-character bundles were rewritten under the new passphrase.`}</>
          )}
        </div>
      )}

      {status === 'success' && archiveFailures.length > 0 && (
        <div className="qt-alert-error">
          <p>
            {archiveFailures.length === 1
              ? 'One archived-character bundle could not be rewritten and still expects the old passphrase:'
              : `${archiveFailures.length} archived-character bundles could not be rewritten and still expect the old passphrase:`}
          </p>
          <ul className="mt-1 list-disc list-inside">
            {archiveFailures.map((f) => (
              <li key={f.fileId || f.filename} className="qt-text-small">
                {f.filename} — {f.reason}
              </li>
            ))}
          </ul>
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
