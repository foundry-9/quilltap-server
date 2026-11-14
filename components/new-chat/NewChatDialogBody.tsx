'use client'

/**
 * The New Chat dialog's body — the continuation's project picker, the cast
 * picker and the form — shared by the workspace modal and the `/salon/new`
 * full-page fallback. Everything it shows comes from {@link useNewChatForm}.
 *
 * @module components/new-chat/NewChatDialogBody
 */

import { NewChatForm } from './NewChatForm'
import { CharacterPickerPanel } from './CharacterPickerPanel'
import { useNewChatForm } from './NewChatFormContext'

interface NewChatDialogBodyProps {
  /** Show the cast picker (the modal can collapse it; the page always shows it). */
  pickerExpanded: boolean
  /** Focus the picker's search box on mount. */
  autoFocusSearch?: boolean
}

export function NewChatDialogBody({ pickerExpanded, autoFocusSearch }: NewChatDialogBodyProps) {
  const { continuationFromChatId, selectedProjectId, setSelectedProjectId, availableProjects, creating } =
    useNewChatForm()

  return (
    <div className="space-y-6">
      {continuationFromChatId && (
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

      {pickerExpanded && <CharacterPickerPanel autoFocusSearch={autoFocusSearch} />}

      <NewChatForm showSingleCharacterControls={!pickerExpanded} />
    </div>
  )
}

/** Whether the cast can be submitted as it stands. */
export function useNewChatCanSubmit(): boolean {
  const { creating, selectedCharacters, profiles, state } = useNewChatForm()
  if (creating || selectedCharacters.length === 0 || profiles.length === 0) return false
  const llm = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
  if (llm.length === 0) return false
  if (llm.some((sc) => !sc.connectionProfileId)) return false
  // An autonomous room runs character-to-character: at least two LLM cast and
  // no user-controlled character.
  if (state.autonomous.enabled) {
    const hasUserCharacter = selectedCharacters.some((sc) => sc.controlledBy === 'user')
    if (llm.length < 2 || hasUserCharacter) return false
  }
  return true
}
