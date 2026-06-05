'use client'

import { useEffect, useState } from 'react'
import { NewChatForm } from './NewChatForm'
import { CharacterPickerPanel } from './CharacterPickerPanel'
import { useNewChat } from './hooks'
import type { TimestampConfig } from '@/lib/schemas/types'
import type { PreviousOutfitSummary } from '@/components/wardrobe'

interface NewChatModalProps {
  isOpen: boolean
  onClose: () => void
  characterId: string
  characterName: string
  projectId?: string
  /** When true, clicking Cancel navigates to /aurora (opened via ?action=chat deep link). */
  openedFromQuery?: boolean
  /**
   * "Change of venue" continuation: when set, the new chat is created as a
   * continuation of `continuationFromChatId`. The server replays that chat's
   * tail (Librarian summary + later messages) into the new chat, replicates
   * turn state, and posts cross-link Host bubbles. Title and submit copy
   * flip to reflect this.
   */
  continuationFromChatId?: string
  /** LLM characters to pre-select (continuation mode). */
  initialSelectedCharacterIds?: string[]
  /** User-controlled character to pre-select (continuation mode). */
  initialUserCharacterId?: string | null
  /** Image profile to pre-fill (continuation mode). */
  initialImageProfileId?: string | null
  /** Avatar-generation flag to pre-fill (continuation mode). */
  initialAvatarGenerationEnabled?: boolean
  /** Timestamp config to pre-fill (continuation mode). */
  initialTimestampConfig?: TimestampConfig | null
}

export function NewChatModal({
  isOpen,
  onClose,
  characterId,
  characterName,
  projectId,
  openedFromQuery,
  continuationFromChatId,
  initialSelectedCharacterIds,
  initialUserCharacterId,
  initialImageProfileId,
  initialAvatarGenerationEnabled,
  initialTimestampConfig,
}: NewChatModalProps) {
  const isContinuation = Boolean(continuationFromChatId)

  // In continuation mode, default the character picker open so the user can
  // see (and remove or augment) the carried-over cast without an extra click.
  const [pickerExpanded, setPickerExpanded] = useState(isContinuation)

  // Continuation mode: per-character per-slot summary of what was equipped at
  // the end of the source chat. Threaded through NewChatForm to OutfitSelector
  // so the "Same as last conversation" option can render a preview.
  const [previousOutfitSummary, setPreviousOutfitSummary] = useState<PreviousOutfitSummary | null>(null)
  useEffect(() => {
    if (!isOpen || !continuationFromChatId) return
    let cancelled = false
    fetch(`/api/v1/chats/${continuationFromChatId}?action=outfit-summary`)
      .then((res) => (res.ok ? res.json() : { summary: null }))
      .then((data) => {
        if (cancelled) return
        setPreviousOutfitSummary(data?.summary ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setPreviousOutfitSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, continuationFromChatId])

  const {
    loading,
    creating,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    generalScenarios,
    availableProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  } = useNewChat({
    initialCharacterId: isOpen && !isContinuation ? characterId : undefined,
    projectId: isOpen ? projectId : undefined,
    continuationFromChatId: isOpen ? continuationFromChatId : undefined,
    initialSelectedCharacterIds: isOpen ? initialSelectedCharacterIds : undefined,
    initialUserCharacterId: isOpen ? initialUserCharacterId : undefined,
    initialImageProfileId: isOpen ? initialImageProfileId : undefined,
    initialAvatarGenerationEnabled: isOpen ? initialAvatarGenerationEnabled : undefined,
    initialTimestampConfig: isOpen ? initialTimestampConfig : undefined,
  })

  if (!isOpen) return null

  const handleCancel = () => {
    if (openedFromQuery && typeof window !== 'undefined') {
      window.location.href = '/aurora'
      return
    }
    onClose()
  }

  const handleStart = async () => {
    const result = await handleCreateChat()
    if (result) onClose()
  }

  const canSubmit = (() => {
    if (creating) return false
    if (selectedCharacters.length === 0) return false
    const llm = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
    if (llm.length === 0) return false
    if (llm.some((sc) => !sc.connectionProfileId)) return false
    return true
  })()

  const widthClass = pickerExpanded ? 'md:max-w-5xl' : 'md:max-w-3xl'

  return (
    <div className="new-chat-modal fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-md ${widthClass} rounded-2xl border qt-border-default qt-bg-card p-6 qt-shadow-lg max-h-[90vh] flex flex-col`}
      >
        <div className="mb-4 flex items-start justify-between gap-4 flex-shrink-0">
          <h3 className="qt-dialog-title">
            {isContinuation
              ? 'Continue Conversation Elsewhere'
              : selectedCharacters.length > 1
                ? `Start Chat (${selectedCharacters.length} characters)`
                : `Start Chat with ${characterName}`}
          </h3>
          <button
            type="button"
            onClick={() => setPickerExpanded((v) => !v)}
            className="qt-action flex-shrink-0"
            disabled={creating}
          >
            {pickerExpanded ? '− Hide character picker' : '+ Add another character'}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="qt-text-secondary">Loading...</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-2 -mr-2 space-y-6">
            {isContinuation && (
              <div className="rounded-xl border qt-border-default qt-bg-card p-4 space-y-2">
                <label htmlFor="continuation-project-select" className="qt-text-small font-medium">
                  Project
                </label>
                <select
                  id="continuation-project-select"
                  value={selectedProjectId ?? ''}
                  onChange={(e) => setSelectedProjectId(e.target.value || null)}
                  disabled={creating}
                  className="qt-select w-full"
                >
                  <option value="">— No project —</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="qt-text-xs qt-text-muted">
                  The new chat will be filed under this project. The original chat is unchanged.
                </p>
              </div>
            )}

            {pickerExpanded && (
              <CharacterPickerPanel
                characters={characters}
                profiles={profiles}
                selectedCharacters={selectedCharacters}
                onSelectedCharactersChange={setSelectedCharacters}
                onCharactersChanged={() => setState((prev) => ({ ...prev, scenarioId: null }))}
                disabled={creating}
              />
            )}

            <NewChatForm
              profiles={profiles}
              imageProfiles={imageProfiles}
              userControlledCharacters={userControlledCharacters}
              selectedCharacters={selectedCharacters}
              setSelectedCharacters={setSelectedCharacters}
              state={state}
              setState={setState}
              project={project}
              projectScenarios={projectScenarios}
              generalScenarios={generalScenarios}
              availableProjects={isContinuation ? undefined : availableProjects}
              selectedProjectId={isContinuation ? undefined : selectedProjectId}
              onSelectedProjectIdChange={isContinuation ? undefined : setSelectedProjectId}
              creating={creating}
              showSingleCharacterControls={!pickerExpanded}
              continuationFromChatId={continuationFromChatId ?? null}
              previousOutfitSummary={previousOutfitSummary}
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            className="qt-button qt-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canSubmit}
            className="qt-button-success"
          >
            {creating
              ? (isContinuation ? 'Continuing...' : 'Creating...')
              : (isContinuation ? 'Continue' : 'Start Chat')}
          </button>
        </div>
      </div>
    </div>
  )
}
