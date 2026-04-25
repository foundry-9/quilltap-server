'use client'

import { useState } from 'react'
import { NewChatForm } from './NewChatForm'
import { CharacterPickerPanel } from './CharacterPickerPanel'
import { useNewChat } from './hooks'

interface NewChatModalProps {
  isOpen: boolean
  onClose: () => void
  characterId: string
  characterName: string
  projectId?: string
  /** When true, clicking Cancel navigates to /aurora (opened via ?action=chat deep link). */
  openedFromQuery?: boolean
}

export function NewChatModal({
  isOpen,
  onClose,
  characterId,
  characterName,
  projectId,
  openedFromQuery,
}: NewChatModalProps) {
  const [pickerExpanded, setPickerExpanded] = useState(false)

  const {
    loading,
    creating,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  } = useNewChat({
    initialCharacterId: isOpen ? characterId : undefined,
    projectId: isOpen ? projectId : undefined,
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
          <h3 className="text-lg font-semibold">
            {selectedCharacters.length > 1
              ? `Start Chat (${selectedCharacters.length} characters)`
              : `Start Chat with ${characterName}`}
          </h3>
          <button
            type="button"
            onClick={() => setPickerExpanded((v) => !v)}
            className="text-sm text-primary hover:underline flex-shrink-0"
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
              creating={creating}
              showSingleCharacterControls={!pickerExpanded}
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium qt-text-secondary qt-shadow-sm transition hover:qt-bg-muted cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canSubmit}
            className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground shadow transition hover:qt-bg-success/90 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {creating ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
