'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'

/**
 * Props for MemoryCreationDialog
 */
interface MemoryCreationDialogProps {
  chat: {
    id: string
    title: string
    participants: Array<{
      type: 'CHARACTER' | 'PERSONA'
      characterId?: string | null
      personaId?: string | null
      connectionProfileId?: string | null
      character?: { id: string; name: string } | null
      persona?: { id: string; name: string } | null
    }>
    messages: Array<{
      id: string
      role: string
      content: string
      rawResponse?: { speakerName?: string } | null
    }>
    createdEntities?: {
      characters: Array<{ id: string; name: string }>
      personas: Array<{ id: string; name: string }>
    }
    memoryJobCount?: number
  }
  onClose: () => void
}

/**
 * Dialog for creating memories from an imported chat
 *
 * Queues background jobs to analyze each message pair for memories,
 * using the same process as live chats.
 */
export function MemoryCreationDialog({ chat, onClose }: MemoryCreationDialogProps) {
  const [creating, setCreating] = useState(false)

  // Get the first character for analysis
  const firstCharacter = useMemo(() => {
    const participant = chat.participants.find(p => p.type === 'CHARACTER' && p.character)
    if (participant?.character && participant.connectionProfileId) {
      return {
        id: participant.character.id,
        name: participant.character.name,
        connectionProfileId: participant.connectionProfileId,
      }
    }
    return null
  }, [chat.participants])

  // Count message pairs for analysis
  const messagePairCount = useMemo(() => {
    let count = 0
    const messages = chat.messages.filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'USER' && messages[i + 1].role === 'ASSISTANT') {
        count++
      }
    }
    return count
  }, [chat.messages])

  /**
   * Queue memory analysis jobs
   */
  const handleAnalyzeMessages = useCallback(async () => {
    if (!firstCharacter) {
      showErrorToast('No character found with a connection profile')
      return
    }

    setCreating(true)

    try {
      // Build message pairs
      const messages = chat.messages.filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
      const messagePairs: Array<{
        userMessageId: string
        assistantMessageId: string
        userContent: string
        assistantContent: string
      }> = []

      for (let i = 0; i < messages.length - 1; i++) {
        if (messages[i].role === 'USER' && messages[i + 1].role === 'ASSISTANT') {
          messagePairs.push({
            userMessageId: messages[i].id,
            assistantMessageId: messages[i + 1].id,
            userContent: messages[i].content,
            assistantContent: messages[i + 1].content,
          })
        }
      }

      if (messagePairs.length === 0) {
        showInfoToast('No message pairs found to analyze')
        onClose()
        return
      }

      // Queue the jobs via the chat-specific endpoint
      const response = await fetch(`/api/chats/${chat.id}/queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: firstCharacter.id,
          characterName: firstCharacter.name,
          connectionProfileId: firstCharacter.connectionProfileId,
          messagePairs,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to queue memory analysis jobs')
      }

      const result = await response.json()
      showSuccessToast(`Queued ${result.jobCount || messagePairs.length} messages for memory analysis`)

      clientLogger.info('Queued memory analysis', {
        chatId: chat.id,
        characterId: firstCharacter.id,
        pairCount: messagePairs.length,
      })

      onClose()
    } catch (err) {
      clientLogger.error('Failed to queue memory analysis', {
        chatId: chat.id,
        error: err instanceof Error ? err.message : String(err),
      })
      showErrorToast('Failed to queue memory analysis')
    } finally {
      setCreating(false)
    }
  }, [chat.id, chat.messages, firstCharacter, onClose])

  // If memories were already queued during import, show status
  if (chat.memoryJobCount && chat.memoryJobCount > 0) {
    return (
      <div className="qt-dialog-overlay !z-[60] p-4">
        <div className="qt-dialog max-w-md">
          <div className="qt-dialog-header">
            <h3 className="qt-dialog-title">
              Memory Analysis Queued
            </h3>
          </div>

          <div className="qt-dialog-body">
            <p className="text-muted-foreground">
              {chat.memoryJobCount} message{chat.memoryJobCount === 1 ? '' : 's'} queued for memory analysis.
              Memories will be created in the background as each message is processed.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              You can check the status in the background jobs section.
            </p>
          </div>

          <div className="qt-dialog-footer">
            <button
              type="button"
              onClick={onClose}
              className="qt-button qt-button-primary"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-dialog-overlay !z-[60] p-4">
      <div className="qt-dialog max-w-lg">
        <div className="qt-dialog-header">
          <h3 className="qt-dialog-title">
            Analyze Messages for Memories
          </h3>
          <p className="qt-dialog-description">
            Queue message analysis to extract meaningful memories from this conversation.
          </p>
        </div>

        <div className="qt-dialog-body">
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              This will analyze each message exchange using AI to extract meaningful memories,
              just like live chats. The analysis runs in the background.
            </p>
            {firstCharacter ? (
              <p className="text-sm mt-2">
                <strong>{messagePairCount}</strong> message pair{messagePairCount === 1 ? '' : 's'} will be analyzed for <strong>{firstCharacter.name}</strong>.
              </p>
            ) : (
              <p className="text-sm text-destructive mt-2">
                No character with a connection profile found. Cannot analyze messages.
              </p>
            )}
          </div>
        </div>

        <div className="qt-dialog-footer">
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
            disabled={creating || !firstCharacter || messagePairCount === 0}
            className="qt-button qt-button-primary"
          >
            {creating ? (
              <>
                <span className="animate-spin inline-block mr-2">&#8987;</span>
                Queueing...
              </>
            ) : (
              `Analyze ${messagePairCount} Message${messagePairCount === 1 ? '' : 's'}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
