'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { apiErrorMessage, apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { patchChat, putChatUpdate, type ChatPatch } from '@/lib/chat/patch-chat'
import { postChatAction } from './chat-actions'
import { useConnectionProfilesQuery } from '@/lib/hooks/use-profiles'
import { orderProfilesByChatUse } from '@/lib/llm/profile-usage'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { Chat } from '../types'
import type { ChatTurnMode, TurnPosition } from '@/lib/schemas/storyteller.types'

/**
 * Persist one `{ chat: { … } }` patch through {@link patchChat}. A server
 * refusal and a network fault keep their historical log lines (`Failed to
 * persist …` with the status, `Error persisting …` with the error); either one
 * runs `onFailure`. Resolves `true` on success so a caller can gate a success
 * toast on it.
 */
async function persistChatField(
  chatId: string,
  updates: ChatPatch,
  logLabel: string,
  onFailure?: () => void,
): Promise<boolean> {
  try {
    await patchChat(chatId, updates)
    return true
  } catch (error) {
    if (error instanceof ApiFetchError) {
      console.error(`[Chat] Failed to persist ${logLabel}`, error.status)
    } else {
      console.error(`[Chat] Error persisting ${logLabel}`, error)
    }
    onFailure?.()
    return false
  }
}

/**
 * A per-chat tri-state override the sidebar sets optimistically: local state
 * seeded from the chat record (`null` = inherit), and a setter that applies
 * the value at once, persists it via {@link persistChatField}, and rolls back
 * to the previous value — toasting `errorToast` — when the write fails.
 */
function useOptimisticChatField<T>(
  chatId: string,
  field: Extract<keyof Chat, string>,
  chatValue: T | null | undefined,
  errorToast: string,
): [T | null, (value: T | null) => Promise<void>] {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (chatValue !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic local copy of a chat field: re-seeded when the chat record changes
      setValue(chatValue ?? null)
    }
  }, [chatValue])
  const update = useCallback(async (next: T | null) => {
    const previous = value
    setValue(next)
    await persistChatField(chatId, { [field]: next }, field, () => {
      setValue(previous)
      showErrorToast(errorToast)
    })
  }, [chatId, field, value, errorToast])
  return [value, update]
}

interface UseChatControlsParams {
  chatId: string
  chat: Chat | null
  participantData: ParticipantData[]
  participantsAsBase: ChatParticipantBase[]
  turnState: TurnState
  /** Ref to check if streaming is active (avoids circular dependency with SSE hook) */
  streamingRef: React.MutableRefObject<boolean>
  isPaused: boolean
  setIsPaused: (paused: boolean) => void
  fetchChat: () => Promise<void>
  setTurnState: React.Dispatch<React.SetStateAction<TurnState>>
  setChat: (fn: (prev: Chat | null) => Chat | null) => void
  startBackgroundPolling: () => void
}

export function useChatControls({
  chatId,
  chat,
  participantData,
  participantsAsBase,
  turnState,
  streamingRef,
  isPaused,
  setIsPaused,
  fetchChat,
  setTurnState,
  setChat,
  startBackgroundPolling,
}: UseChatControlsParams) {
  // Local state
  const [documentEditingMode, setDocumentEditingMode] = useState(false)
  const [agentModeEnabled, setAgentModeEnabled] = useState<boolean | null>(null)
  const [allowCrossCharacterVaultReads, setAllowCrossCharacterVaultReads] = useState(false)
  // Per-chat Core whisper enabled override. Tri-state: null = inherit, true/false = explicit.
  const [coreWhisperEnabled, handleSetCoreWhisperEnabled] = useOptimisticChatField<boolean>(
    chatId, 'coreWhisperEnabled', chat?.coreWhisperEnabled, 'Could not update Core whisper setting',
  )
  // Per-chat Core whisper cadence override. null = inherit, positive integer = explicit.
  const [coreWhisperInterval, handleSetCoreWhisperInterval] = useOptimisticChatField<number>(
    chatId, 'coreWhisperInterval', chat?.coreWhisperInterval, 'Could not update Core whisper cadence',
  )
  // "Nothing to add" turn-skipping toggle (null = enabled default; false = disabled).
  const [turnSkippingEnabled, handleSetTurnSkippingEnabled] = useOptimisticChatField<boolean>(
    chatId, 'turnSkippingEnabled', chat?.turnSkippingEnabled, 'Could not update turn-skipping setting',
  )
  // Per-chat thinking-visibility override (tri-state: null = inherit global).
  // DISPLAY ONLY — only governs whether captured reasoning is shown, never
  // whether it is stored or fed to a model.
  const [showThinking, handleSetShowThinking] = useOptimisticChatField<boolean>(
    chatId, 'showThinking', chat?.showThinking, 'Could not update Thinking visibility',
  )
  // Per-chat answer-confirmation override (tri-state: null = inherit project
  // then global, 'ON'/'OFF' = explicit).
  const [answerConfirmationOverride, handleSetAnswerConfirmationOverride] = useOptimisticChatField<'ON' | 'OFF'>(
    chatId, 'answerConfirmationOverride', chat?.answerConfirmationOverride, 'Could not update Answer Confirmation',
  )

  // Sync agentModeEnabled state when chat loads, using the resolved cascade value
  const chatResolvedAgentModeEnabled = chat?.resolvedAgentModeEnabled
  // Keyed on the field, not the chat object: several writers hand back a new
  // object spread from the old one, and re-seeding from that stale copy put
  // the pre-toggle value back on screen (#262).
  const hasChat = chat !== null
  useEffect(() => {
    if (hasChat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic local copy of a chat field: re-seeded when the chat record changes, also set by the toggle handlers
      setAgentModeEnabled(chatResolvedAgentModeEnabled ?? null)
    }
  }, [hasChat, chatResolvedAgentModeEnabled])

  // Reconcile the local pause flag with the server's on EVERY fetch, not only
  // when the fetched value changes. Keying this on `chat?.isPaused` alone let
  // the two drift (bug 123): Resume flipped local state and persisted it but
  // left the fetched object saying paused, so when the server re-paused (a
  // chain error) the next fetch went paused→paused — no transition, no sync —
  // and the Salon kept reporting "not paused" while every message got exactly
  // one reply. `chat` is replaced wholesale by each fetch, so it is the right
  // key; a same-value set is a no-op for React.
  useEffect(() => {
    if (chat?.isPaused !== undefined) {
      setIsPaused(chat.isPaused)
    }
  }, [chat, setIsPaused])

  // Initialize documentEditingMode from chat data
  useEffect(() => {
    if (chat?.documentEditingMode !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic local copy of a chat field: re-seeded when the chat record changes, also set by the toggle handlers
      setDocumentEditingMode(chat.documentEditingMode)
    }
  }, [chat?.documentEditingMode])

  // Initialize allowCrossCharacterVaultReads from chat data
  useEffect(() => {
    if (chat?.allowCrossCharacterVaultReads !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic local copy of a chat field: re-seeded when the chat record changes, also set by the toggle handler
      setAllowCrossCharacterVaultReads(chat.allowCrossCharacterVaultReads)
    }
  }, [chat?.allowCrossCharacterVaultReads])

  // Fetch connection profiles for participant sidebar dropdowns, most used
  // for chat first (lib/llm/profile-usage.ts).
  const { data: profilesData } = useConnectionProfilesQuery<{ id: string; name: string; provider?: string; modelName?: string }>({ select: orderProfilesByChatUse })

  const connectionProfiles = useMemo(
    () => profilesData?.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      modelName: p.modelName,
    })) ?? [],
    [profilesData]
  )

  // Set the pause state and persist it. No rollback: a failed write leaves the
  // local pause in place and is only logged. The fetched chat object is updated
  // too, so it never disagrees with the local flag between fetches (bug 123).
  const setPauseState = useCallback(async (paused: boolean) => {
    setIsPaused(paused)
    setChat((prev) => (prev ? { ...prev, isPaused: paused } : prev))
    await persistChatField(chatId, { isPaused: paused }, 'pause state')
  }, [chatId, setIsPaused, setChat])

  // The four-position turn-mode control: Normal / Manual / Turns / Storyteller.
  // Manual is the pause, and pause and turn mode are independent (a paused
  // storyteller chat records posts without opening a round), so Manual keeps
  // the turn mode, and the other three each un-pause and set the mode.
  const setTurnPosition = useCallback(async (position: TurnPosition) => {
    if (position === 'manual') {
      await setPauseState(true)
      showInfoToast('Manual: nobody answers until you nudge them')
      return
    }
    const turnMode: ChatTurnMode = position === 'storyteller' ? 'storyteller'
      : position === 'turns' ? 'turns'
      : 'rotation'
    setIsPaused(false)
    setChat((prev) => (prev ? { ...prev, isPaused: false, turnMode } : prev))
    try {
      // turnMode rides beside `chat`, not in it: it is patch-only on the row
      // and has its own setter server-side.
      await putChatUpdate(chatId, { chat: { isPaused: false }, turnMode })
      showInfoToast(turnMode === 'storyteller'
        ? 'Storyteller mode: each of your posts asks the company who wishes to answer'
        : turnMode === 'turns'
          ? 'Turns: everyone has their say once, then the room waits for you'
          : 'Auto-responses resumed')
    } catch (error) {
      showErrorToast('Could not change the turn mode')
      console.error('[useChatControls] turn mode change failed', error)
    }
    await fetchChat()
  }, [chatId, setIsPaused, setChat, setPauseState, fetchChat])

  // Storyteller: the talkativeness invite filter (off = everyone is asked every round).
  const toggleStorytellerInviteFilter = useCallback(async () => {
    const next = !(chat?.storytellerInviteFilter === true)
    setChat((prev) => (prev ? { ...prev, storytellerInviteFilter: next } : prev))
    await persistChatField(chatId, { storytellerInviteFilter: next }, 'storyteller invite filter', () => {
      setChat((prev) => (prev ? { ...prev, storytellerInviteFilter: !next } : prev))
      showErrorToast('Could not change the invitation setting')
    })
  }, [chatId, chat?.storytellerInviteFilter, setChat])

  // Toggle pause state
  const togglePause = useCallback(async () => {
    const newPausedState = !isPaused
    await setPauseState(newPausedState)
    if (newPausedState) {
      showInfoToast('Auto-responses paused')
    } else {
      showInfoToast('Auto-responses resumed')
    }
  }, [isPaused, setPauseState])

  // Toggle cross-character vault reads and persist to database.
  // When on, characters in this chat may read (read-only) other present
  // participants' character vaults via the doc_* tools.
  const handleToggleCrossCharacterVaultReads = useCallback(async () => {
    const newValue = !allowCrossCharacterVaultReads
    setAllowCrossCharacterVaultReads(newValue)
    const ok = await persistChatField(
      chatId,
      { allowCrossCharacterVaultReads: newValue },
      'cross-character vault reads',
      () => {
        setAllowCrossCharacterVaultReads(!newValue)
        showErrorToast('Could not update shared-vault setting')
      },
    )
    if (ok) {
      showInfoToast(
        newValue
          ? 'Shared vault reads enabled — characters may peek at each other’s dossiers'
          : 'Shared vault reads disabled — each character is once more a closed book'
      )
    }
  }, [chatId, allowCrossCharacterVaultReads])

  // Toggle document editing mode and persist to database. No rollback, as
  // with the pause state.
  const handleToggleDocumentEditingMode = useCallback(async () => {
    const newMode = !documentEditingMode
    setDocumentEditingMode(newMode)
    await persistChatField(chatId, { documentEditingMode: newMode }, 'document editing mode')
  }, [chatId, documentEditingMode])

  const handleToggleAgentMode = useCallback(async () => {
    try {
      const newEnabled = agentModeEnabled === null || !agentModeEnabled;

      const data = await postChatAction<{ resolvedAgentModeEnabled?: boolean | null; agentModeEnabled?: boolean | null }>(
        chatId, 'toggle-agent-mode', { enabled: newEnabled },
      )
      setAgentModeEnabled((data.resolvedAgentModeEnabled ?? data.agentModeEnabled) as boolean | null)
      // Keep the chat record in step, so the next spread of it agrees (#262).
      setChat(prev => prev ? {
        ...prev,
        ...(data.agentModeEnabled !== undefined ? { agentModeEnabled: data.agentModeEnabled } : {}),
        resolvedAgentModeEnabled: data.resolvedAgentModeEnabled ?? undefined,
      } : prev)

      const status = data.resolvedAgentModeEnabled === true
        ? 'enabled'
        : data.resolvedAgentModeEnabled === false
        ? 'disabled'
        : 'set to inherit'

      showSuccessToast(`Agent mode ${status}`)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to toggle agent mode'))
    }
  }, [chatId, agentModeEnabled, setChat])

  const handleRegenerateBackground = useCallback(async () => {
    try {
      await postChatAction(chatId, 'regenerate-background')

      showSuccessToast('Story background regeneration queued')
      notifyQueueChange()

      startBackgroundPolling()
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to regenerate background'))
    }
  }, [chatId, startBackgroundPolling])

  // Character management handlers
  const handleCharacterAdded = useCallback(() => {
    fetchChat()
  }, [fetchChat])

  const handleOverrideDangerFlag = useCallback(async (messageId: string) => {
    if (!chat) return
    try {
      await apiFetch(`/api/v1/chats/${chat.id}/messages/${messageId}?action=override-danger-flag`, {
        method: 'POST',
      })
      await fetchChat()
    } catch (err) {
      // The blur stays, so say why (#306).
      if (!(err instanceof ApiFetchError)) console.error('Failed to override danger flag', err)
      showErrorToast(apiErrorMessage(err, 'Could not clear the danger flag on that message.'))
    }
  }, [chat, fetchChat])

  const handleRemoveCharacter = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'This character'

    if (streamingRef.current && turnState.lastSpeakerId === participantId) {
      showErrorToast(`Cannot remove ${characterName} while they are generating a response. Please wait for them to finish.`)
      return
    }

    const confirmed = await showConfirmation(
      `Remove ${characterName} from this chat? Their past messages will remain visible, but they will no longer participate in the conversation.`
    )

    if (!confirmed) {
      return
    }

    try {
      await postChatAction(chatId, 'remove-participant', { participantId })

      showSuccessToast(`${characterName} has been removed from the chat`)

      setTurnState(prev => ({
        ...prev,
        queue: prev.queue.filter(qId => qId !== participantId),
      }))

      await fetchChat()

      const remainingCharacters = participantsAsBase.filter(
        p => p.type === 'CHARACTER' && p.isActive && p.id !== participantId
      )

      if (remainingCharacters.length === 0) {
        showErrorToast('All characters have been removed. Add a character to continue the conversation.')
      }
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to remove character'))
    }
  }, [chatId, participantData, fetchChat, streamingRef, turnState.lastSpeakerId, participantsAsBase, setTurnState])

  /**
   * One `?action=update-participant` edit from the participant sidebar: send
   * it, toast `success` when given, re-read the chat; any failure toasts the
   * server's sentence or `failure`.
   */
  const updateParticipant = useCallback(async (
    participantId: string,
    changes: Record<string, unknown>,
    failure: string,
    success?: string,
  ) => {
    try {
      await postChatAction(chatId, 'update-participant', {
        updateParticipant: { participantId, ...changes },
      })
      if (success) showSuccessToast(success)
      await fetchChat()
    } catch (err) {
      showErrorToast(apiErrorMessage(err, failure))
    }
  }, [chatId, fetchChat])

  // Handle connection profile change from participant sidebar
  const handleConnectionProfileChange = useCallback((
    participantId: string,
    profileId: string | null,
    controlledBy: 'llm' | 'user'
  ) => updateParticipant(
    participantId,
    { connectionProfileId: controlledBy === 'user' ? undefined : profileId, controlledBy },
    'Failed to update connection profile',
    'Connection profile updated',
  ), [updateParticipant])

  // Handle system prompt change from participant sidebar
  const handleSystemPromptChange = useCallback((
    participantId: string,
    promptId: string | null
  ) => updateParticipant(
    participantId,
    { selectedSystemPromptId: promptId },
    'Failed to update system prompt',
    'System prompt updated',
  ), [updateParticipant])

  // Replace the set of subprompts in play for one participant. The server
  // recompiles the cached identity stack when the set actually changes.
  const handleSubpromptsChange = useCallback((
    participantId: string,
    subpromptIds: string[]
  ) => updateParticipant(
    participantId,
    { selectedSubpromptIds: subpromptIds },
    'Failed to update subprompts',
    'Subprompts updated',
  ), [updateParticipant])

  // Force-rebuild the cached system-prompt prefix for one participant —
  // picks up edits made to the underlying character record (manifesto,
  // personality, named systemPrompts, etc.) since the cache was last built.
  const handleRebuildSystemPrompt = useCallback(async (participantId: string) => {
    try {
      await postChatAction(chatId, 'rebuild-system-prompt', { participantId })

      showSuccessToast('System prompt rebuilt')
      await fetchChat()
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to rebuild system prompt'))
    }
  }, [chatId, fetchChat])

  // Handle participant settings change
  const handleParticipantSettingsChange = useCallback((
    participantId: string,
    updates: { isActive?: boolean; status?: 'active' | 'silent' | 'absent' | 'removed' }
  ) => updateParticipant(participantId, updates, 'Failed to update participant settings'), [updateParticipant])

  // Handle per-chat talkativeness override. Debounced so a slider drag fires
  // one request when the user releases, not on every value change.
  const talkativenessTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const handleTalkativenessChange = useCallback((participantId: string, value: number) => {
    // Clear any pending request for this participant.
    const pending = talkativenessTimerRef.current[participantId]
    if (pending) clearTimeout(pending)

    talkativenessTimerRef.current[participantId] = setTimeout(() => {
      delete talkativenessTimerRef.current[participantId]
      void updateParticipant(participantId, { talkativeness: value }, 'Failed to update talkativeness')
    }, 400)
  }, [updateParticipant])

  return {
    documentEditingMode,
    agentModeEnabled,
    allowCrossCharacterVaultReads,
    handleToggleCrossCharacterVaultReads,
    coreWhisperEnabled,
    coreWhisperInterval,
    handleSetCoreWhisperEnabled,
    handleSetCoreWhisperInterval,
    turnSkippingEnabled,
    handleSetTurnSkippingEnabled,
    showThinking,
    handleSetShowThinking,
    answerConfirmationOverride,
    handleSetAnswerConfirmationOverride,
    connectionProfiles,
    setPauseState,
    togglePause,
    setTurnPosition,
    toggleStorytellerInviteFilter,
    handleToggleDocumentEditingMode,
    handleToggleAgentMode,
    handleRegenerateBackground,
    handleCharacterAdded,
    handleOverrideDangerFlag,
    handleRemoveCharacter,
    handleConnectionProfileChange,
    handleSystemPromptChange,
    handleRebuildSystemPrompt,
    handleSubpromptsChange,
    handleParticipantSettingsChange,
    handleTalkativenessChange,
  }
}
