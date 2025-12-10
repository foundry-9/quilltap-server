'use client'

/**
 * AddCharacterDialog Component
 * Multi-Character Chat System - Phase 6
 *
 * Dialog for adding a new character to an existing chat.
 * Features:
 * - Searchable character list (excludes characters already in chat)
 * - Connection profile selection
 * - Option to include chat history in context
 * - Optional join scenario text
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface CharacterOption {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
  defaultConnectionProfileId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface AddCharacterDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  existingCharacterIds: string[] // Characters already in the chat
  onCharacterAdded: () => void // Callback to refresh chat data
}

export default function AddCharacterDialog({
  isOpen,
  onClose,
  chatId,
  existingCharacterIds,
  onCharacterAdded,
}: AddCharacterDialogProps) {
  const [characters, setCharacters] = useState<CharacterOption[]>([])
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [selectedConnectionProfileId, setSelectedConnectionProfileId] = useState<string | null>(null)
  const [hasHistoryAccess, setHasHistoryAccess] = useState(false)
  const [joinScenario, setJoinScenario] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // NOTE: Debug logging during render causes React errors because DevConsoleProvider
  // intercepts console calls and triggers setState. Logging should only happen
  // inside useEffect, event handlers, or other non-render contexts.

  // Load characters and connection profiles when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadData()
      // Focus search input after loading
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    } else {
      // Reset state when dialog closes
      setSelectedCharacterId(null)
      setSelectedConnectionProfileId(null)
      setHasHistoryAccess(false)
      setJoinScenario('')
      setSearchTerm('')
    }
  }, [isOpen])

  // Set default connection profile when character is selected
  useEffect(() => {
    if (selectedCharacterId) {
      const character = characters.find(c => c.id === selectedCharacterId)
      if (character?.defaultConnectionProfileId) {
        setSelectedConnectionProfileId(character.defaultConnectionProfileId)
        clientLogger.debug('[AddCharacterDialog] Set default connection profile from character', {
          characterId: selectedCharacterId,
          connectionProfileId: character.defaultConnectionProfileId,
        })
      } else {
        // Fall back to first available profile
        if (connectionProfiles.length > 0) {
          setSelectedConnectionProfileId(connectionProfiles[0].id)
        }
      }
    }
  }, [selectedCharacterId, characters, connectionProfiles])

  const loadData = async () => {
    setIsLoading(true)
    clientLogger.debug('[AddCharacterDialog] Loading characters and connection profiles')

    try {
      const [charactersRes, profilesRes] = await Promise.all([
        fetch('/api/characters'),
        fetch('/api/profiles'),
      ])

      if (!charactersRes.ok || !profilesRes.ok) {
        throw new Error('Failed to load data')
      }

      const charactersData = await charactersRes.json()
      const profilesData = await profilesRes.json()

      const loadedCharacters = charactersData.characters || []
      const loadedProfiles = Array.isArray(profilesData) ? profilesData : []

      setCharacters(loadedCharacters)
      setConnectionProfiles(loadedProfiles)

      clientLogger.debug('[AddCharacterDialog] Data loaded', {
        characterCount: loadedCharacters.length,
        profileCount: loadedProfiles.length,
      })
    } catch (error) {
      clientLogger.error('[AddCharacterDialog] Error loading data', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load characters')
    } finally {
      setIsLoading(false)
    }
  }

  // Filter out characters already in the chat and apply search
  const availableCharacters = useMemo(() => {
    const existingSet = new Set(existingCharacterIds)
    return characters
      .filter(c => !existingSet.has(c.id))
      .filter(c =>
        searchTerm === '' ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.title && c.title.toLowerCase().includes(searchTerm.toLowerCase()))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [characters, existingCharacterIds, searchTerm])

  const selectedCharacter = useMemo(() => {
    return characters.find(c => c.id === selectedCharacterId)
  }, [characters, selectedCharacterId])

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        if (!isAdding) {
          onClose()
        }
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isAdding) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isAdding, onClose])

  const handleAddCharacter = async () => {
    if (!selectedCharacterId || !selectedConnectionProfileId) {
      showErrorToast('Please select a character and connection profile')
      return
    }

    setIsAdding(true)
    clientLogger.debug('[AddCharacterDialog] Adding character to chat', {
      chatId,
      characterId: selectedCharacterId,
      connectionProfileId: selectedConnectionProfileId,
      hasHistoryAccess,
      joinScenario: joinScenario || null,
    })

    try {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addParticipant: {
            type: 'CHARACTER',
            characterId: selectedCharacterId,
            connectionProfileId: selectedConnectionProfileId,
            hasHistoryAccess,
            joinScenario: joinScenario.trim() || null,
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to add character')
      }

      clientLogger.info('[AddCharacterDialog] Character added successfully', {
        chatId,
        characterId: selectedCharacterId,
      })

      showSuccessToast(`${selectedCharacter?.name || 'Character'} has joined the chat`)
      onCharacterAdded()
      onClose()
    } catch (error) {
      clientLogger.error('[AddCharacterDialog] Error adding character', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to add character')
    } finally {
      setIsAdding(false)
    }
  }

  const getAvatarSrc = (character: CharacterOption) => {
    if (character.defaultImage) {
      const filepath = character.defaultImage.url || character.defaultImage.filepath
      return filepath.startsWith('/') ? filepath : `/${filepath}`
    }
    return character.avatarUrl || null
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay p-4">
      <div
        ref={modalRef}
        className="qt-dialog max-w-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">
            Add Character to Chat
          </h2>
          <button
            onClick={onClose}
            className="qt-button qt-button-ghost p-2"
            disabled={isAdding}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Character Selection */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Select Character
                </label>

                {/* Search input */}
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search characters..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="qt-input mb-3"
                  disabled={isAdding}
                />

                {/* Character grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-64 overflow-y-auto p-1">
                  {availableCharacters.length === 0 ? (
                    <div className="col-span-full text-center py-8 text-muted-foreground">
                      {searchTerm ? 'No matching characters found' : 'All your characters are already in this chat'}
                    </div>
                  ) : (
                    availableCharacters.map((character) => {
                      const avatarSrc = getAvatarSrc(character)
                      const isSelected = selectedCharacterId === character.id

                      return (
                        <button
                          key={character.id}
                          onClick={() => setSelectedCharacterId(character.id)}
                          disabled={isAdding}
                          className={`
                            p-3 rounded-lg border text-left transition-all
                            ${isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary'
                              : 'border-border hover:border-primary/50 hover:bg-muted/50'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed
                          `}
                        >
                          <div className="flex items-center gap-3">
                            {/* Avatar */}
                            <div
                              className="w-12 h-15 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0"
                              style={{ width: '48px', height: '60px' }}
                            >
                              {avatarSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={avatarSrc}
                                  alt={character.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-lg font-bold text-muted-foreground">
                                  {character.name.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-foreground truncate">
                                {character.name}
                              </div>
                              {character.title && (
                                <div className="text-xs text-muted-foreground italic truncate">
                                  {character.title}
                                </div>
                              )}
                            </div>

                            {/* Selected indicator */}
                            {isSelected && (
                              <svg className="w-5 h-5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Connection Profile Selection */}
              {selectedCharacterId && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    LLM Backend
                  </label>
                  <select
                    value={selectedConnectionProfileId || ''}
                    onChange={(e) => setSelectedConnectionProfileId(e.target.value || null)}
                    className="qt-select"
                    disabled={isAdding}
                  >
                    <option value="">Select a connection profile...</option>
                    {connectionProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.provider}: {profile.modelName})
                      </option>
                    ))}
                  </select>
                  {connectionProfiles.length === 0 && (
                    <p className="text-sm text-warning mt-1">
                      No connection profiles available. Please create one in Settings.
                    </p>
                  )}
                </div>
              )}

              {/* History Access Option */}
              {selectedCharacterId && (
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="hasHistoryAccess"
                    checked={hasHistoryAccess}
                    onChange={(e) => setHasHistoryAccess(e.target.checked)}
                    disabled={isAdding}
                    className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <div>
                    <label htmlFor="hasHistoryAccess" className="text-sm font-medium text-foreground cursor-pointer">
                      Include chat history in context
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      If checked, this character will see messages from before they joined. If unchecked, they will only see messages from their join point onward.
                    </p>
                  </div>
                </div>
              )}

              {/* Join Scenario */}
              {selectedCharacterId && (
                <div>
                  <label htmlFor="joinScenario" className="block text-sm font-medium text-foreground mb-2">
                    How did they join? <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="joinScenario"
                    value={joinScenario}
                    onChange={(e) => setJoinScenario(e.target.value)}
                    placeholder="e.g., They walked up and joined the group at the tavern table..."
                    rows={3}
                    disabled={isAdding}
                    className="qt-textarea"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This text will be included in the character&apos;s context to explain how they joined the conversation.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isAdding}
          >
            Cancel
          </button>
          <button
            onClick={handleAddCharacter}
            disabled={isAdding || !selectedCharacterId || !selectedConnectionProfileId}
            className="qt-button qt-button-primary flex items-center gap-2"
          >
            {isAdding ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Adding...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Character
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
