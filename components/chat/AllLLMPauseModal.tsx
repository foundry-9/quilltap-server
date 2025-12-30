'use client'

/**
 * AllLLMPauseModal Component
 * Characters Not Personas - Phase 4
 *
 * Modal that appears when all participants in a chat are LLM-controlled
 * and a pause threshold is reached (3, 6, 12, 24... turns).
 * Gives the user options to continue, stop, or take over a character.
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { BaseModal } from '@/components/ui/BaseModal'
import Avatar from '@/components/ui/Avatar'

export interface LLMParticipant {
  id: string
  characterId: string
  characterName: string
  character?: {
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
    avatarUrl?: string | null
  } | null
}

interface AllLLMPauseModalProps {
  isOpen: boolean
  onClose: () => void
  turnCount: number
  nextPauseAt: number
  participants: LLMParticipant[]
  onContinue: (turnsToAdd: number) => void
  onStop: () => void
  onTakeOver: (participantId: string) => void
}

export function AllLLMPauseModal({
  isOpen,
  onClose,
  turnCount,
  nextPauseAt,
  participants,
  onContinue,
  onStop,
  onTakeOver,
}: Readonly<AllLLMPauseModalProps>) {
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[AllLLMPauseModal] Opened', {
        turnCount,
        nextPauseAt,
        participantCount: participants.length,
      })
    }
  }, [isOpen, turnCount, nextPauseAt, participants.length])

  const handleContinue = (turns: number) => {
    clientLogger.debug('[AllLLMPauseModal] Continue clicked', { turns })
    onContinue(turns)
    onClose()
  }

  const handleStop = () => {
    clientLogger.debug('[AllLLMPauseModal] Stop clicked')
    onStop()
    onClose()
  }

  const handleTakeOver = (participantId: string) => {
    const participant = participants.find(p => p.id === participantId)
    clientLogger.debug('[AllLLMPauseModal] Take over clicked', {
      participantId,
      characterName: participant?.characterName,
    })
    onTakeOver(participantId)
    onClose()
  }

  const turnsUntilNext = nextPauseAt - turnCount

  const footer = (
    <div className="flex flex-col gap-3">
      {/* Continue options */}
      <div className="flex gap-2">
        <button
          onClick={() => handleContinue(turnsUntilNext)}
          className="flex-1 qt-button qt-button-primary"
        >
          Continue ({turnsUntilNext} more turns)
        </button>
        <button
          onClick={handleStop}
          className="qt-button qt-button-secondary"
        >
          Stop
        </button>
      </div>

      {/* Take over character options */}
      {participants.length > 0 && (
        <div className="border-t pt-3 mt-1">
          <div className="qt-text-small mb-2">Or take control of a character:</div>
          <div className="flex flex-wrap gap-2">
            {participants.map(p => (
              <button
                key={p.id}
                onClick={() => handleTakeOver(p.id)}
                className="qt-button qt-button-secondary qt-button-sm flex items-center gap-2"
              >
                <Avatar
                  name={p.characterName}
                  src={p.character}
                  size="xs"
                  styleOverride="RECTANGULAR"
                />
                <span>Play as {p.characterName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="All Characters Controlled by AI"
      maxWidth="md"
      footer={footer}
      closeOnClickOutside={false}
    >
      <div className="space-y-4">
        <p className="qt-text">
          This chat has been running automatically for <strong>{turnCount} turns</strong> without user input.
          All characters are currently controlled by AI.
        </p>

        <div className="qt-card p-3">
          <div className="qt-text-small">
            <span className="font-semibold">Pause intervals:</span> 3, 6, 12, 24, 48...
          </div>
          <div className="qt-text-xs mt-1">
            The next pause will occur at turn {nextPauseAt}.
          </div>
        </div>

        <p className="qt-text-small">
          You can continue for more turns, stop the conversation, or take control of one of the characters to participate directly.
        </p>
      </div>
    </BaseModal>
  )
}

export default AllLLMPauseModal
