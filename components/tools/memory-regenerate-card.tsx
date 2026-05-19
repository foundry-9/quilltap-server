'use client'

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

interface RegenerateStatus {
  inFlightFanOut: number
  inFlightWipes: number
  inFlightExtractions: number
  inFlight: number
}

const POLL_INTERVAL_MS = 5000

export function MemoryRegenerateCard() {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<RegenerateStatus | null>(null)
  const [concurrency, setConcurrency] = useState<number>(1)
  const [concurrencyDraft, setConcurrencyDraft] = useState<string>('1')
  const [savingConcurrency, setSavingConcurrency] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [statusRes, concurrencyRes] = await Promise.all([
          fetch('/api/v1/memories?action=regenerate-all'),
          fetch('/api/v1/memories?action=extraction-concurrency'),
        ])
        if (!cancelled && statusRes.ok) {
          const data = await statusRes.json()
          setStatus({
            inFlightFanOut: data.inFlightFanOut ?? 0,
            inFlightWipes: data.inFlightWipes ?? 0,
            inFlightExtractions: data.inFlightExtractions ?? 0,
            inFlight: data.inFlight ?? 0,
          })
        }
        if (!cancelled && concurrencyRes.ok) {
          const data = await concurrencyRes.json()
          const value = Math.max(1, Math.min(32, Number(data.concurrency) || 1))
          setConcurrency(value)
          setConcurrencyDraft(String(value))
        }
      } catch {
        // Initial load failures aren't fatal — UI still works without status.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Poll status while a sweep is in flight so the user sees it drain.
  useEffect(() => {
    if (!status || status.inFlight === 0) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/memories?action=regenerate-all')
        if (res.ok) {
          const data = await res.json()
          setStatus({
            inFlightFanOut: data.inFlightFanOut ?? 0,
            inFlightWipes: data.inFlightWipes ?? 0,
            inFlightExtractions: data.inFlightExtractions ?? 0,
            inFlight: data.inFlight ?? 0,
          })
        }
      } catch {
        // Polling errors are non-fatal.
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [status])

  const handleConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/memories?action=regenerate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start regeneration')
      }
      const data = await res.json()
      showSuccessToast(data.message || 'Regeneration enqueued — chats will rebuild in the background')
      notifyQueueChange()
      // Refresh status so the badge in this card lights up immediately.
      try {
        const statusRes = await fetch('/api/v1/memories?action=regenerate-all')
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          setStatus({
            inFlightFanOut: statusData.inFlightFanOut ?? 0,
            inFlightWipes: statusData.inFlightWipes ?? 0,
            inFlightExtractions: statusData.inFlightExtractions ?? 0,
            inFlight: statusData.inFlight ?? 0,
          })
        }
      } catch {
        // Non-fatal.
      }
      setConfirming(false)
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to start regeneration')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const saveConcurrency = async (value: number) => {
    setSavingConcurrency(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/memories?action=extraction-concurrency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save concurrency')
      }
      setConcurrency(value)
      setConcurrencyDraft(String(value))
      showSuccessToast(`Memory extraction concurrency set to ${value}`)
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save concurrency')
      setError(msg)
      showErrorToast(msg)
      setConcurrencyDraft(String(concurrency))
    } finally {
      setSavingConcurrency(false)
    }
  }

  const handleConcurrencyBlur = () => {
    const parsed = Math.floor(Number(concurrencyDraft))
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 32) {
      setError('Concurrency must be a whole number between 1 and 32')
      setConcurrencyDraft(String(concurrency))
      return
    }
    if (parsed === concurrency) return
    void saveConcurrency(parsed)
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Wipes every memory linked to a conversation and re-runs the current extraction pipeline against the chat
        history. Manual memories that aren&rsquo;t tied to a chat are left alone. Memories whose chat has already
        been deleted are removed too. The work runs in the background; close this tab and come back whenever.
      </p>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="qt-text-small qt-text-muted" htmlFor="memoryExtractionConcurrency">
            Memory extraction concurrency
          </label>
          <div className="flex items-center gap-2">
            <input
              id="memoryExtractionConcurrency"
              type="number"
              min={1}
              max={32}
              step={1}
              value={concurrencyDraft}
              disabled={savingConcurrency}
              onChange={(e) => setConcurrencyDraft(e.target.value)}
              onBlur={handleConcurrencyBlur}
              className="qt-input w-20"
            />
            <span className="qt-text-small qt-text-muted">jobs in parallel (1–32)</span>
          </div>
        </div>
      </div>
      <p className="qt-text-small qt-text-muted">
        Higher values finish a sweep faster but spawn more simultaneous LLM calls. Cloud providers (OpenAI,
        Anthropic, Z.AI) typically tolerate 8–16 happily; local Ollama prefers 2–4. The 32 ceiling matches the
        upper bound of the <code>memory-diff</code> CLI&rsquo;s <code>--concurrency</code> flag.
      </p>

      {status && status.inFlight > 0 && (
        <p className="qt-text-small qt-text-muted">
          In flight:{' '}
          {status.inFlightFanOut > 0 && (
            <>
              {status.inFlightFanOut} fan-out{status.inFlightFanOut === 1 ? '' : 's'} (building chat list),{' '}
            </>
          )}
          {status.inFlightWipes} chat wipe{status.inFlightWipes === 1 ? '' : 's'},{' '}
          {status.inFlightExtractions} extraction{status.inFlightExtractions === 1 ? '' : 's'}.
        </p>
      )}

      {!confirming ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="qt-button qt-button-danger"
            disabled={submitting}
            onClick={() => setConfirming(true)}
          >
            Delete and regenerate all memories
          </button>
          <span className="qt-text-small qt-text-muted">Affects every chat-linked memory across all characters.</span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="qt-text-body">
            This will delete and rebuild every chat-linked memory. Continue?
          </span>
          <button
            type="button"
            className="qt-button qt-button-danger"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? 'Enqueuing…' : 'Yes, regenerate'}
          </button>
          <button
            type="button"
            className="qt-button qt-button-secondary"
            disabled={submitting}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="qt-text-small qt-text-error">{error}</p>}
    </div>
  )
}
