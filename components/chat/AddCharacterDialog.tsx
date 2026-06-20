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

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import Avatar from '@/components/ui/Avatar'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { useClickOutside } from '@/hooks/useClickOutside'
import CreateNPCDialog from './CreateNPCDialog'
import SummonFromLoreModal from './SummonFromLoreModal'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { OutfitSelector } from '@/components/wardrobe'
import type { OutfitSelection } from '@/components/wardrobe'
import { Icon } from '@/components/ui/icon'

interface CharacterOption {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
  defaultConnectionProfileId?: string | null
  npc?: boolean
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
  isDefault?: boolean
}

interface AddCharacterDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  existingCharacterIds: string[] // Characters already in the chat
  onCharacterAdded: () => void // Callback to refresh chat data
}

// Special constant for user impersonation selection
const USER_IMPERSONATION_VALUE = '__user_impersonation__'

export default function AddCharacterDialog({
  isOpen,
  onClose,
  chatId,
  existingCharacterIds,
  onCharacterAdded,
}: AddCharacterDialogProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  // This can be a profile ID or USER_IMPERSONATION_VALUE for user control
  const [selectedConnectionProfileId, setSelectedConnectionProfileId] = useState<string | null>(null)
  const [hasHistoryAccess, setHasHistoryAccess] = useState(false)
  const [joinScenario, setJoinScenario] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isCreateNPCOpen, setIsCreateNPCOpen] = useState(false)
  const [isSummonOpen, setIsSummonOpen] = useState(false)
  const [outfitSelection, setOutfitSelection] = useState<OutfitSelection | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // NOTE: Debug logging during render causes React errors because DevConsoleProvider
  // intercepts console calls and triggers setState. Logging should only happen
  // inside useEffect, event handlers, or other non-render contexts.

  const { data: charactersData, isLoading } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters: CharacterOption[] }>('/api/v1/characters', { signal }),
    enabled: isOpen,
  })
  const { data: profilesData, error: profilesError } = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ConnectionProfile[] }>('/api/v1/connection-profiles', { signal }),
    enabled: isOpen,
  })

  const characters = useMemo(() => charactersData?.characters ?? [], [charactersData])
  const connectionProfiles = useMemo(() => profilesData?.profiles ?? [], [profilesData])

  // Load characters and connection profiles when dialog opens and focus search input
  useEffect(() => {
    if (isOpen && !isLoading) {
      // Focus search input after loading
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    } else if (!isOpen) {
      // Reset state when dialog closes
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
      setSelectedCharacterId(null)
      setSelectedConnectionProfileId(null)
      setHasHistoryAccess(false)
      setJoinScenario('')
      setSearchTerm('')
      setIsCreateNPCOpen(false)
      setOutfitSelection(null)
    }
  }, [isOpen, isLoading])

  // Set default connection profile when character is selected.
  // Fall back through: character default → user default → first available,
  // skipping any character default that no longer exists in the user's profiles.
  useEffect(() => {
    if (!selectedCharacterId) return
    const character = characters.find(c => c.id === selectedCharacterId)
    const characterDefault = character?.defaultConnectionProfileId
    const characterDefaultExists = characterDefault
      ? connectionProfiles.some(p => p.id === characterDefault)
      : false
    let resolved: string | null = null
    if (characterDefault && characterDefaultExists) {
      resolved = characterDefault
    } else {
      const userDefault = connectionProfiles.find(p => p.isDefault)
      resolved = userDefault?.id ?? connectionProfiles[0]?.id ?? null
    }
    if (resolved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream selectedCharacterId changes (parent renders unconditionally)
      setSelectedConnectionProfileId(resolved)
    }
  }, [selectedCharacterId, characters, connectionProfiles])

  // Filter out characters already in the chat and apply search
  const { regularCharacters, npcCharacters } = useMemo(() => {
    const existingSet = new Set(existingCharacterIds)
    const filtered = characters
      .filter(c => !existingSet.has(c.id))
      .filter(c =>
        searchTerm === '' ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.title && c.title.toLowerCase().includes(searchTerm.toLowerCase()))
      )

    // Separate into regular and NPC characters
    const regular = filtered
      .filter(c => c.npc !== true)
      .sort((a, b) => a.name.localeCompare(b.name))

    const npcs = filtered
      .filter(c => c.npc === true)
      .sort((a, b) => a.name.localeCompare(b.name))

    return { regularCharacters: regular, npcCharacters: npcs }
  }, [characters, existingCharacterIds, searchTerm])

  const selectedCharacter = useMemo(() => {
    return characters.find(c => c.id === selectedCharacterId)
  }, [characters, selectedCharacterId])

  // Handle click outside to close (disabled when NPC dialog is open)
  useClickOutside(modalRef, () => { if (!isAdding) onClose() }, {
    enabled: isOpen && !isCreateNPCOpen,
    onEscape: () => { if (!isAdding && !isCreateNPCOpen) onClose() },
  })

  const handleAddCharacter = async () => {
    if (!selectedCharacterId || !selectedConnectionProfileId) {
      showErrorToast('Please select a character and connection profile')
      return
    }

    const isUserImpersonation = selectedConnectionProfileId === USER_IMPERSONATION_VALUE

    setIsAdding(true)

    try {
      // Build participant data - only include connectionProfileId for LLM-controlled characters
      const participantData: Record<string, unknown> = {
        type: 'CHARACTER',
        characterId: selectedCharacterId,
        controlledBy: isUserImpersonation ? 'user' : 'llm',
        hasHistoryAccess,
      }

      // Only include connectionProfileId for LLM control (schema doesn't accept null)
      if (!isUserImpersonation) {
        participantData.connectionProfileId = selectedConnectionProfileId
      }

      // Only include joinScenario if provided
      if (joinScenario.trim()) {
        participantData.joinScenario = joinScenario.trim()
      }

      // Forward the chosen starting outfit. The server defaults to
      // `mode: 'default'` when nothing is sent, matching the new-chat flow.
      if (outfitSelection) {
        participantData.outfitSelection = outfitSelection
      }

      const response = await fetch(`/api/v1/chats/${chatId}?action=add-participant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(participantData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to add character')
      }

      showSuccessToast(`${selectedCharacter?.name || 'Character'} has joined the chat`)

      onCharacterAdded()
      onClose()
    } catch (error) {
      console.error('[AddCharacterDialog] Error adding character', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to add character')
    } finally {
      setIsAdding(false)
    }
  }

  const handleOutfitSelectionsChange = useCallback((selections: OutfitSelection[]) => {
    setOutfitSelection(selections[0] ?? null)
  }, [])

  const outfitCharacters = useMemo(() => {
    if (!selectedCharacter) return []
    return [{
      id: selectedCharacter.id,
      name: selectedCharacter.name,
      isUserControlled: selectedConnectionProfileId === USER_IMPERSONATION_VALUE,
    }]
  }, [selectedCharacter, selectedConnectionProfileId])

  const handleNPCCreated = async (characterId: string) => {
    // Auto-select the new NPC
    setSelectedCharacterId(characterId)

    // Close the create NPC dialog
    setIsCreateNPCOpen(false)
  }

  const handleSummoned = (characterId: string) => {
    // Hand the freshly-summoned character back to the picker, preselected, so
    // the operator can finish adding it (connection profile, outfit) via the
    // usual controls — mirrors handleNPCCreated.
    setSelectedCharacterId(characterId)
    setIsSummonOpen(false)
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
            <Icon name="close" className="w-6 h-6" />
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
                <label className="block text-sm qt-text-primary mb-2">
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
                  {regularCharacters.length === 0 && npcCharacters.length === 0 ? (
                    <div className="col-span-full text-center py-8 qt-text-secondary">
                      {searchTerm ? 'No matching characters found' : 'All your characters are already in this chat'}
                    </div>
                  ) : (
                    <>
                      {/* Regular Characters */}
                      {regularCharacters.map((character) => {
                        const isSelected = selectedCharacterId === character.id

                        return (
                          <button
                            key={character.id}
                            onClick={() => setSelectedCharacterId(character.id)}
                            disabled={isAdding}
                            className={`
                              p-3 rounded-lg border text-left transition-all
                              ${isSelected
                                ? 'qt-border-primary qt-bg-primary/10 ring-2 ring-primary'
                                : 'qt-border-default hover:qt-border-primary/50 hover:qt-bg-muted/50'
                              }
                              disabled:opacity-50 disabled:cursor-not-allowed
                            `}
                          >
                            <div className="flex items-center gap-3">
                              {/* Avatar */}
                              <Avatar
                                name={character.name}
                                src={character}
                                size="md"
                                styleOverride="RECTANGULAR"
                              />

                              {/* Info */}
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-foreground truncate">
                                  {character.name}
                                </div>
                                {character.title && (
                                  <div className="qt-text-xs italic truncate">
                                    {character.title}
                                  </div>
                                )}
                              </div>

                              {/* Selected indicator */}
                              {isSelected && (
                                <Icon name="check-circle" className="w-5 h-5 text-primary flex-shrink-0" />
                              )}
                            </div>
                          </button>
                        )
                      })}

                      {/* NPCs Section */}
                      {npcCharacters.length > 0 && (
                        <>
                          {/* Divider */}
                          <div className="col-span-full flex items-center gap-2 my-2">
                            <div className="flex-1 border-t qt-border-default"></div>
                            <span className="qt-text-xs qt-text-secondary font-medium">NPCs</span>
                            <div className="flex-1 border-t qt-border-default"></div>
                          </div>

                          {/* NPC Characters */}
                          {npcCharacters.map((character) => {
                            const isSelected = selectedCharacterId === character.id

                            return (
                              <button
                                key={character.id}
                                onClick={() => setSelectedCharacterId(character.id)}
                                disabled={isAdding}
                                className={`
                                  p-3 rounded-lg border text-left transition-all
                                  ${isSelected
                                    ? 'qt-border-primary qt-bg-primary/10 ring-2 ring-primary'
                                    : 'qt-border-default hover:qt-border-primary/50 hover:qt-bg-muted/50'
                                  }
                                  disabled:opacity-50 disabled:cursor-not-allowed
                                `}
                              >
                                <div className="flex items-center gap-3">
                                  {/* Avatar */}
                                  <Avatar
                                    name={character.name}
                                    src={character}
                                    size="md"
                                    styleOverride="RECTANGULAR"
                                  />

                                  {/* Info */}
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-foreground truncate">
                                      {character.name}
                                    </div>
                                    {character.title && (
                                      <div className="qt-text-xs italic truncate">
                                        {character.title}
                                      </div>
                                    )}
                                  </div>

                                  {/* Selected indicator */}
                                  {isSelected && (
                                    <Icon name="check-circle" className="w-5 h-5 text-primary flex-shrink-0" />
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </>
                      )}

                      {/* Create New NPC Button */}
                      <button
                        onClick={() => setIsCreateNPCOpen(true)}
                        disabled={isAdding}
                        className="p-3 rounded-lg border border-dashed qt-border-default hover:qt-border-primary/50 hover:qt-bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3">
                          {/* User Plus Icon */}
                          <div className="w-10 h-10 flex items-center justify-center rounded qt-bg-primary/10 text-primary flex-shrink-0">
                            <Icon name="user-plus" className="w-6 h-6" />
                          </div>

                          {/* Text */}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-primary truncate">
                              Create New NPC
                            </div>
                            <div className="qt-text-xs qt-text-secondary truncate">
                              Add an ad-hoc character
                            </div>
                          </div>
                        </div>
                      </button>

                      {/* Summon from Lore Button */}
                      <button
                        onClick={() => setIsSummonOpen(true)}
                        disabled={isAdding}
                        className="p-3 rounded-lg border border-dashed qt-border-default hover:qt-border-primary/50 hover:qt-bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3">
                          {/* Sparkles Icon */}
                          <div className="w-10 h-10 flex items-center justify-center rounded qt-bg-primary/10 text-primary flex-shrink-0">
                            <Icon name="sparkles" className="w-6 h-6" />
                          </div>

                          {/* Text */}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-primary truncate">
                              Summon from Lore
                            </div>
                            <div className="qt-text-xs qt-text-secondary truncate">
                              Conjure a soul from your worldbuilding notes
                            </div>
                          </div>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Connection Profile Selection */}
              {selectedCharacterId && (
                <div>
                  <label className="block text-sm qt-text-primary mb-2">
                    Controlled By
                  </label>
                  <select
                    value={selectedConnectionProfileId || ''}
                    onChange={(e) => setSelectedConnectionProfileId(e.target.value || null)}
                    className="qt-select"
                    disabled={isAdding}
                  >
                    <option value="">Select who controls this character...</option>
                    <option value={USER_IMPERSONATION_VALUE}>
                      User (you will type for this character)
                    </option>
                    <optgroup label="LLM Backends">
                      {connectionProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} ({profile.provider}: {profile.modelName})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {selectedConnectionProfileId && selectedConnectionProfileId !== USER_IMPERSONATION_VALUE && (() => {
                    const selectedProfile = connectionProfiles.find(p => p.id === selectedConnectionProfileId)
                    return selectedProfile?.provider ? (
                      <div className="mt-1">
                        <ProviderModelBadge provider={selectedProfile.provider} modelName={selectedProfile.modelName} size="sm" />
                      </div>
                    ) : null
                  })()}
                  {connectionProfiles.length === 0 && (
                    <p className="text-sm qt-text-warning mt-1">
                      No connection profiles available. Create one in Settings to use LLM control.
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
                    <label htmlFor="hasHistoryAccess" className="text-sm qt-text-primary cursor-pointer">
                      Include chat history in context
                    </label>
                    <p className="qt-text-xs mt-0.5">
                      If checked, this character will see messages from before they joined. If unchecked, they will only see messages from their join point onward.
                    </p>
                  </div>
                </div>
              )}

              {/* Join Scenario */}
              {selectedCharacterId && (
                <div>
                  <label htmlFor="joinScenario" className="block text-sm qt-text-primary mb-2">
                    How did they join? <span className="qt-text-secondary font-normal">(optional)</span>
                  </label>
                  <p className="qt-text-xs mb-2">
                    Included in the character&rsquo;s context to explain how they joined the conversation.
                  </p>
                  <MarkdownLexicalEditor
                    value={joinScenario}
                    onChange={setJoinScenario}
                    disabled={isAdding}
                    remountKey={selectedCharacterId}
                    namespace="AddCharacterDialog.joinScenario"
                    ariaLabel="Join scenario"
                    minHeight="6rem"
                  />
                </div>
              )}

              {/* Starting Outfit */}
              {selectedCharacterId && outfitCharacters.length > 0 && (
                <OutfitSelector
                  key={selectedCharacterId}
                  characters={outfitCharacters}
                  onSelectionsChange={handleOutfitSelectionsChange}
                  disabled={isAdding}
                  chatId={chatId}
                />
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
            className="qt-button qt-button-primary"
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
                <Icon name="plus" className="w-4 h-4" />
                Add Character
              </>
            )}
          </button>
        </div>
      </div>

      {/* Create NPC Dialog */}
      <CreateNPCDialog
        isOpen={isCreateNPCOpen}
        onClose={() => setIsCreateNPCOpen(false)}
        chatId={chatId}
        onNPCCreated={handleNPCCreated}
      />

      {/* Summon from Lore Dialog */}
      <SummonFromLoreModal
        isOpen={isSummonOpen}
        onClose={() => setIsSummonOpen(false)}
        onSummoned={handleSummoned}
      />
    </div>
  )
}
