'use client'

import { useCallback, useState } from 'react'
import { formatBytes } from '@/lib/utils/format-bytes'
import type { Message } from '../types'

interface CourierBubbleProps {
  chatId: string
  message: Message
  characterName: string
  onResolved?: (messageId: string) => void
  onCancelled?: (messageId: string) => void
}

export function CourierBubble({ chatId, message, characterName, onResolved, onCancelled }: CourierBubbleProps) {
  const deltaPrompt = message.pendingExternalPrompt || ''
  const fullPrompt = message.pendingExternalPromptFull || null
  const hasFullFallback = !!fullPrompt
  const [showFull, setShowFull] = useState(false)
  const prompt = showFull && fullPrompt ? fullPrompt : deltaPrompt
  const attachments = message.pendingExternalAttachments || []
  const [reply, setReply] = useState('')
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError(`Couldn't reach the clipboard: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [prompt])

  const handleSubmit = useCallback(async () => {
    const trimmed = reply.trim()
    if (!trimmed) {
      setError('Paste the reply from your LLM before submitting.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/v1/chats/${chatId}/messages/${message.id}?action=resolve-external-turn`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replyContent: trimmed }),
        },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Server returned ${res.status}`)
      }
      onResolved?.(message.id)
    } catch (err) {
      setError(`Couldn't dispatch the reply: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }, [chatId, message.id, reply, onResolved])

  const handleCancel = useCallback(async () => {
    setError(null)
    setCancelling(true)
    try {
      const res = await fetch(
        `/api/v1/chats/${chatId}/messages/${message.id}?action=cancel-external-turn`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Server returned ${res.status}`)
      }
      onCancelled?.(message.id)
    } catch (err) {
      setError(`Couldn't cancel the turn: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCancelling(false)
    }
  }, [chatId, message.id, onCancelled])

  return (
    <div className="qt-courier-bubble">
      <div className="qt-courier-bubble-header">
        <span className="qt-courier-bubble-title">
          ✉ {characterName} — awaiting carrier
          {hasFullFallback && (
            <span className="qt-courier-bubble-mode-badge">
              {showFull ? 'full context' : 'delta'}
            </span>
          )}
        </span>
        <span className="qt-courier-bubble-hint">
          {hasFullFallback && !showFull
            ? 'Showing only what is new since the last reply. If your LLM client has lost the earlier conversation, switch to full context below.'
            : 'Copy the bundle below, paste it into your LLM, then paste the reply back here.'}
        </span>
      </div>

      <div className="qt-courier-bubble-prompt">
        <div className="qt-courier-bubble-prompt-toolbar">
          {hasFullFallback && (
            <button
              type="button"
              onClick={() => {
                setShowFull((prev) => !prev)
                setCopied(false)
              }}
              className="qt-button qt-button-secondary qt-button-sm"
              title={showFull ? 'Back to the delta-only bundle' : 'Show the full-context bundle instead'}
            >
              {showFull ? '↩ Use delta' : '↧ Use full context'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={`qt-button qt-button-sm ${copied ? 'qt-button-success' : 'qt-button-primary'}`}
            title="Copy the prompt to your clipboard"
          >
            {copied ? '✓ Copied' : '📋 Copy prompt'}
          </button>
        </div>
        <pre className="qt-courier-bubble-prompt-body">{prompt}</pre>
      </div>

      {attachments.length > 0 && (
        <div className="qt-courier-bubble-attachments">
          <div className="qt-courier-bubble-attachments-label">
            Referenced attachments — download and re-upload in your destination client:
          </div>
          <ul className="qt-courier-bubble-attachments-list">
            {attachments.map((a) => (
              <li key={a.fileId}>
                <a href={a.downloadUrl} download={a.filename} className="qt-link">
                  {a.filename}
                </a>
                <span className="qt-courier-bubble-attachment-meta">
                  {a.mimeType}, {formatBytes(a.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="qt-courier-bubble-paste">
        <label className="qt-courier-bubble-paste-label" htmlFor={`courier-paste-${message.id}`}>
          Paste the reply from your LLM:
        </label>
        <textarea
          id={`courier-paste-${message.id}`}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          className="qt-textarea qt-courier-bubble-textarea"
          rows={8}
          placeholder={`${characterName}'s response, exactly as your LLM returned it…`}
          disabled={submitting || cancelling}
        />
      </div>

      {error && <div className="qt-courier-bubble-error">{error}</div>}

      <div className="qt-courier-bubble-actions">
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting || cancelling}
          className="qt-button qt-button-secondary qt-button-sm"
        >
          {cancelling ? 'Cancelling…' : 'Cancel turn'}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || cancelling || reply.trim().length === 0}
          className="qt-button qt-button-primary qt-button-sm"
        >
          {submitting ? 'Submitting…' : 'Submit reply'}
        </button>
      </div>
    </div>
  )
}
