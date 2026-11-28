'use client'

import { useState, useCallback, useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'

/** The imported chat the dialog analyses: the fields it reads. */
export interface MemoryCreationChat {
  id: string
  title: string
  participants: Array<{
    type: 'CHARACTER'
    characterId?: string | null
    connectionProfileId?: string | null
    character?: { id: string; name: string } | null
  }>
  messages: Array<{
    id: string
    role: string
    content: string
    rawResponse?: { speakerName?: string } | null
  }>
}

/**
 * Props for MemoryCreationDialog
 */
interface MemoryCreationDialogProps {
  chat: MemoryCreationChat
  onClose: () => void
}

/**
 * Dialog for creating memories from an imported chat
 *
 * Queues the chat's `queue-memories` action: one background extraction job per
 * turn of the whole chat, covering every character who spoke, using the same
 * process as live chats. The action takes no character and resolves its own
 * connection profile, so the dialog names none (#330).
 */
export function MemoryCreationDialog({ chat, onClose }: MemoryCreationDialogProps) {
  const [creating, setCreating] = useState(false)

  // Every character seated in the chat — the analysis covers them all.
  const characterNames = useMemo(() => {
    const names = chat.participants
      .map(p => (p.type === 'CHARACTER' ? p.character?.name?.trim() : undefined))
      .filter((n): n is string => !!n)
    return Array.from(new Set(names))
  }, [chat.participants])

  // Turns, as the server counts them (`listExtractionTurns`): one per USER
  // message, plus a greeting-only turn when a reply comes before the first.
  const turnCount = useMemo(() => {
    const spoken = chat.messages.filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
    const openers = spoken.filter(m => m.role === 'USER').length
    const firstOpener = spoken.findIndex(m => m.role === 'USER')
    const greeting = (firstOpener === -1 ? spoken : spoken.slice(0, firstOpener)).some(m => m.role === 'ASSISTANT')
    return openers + (greeting ? 1 : 0)
  }, [chat.messages])

  /**
   * Queue memory analysis jobs
   */
  const handleAnalyzeMessages = useCallback(async () => {
    setCreating(true)

    try {
      if (turnCount === 0) {
        showInfoToast('No turns found to analyze')
        onClose()
        return
      }

      // The chat's queue-memories action (#178: there is no /queue-memories
      // path segment). It queues one extraction job per turn of the whole
      // chat, every character that spoke, so it takes no body.
      const response = await fetch(`/api/v1/chats/${chat.id}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(errorBody?.error || 'Failed to queue memory analysis jobs')
      }

      const result = await response.json()
      const queued: number = result.jobCount ?? turnCount
      showSuccessToast(`Queued ${queued} turn${queued === 1 ? '' : 's'} for memory analysis`)

      onClose()
    } catch (err) {
      console.error('Failed to queue memory analysis', {
        chatId: chat.id,
        error: err instanceof Error ? err.message : String(err),
      })
      showErrorToast(err instanceof Error && err.message ? err.message : 'Failed to queue memory analysis')
    } finally {
      setCreating(false)
    }
  }, [chat.id, turnCount, onClose])

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Analyze Messages for Memories"
      subtitle="Queue message analysis to extract meaningful memories from this conversation."
      busy={creating}
      maxWidth="lg"
      bodyClassName="qt-dialog-body-default"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="qt-button qt-button-secondary"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleAnalyzeMessages}
            disabled={creating || turnCount === 0}
            className="qt-button qt-button-primary"
          >
            {creating ? (
              <>
                <span className="animate-spin inline-block mr-2">&#8987;</span>
                Queueing...
              </>
            ) : (
              `Analyze ${turnCount} Turn${turnCount === 1 ? '' : 's'}`
            )}
          </button>
        </>
      }
    >
      <div className="qt-bg-muted/50 rounded-lg p-4">
        <p className="qt-text-small">
          This will analyze each message exchange using AI to extract meaningful memories,
          just like live chats. The analysis runs in the background.
        </p>
        {turnCount > 0 ? (
          <p className="qt-text-small mt-2">
            <strong>{turnCount}</strong> turn{turnCount === 1 ? '' : 's'} will be analyzed for every character in the chat
            {characterNames.length > 0 ? <> ({characterNames.join(', ')})</> : null}.
          </p>
        ) : (
          <p className="qt-text-small mt-2">
            There are no turns in this chat to analyze.
          </p>
        )}
      </div>
    </BaseModal>
  )
}
