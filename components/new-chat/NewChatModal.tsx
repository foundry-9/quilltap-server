'use client'

/**
 * The New Chat dialog, as the workspace shows it. Mounted only by
 * `NewChatProvider` — `open(opts)` is the one way it appears — and closed by
 * the provider, which returns the operator wherever they opened it from.
 *
 * @module components/new-chat/NewChatModal
 */

import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { NewChatFormProvider, useNewChatForm } from './NewChatFormContext'
import { NewChatDialogBody, useNewChatCanSubmit } from './NewChatDialogBody'
import type { TimestampConfig } from '@/lib/schemas/types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

interface NewChatModalProps {
  onClose: () => void
  characterId?: string
  characterName?: string
  projectId?: string
  /**
   * "Change of venue" continuation: the new chat is created as a continuation
   * of `continuationFromChatId` (the server replays that chat's tail into it).
   */
  continuationFromChatId?: string
  /** LLM characters to pre-select (continuation mode). */
  initialSelectedCharacterIds?: string[]
  /** User-controlled character to pre-select (continuation mode). */
  initialUserCharacterId?: string | null
  /** The source chat's choices, carried over as the operator's own (continuation mode). */
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  initialTimestampConfig?: TimestampConfig | null
  initialConciergeState?: ConciergeState | null
  /** Open in autonomous-room creation mode (≥2 LLM cast, no user character). */
  autonomous?: boolean
}

export function NewChatModal({
  onClose,
  characterId,
  characterName,
  projectId,
  continuationFromChatId,
  initialSelectedCharacterIds,
  initialUserCharacterId,
  initialImageProfileId,
  initialAvatarGenerationEnabled,
  initialTimestampConfig,
  initialConciergeState,
  autonomous,
}: NewChatModalProps) {
  const isContinuation = Boolean(continuationFromChatId)
  return (
    <NewChatFormProvider
      options={{
        initialCharacterId: isContinuation ? undefined : characterId || undefined,
        projectId,
        continuationFromChatId,
        initialSelectedCharacterIds,
        initialUserCharacterId,
        initialImageProfileId,
        initialAvatarGenerationEnabled,
        initialTimestampConfig,
        initialConciergeState,
        initialAutonomous: autonomous,
      }}
    >
      <NewChatModalFrame
        onClose={onClose}
        characterName={characterName ?? ''}
        // Default the picker open in continuation mode (so the carried-over
        // cast is visible), in autonomous mode (which needs ≥2 characters),
        // and with no seed character (the operator must pick one). A seeded
        // single-character start keeps it collapsed.
        initialPickerExpanded={isContinuation || !characterId || Boolean(autonomous)}
      />
    </NewChatFormProvider>
  )
}

function NewChatModalFrame({
  onClose,
  characterName,
  initialPickerExpanded,
}: {
  onClose: () => void
  characterName: string
  initialPickerExpanded: boolean
}) {
  const { loading, creating, selectedCharacters, state, handleCreateChat, continuationFromChatId } =
    useNewChatForm()
  const canSubmit = useNewChatCanSubmit()
  const isContinuation = Boolean(continuationFromChatId)
  const isAutonomous = state.autonomous.enabled
  const [pickerExpanded, setPickerExpanded] = useState(initialPickerExpanded)

  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const handleFocusKeyDown = useDialogFocus(dialogRef, true)
  useEscapeKey(onClose, !creating)

  const handleStart = async () => {
    // The chat exists once this returns; the Salon runs its opening, so the
    // dialog closes at once.
    const result = await handleCreateChat()
    if (result) onClose()
  }

  const widthClass = pickerExpanded ? 'md:max-w-5xl' : 'md:max-w-3xl'

  const modalContent = (
    <div className="new-chat-modal qt-dialog-overlay p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleFocusKeyDown}
        className={`w-full max-w-md ${widthClass} rounded-2xl border qt-border-default qt-bg-card p-6 qt-shadow-lg max-h-[90vh] flex flex-col`}
      >
        <div className="mb-4 flex items-start justify-between gap-4 flex-shrink-0">
          <h3 id={titleId} className="qt-dialog-title">
            {isAutonomous
              ? 'New Autonomous Room'
              : isContinuation
                ? 'Continue Conversation Elsewhere'
                : selectedCharacters.length > 1
                  ? `Start Chat (${selectedCharacters.length} characters)`
                  : characterName
                    ? `Start Chat with ${characterName}`
                    : 'Start Chat'}
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
          <div className="qt-loading-state">
            <p className="qt-text-secondary">Loading...</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-2 -mr-2">
            <NewChatDialogBody pickerExpanded={pickerExpanded} />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="qt-button qt-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleStart} disabled={!canSubmit} className="qt-button-success">
            {creating
              ? (isContinuation ? 'Continuing...' : 'Creating...')
              : (isAutonomous ? 'Create Autonomous Room' : isContinuation ? 'Continue' : 'Start Chat')}
          </button>
        </div>
      </div>
    </div>
  )

  // Render at the document root so the dialog hovers over the WHOLE workspace.
  // Inside a split pane, a `fixed` overlay is otherwise trapped in that pane's
  // stacking context (`.qt-tab-pane` z-index) and the other pane paints over its
  // far half. The portal preserves React context, so the form context,
  // useWorkspaceNavigate and theming still work.
  if (typeof document === 'undefined') return null
  return createPortal(modalContent, document.body)
}
