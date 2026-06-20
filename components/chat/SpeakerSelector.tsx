'use client'

/**
 * SpeakerSelector Component
 * Characters Not Personas - Phase 5
 *
 * Dropdown that appears above the chat input when the user controls
 * multiple characters (via impersonation or user-controlled characters).
 * Allows switching which character the user is currently typing as.
 */

import { useState, useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { Icon } from '@/components/ui/icon'
import Avatar from '@/components/ui/Avatar'

export interface ControlledCharacter {
  participantId: string
  characterId: string
  name: string
  character?: {
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
    avatarUrl?: string | null
  } | null
}

interface SpeakerSelectorProps {
  /** List of characters the user can speak as */
  characters: ControlledCharacter[]
  /** The currently active speaker's participant ID */
  activeParticipantId: string | null
  /** Called when user selects a different speaker */
  onSelect: (participantId: string) => void
  /** Whether the selector is disabled (e.g., during generation) */
  disabled?: boolean
}

export function SpeakerSelector({
  characters,
  activeParticipantId,
  onSelect,
  disabled = false,
}: Readonly<SpeakerSelectorProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useClickOutside(dropdownRef, () => setIsOpen(false), {
    enabled: isOpen,
  })

  // Don't render if fewer than 2 characters
  if (characters.length < 2) {
    return null
  }

  const activeCharacter = characters.find(c => c.participantId === activeParticipantId)

  const handleSelect = (participantId: string) => {
    if (participantId === activeParticipantId) {
      setIsOpen(false)
      return
    }

    onSelect(participantId)
    setIsOpen(false)
  }

  const handleToggle = () => {
    if (disabled) return
    setIsOpen(!isOpen)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Current speaker button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'qt-button qt-button-secondary hover:qt-bg-muted'
          }
        `}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {activeCharacter ? (
          <>
            <Avatar
              name={activeCharacter.name}
              src={activeCharacter.character}
              size="xs"
              styleOverride="RECTANGULAR"
            />
            <span className="qt-label">Speaking as {activeCharacter.name}</span>
          </>
        ) : (
          <span className="text-sm">Select speaker...</span>
        )}
        <Icon name="chevron-down" className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-64 max-h-64 overflow-y-auto qt-card qt-shadow-lg rounded-lg border z-50"
          role="listbox"
        >
          <div className="py-1">
            {characters.map(character => {
              const isActive = character.participantId === activeParticipantId
              return (
                <button
                  key={character.participantId}
                  type="button"
                  onClick={() => handleSelect(character.participantId)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 text-left transition-colors
                    ${isActive
                      ? 'qt-bg-primary/10 text-primary'
                      : 'hover:qt-bg-muted'
                    }
                  `}
                  role="option"
                  aria-selected={isActive}
                >
                  <Avatar
                    name={character.name}
                    src={character.character}
                    size="xs"
                    styleOverride="RECTANGULAR"
                  />
                  <span className="flex-1 font-medium truncate">
                    {character.name}
                  </span>
                  {isActive && (
                    <Icon name="check" className="w-4 h-4" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default SpeakerSelector
