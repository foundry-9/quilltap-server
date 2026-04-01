'use client'

/**
 * MobileParticipantDropdown Component
 *
 * A compact dropdown popover that appears below a participant avatar
 * in the mobile participant bar. Contains controls for:
 * - Talkativeness slider (for characters)
 * - Nudge/Queue/Dequeue button
 * - Remove from chat button (for characters)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ParticipantData } from './ParticipantCard'
import { useClickOutside } from '@/hooks/useClickOutside'

interface MobileParticipantDropdownProps {
  participant: ParticipantData
  isOpen: boolean
  anchorRef: React.RefObject<HTMLButtonElement | null>
  isCurrentTurn: boolean
  queuePosition: number
  isGenerating: boolean
  isUserParticipant: boolean
  canRemove: boolean
  onClose: () => void
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onTalkativenessChange?: (participantId: string, value: number) => void
  onRemove?: (participantId: string) => void
}

export default function MobileParticipantDropdown({
  participant,
  isOpen,
  anchorRef,
  isCurrentTurn,
  queuePosition,
  isGenerating,
  isUserParticipant,
  canRemove,
  onClose,
  onNudge,
  onQueue,
  onDequeue,
  onTalkativenessChange,
  onRemove,
}: MobileParticipantDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, right: 8 })
  // Initialize from prop, and track participant ID to reset when participant changes
  const [localTalkativeness, setLocalTalkativeness] = useState(
    participant.character?.talkativeness ?? 0.5
  )
  const [lastParticipantId, setLastParticipantId] = useState(participant.id)

  // Reset local state when participant changes (React recommended pattern instead of useEffect)
  if (participant.id !== lastParticipantId) {
    setLastParticipantId(participant.id)
    setLocalTalkativeness(participant.character?.talkativeness ?? 0.5)
  }

  const isCharacter = participant.type === 'CHARACTER'
  const entity = isCharacter ? participant.character : participant.persona

  // Calculate position relative to anchor element
  useLayoutEffect(() => {
    if (!isOpen || !dropdownRef.current || !anchorRef.current) return

    // Use requestAnimationFrame to ensure the dropdown has rendered and has its final dimensions
    requestAnimationFrame(() => {
      if (!dropdownRef.current || !anchorRef.current) return

      const anchor = anchorRef.current
      const anchorRect = anchor.getBoundingClientRect()
      const dropdownRect = dropdownRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const padding = 8

      // Use right positioning since avatars are on the right side
      // Calculate distance from right edge of viewport to right edge of anchor
      let right = viewportWidth - anchorRect.right

      // Ensure right doesn't go below padding (dropdown wouldn't be visible)
      if (right < padding) {
        right = padding
      }

      // Ensure left edge doesn't go off screen (for narrow viewports)
      const dropdownWidth = Math.max(dropdownRect.width, 200)
      const leftEdge = viewportWidth - right - dropdownWidth
      if (leftEdge < padding) {
        // Shift right value so left edge is at padding
        right = viewportWidth - dropdownWidth - padding
      }

      // Vertical: prefer below, flip above if insufficient space
      const spaceBelow = viewportHeight - anchorRect.bottom - padding
      let top = anchorRect.bottom + 8 // 8px gap below avatar

      if (spaceBelow < dropdownRect.height) {
        // Try positioning above
        const spaceAbove = anchorRect.top - padding
        if (spaceAbove > dropdownRect.height) {
          top = anchorRect.top - dropdownRect.height - 8
        }
      }

      // Ensure top doesn't go off screen
      if (top < padding) top = padding
      if (top + dropdownRect.height > viewportHeight - padding) {
        top = viewportHeight - dropdownRect.height - padding
      }

      setPosition({ top, right })
    })
  }, [isOpen, anchorRef, participant.id])

  // Close on outside click
  useClickOutside(dropdownRef, onClose, {
    enabled: isOpen,
    excludeRefs: anchorRef ? [anchorRef] : [],
    onEscape: onClose,
  })

  // Handle action button click
  const handleActionClick = () => {
    if (queuePosition > 0) {
      // Already in queue - dequeue
      onDequeue(participant.id)
    } else if (isGenerating) {
      // Someone is actively generating - add to queue for later
      onQueue(participant.id)
    } else if (isCharacter) {
      // Not generating and this is a character - nudge for immediate response
      onNudge(participant.id)
    } else {
      // User persona - queue them
      onQueue(participant.id)
    }

    onClose()
  }

  // Handle talkativeness slider change
  const handleTalkativenessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setLocalTalkativeness(value)

    if (onTalkativenessChange) {
      onTalkativenessChange(participant.id, value)
    }
  }

  // Handle remove button click
  const handleRemoveClick = () => {
    onRemove?.(participant.id)
    onClose()
  }

  // Determine button label
  const getActionButtonLabel = () => {
    if (queuePosition > 0) return 'Dequeue'
    if (isGenerating && isCurrentTurn) return 'Speaking...'
    if (isGenerating) return 'Queue'
    if (isCurrentTurn) return 'Nudge'
    return isCharacter ? 'Nudge' : 'Queue'
  }

  // Determine if button should be disabled
  const isActionDisabled = isGenerating && isCurrentTurn

  if (!isOpen || !entity) return null

  return (
    <div
      ref={dropdownRef}
      className="qt-mobile-participant-dropdown"
      style={{ top: position.top, right: position.right }}
    >
      {/* Header */}
      <div className="qt-mobile-participant-dropdown-header">
        <div className="flex items-center">
          <span className="qt-mobile-participant-dropdown-name">
            {entity.name}
          </span>
          {isUserParticipant && (
            <span className="qt-mobile-participant-dropdown-you-badge">You</span>
          )}
        </div>
        {entity.title && (
          <div className="qt-mobile-participant-dropdown-title">
            {entity.title}
          </div>
        )}
      </div>

      {/* Talkativeness slider for characters */}
      {isCharacter && !isUserParticipant && (
        <div className="qt-mobile-participant-dropdown-talkativeness">
          <div className="qt-mobile-participant-dropdown-talkativeness-label">
            <span>Talkativeness</span>
            <span>{(localTalkativeness * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={localTalkativeness}
            onChange={handleTalkativenessChange}
            className="qt-mobile-participant-dropdown-slider"
          />
        </div>
      )}

      {/* Greyed out talkativeness for user */}
      {isUserParticipant && (
        <div className="qt-mobile-participant-dropdown-talkativeness opacity-50">
          <div className="qt-mobile-participant-dropdown-talkativeness-label">
            <span>Talkativeness</span>
            <span>N/A</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={0.5}
            disabled
            className="qt-mobile-participant-dropdown-slider"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="qt-mobile-participant-dropdown-actions">
        <button
          onClick={handleActionClick}
          disabled={isActionDisabled}
          className="qt-mobile-participant-dropdown-action-btn qt-mobile-participant-dropdown-action-btn-primary"
        >
          {getActionButtonLabel()}
        </button>

        {/* Remove button - only for characters */}
        {isCharacter && !isUserParticipant && onRemove && canRemove && (
          <button
            onClick={handleRemoveClick}
            disabled={isGenerating}
            className="qt-mobile-participant-dropdown-action-btn qt-mobile-participant-dropdown-action-btn-danger"
            title={`Remove ${entity.name} from chat`}
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
