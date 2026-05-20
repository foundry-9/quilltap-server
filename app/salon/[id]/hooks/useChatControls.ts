'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { Chat, Message } from '../types'

interface UseChatControlsParams {
  chatId: string
  chat: Chat | null
  participantData: ParticipantData[]
  participantsAsBase: ChatParticipantBase[]
  isMultiChar: boolean
  isAllLLM: boolean
  allLLMTurnCount: number
  effectiveNextSpeakerId: string | null
  userParticipantId: string | null
  turnState: TurnState
  /** Ref to check if streaming is active (avoids circular dependency with SSE hook) */
  streamingRef: React.MutableRefObject<boolean>
  isPaused: boolean
  setIsPaused: (paused: boolean) => void
  fetchChat: () => Promise<void>
  setEphemeralMessages: React.Dispatch<React.SetStateAction<import('@/components/chat/EphemeralMessage').EphemeralMessageData[]>>
  setTurnState: React.Dispatch<React.SetStateAction<TurnState>>
  triggerContinueModeRef: React.MutableRefObject<(participantId: string) => Promise<void>>
  setChat: (fn: (prev: Chat | null) => Chat | null) => void
  startBackgroundPolling: () => void
}

export function useChatControls({
  chatId,
  chat,
  participantData,
  participantsAsBase,
  isMultiChar,
  isAllLLM,
  allLLMTurnCount,
  effectiveNextSpeakerId,
  userParticipantId,
  turnState,
  streamingRef,
  isPaused,
  setIsPaused,
  fetchChat,
  setEphemeralMessages,
  setTurnState,
  triggerContinueModeRef,
  setChat,
  startBackgroundPolling,
}: UseChatControlsParams) {
  // Local state
  const [documentEditingMode, setDocumentEditingMode] = useState(false)
  const [agentModeEnabled, setAgentModeEnabled] = useState<boolean | null>(null)
  const [storyBackgroundsEnabled, setStoryBackgroundsEnabled] = useState(false)
  const [allowCrossCharacterVaultReads, setAllowCrossCharacterVaultReads] = useState(false)

  // Refs
  const userStoppedStreamRef = useRef<boolean>(false)
  const lastAllLLMPauseTurnCountRef = useRef<number>(0)

  // Sync agentModeEnabled state when chat loads, using the resolved cascade value
  const chatResolvedAgentModeEnabled = chat?.resolvedAgentModeEnabled
  useEffect(() => {
    if (chat) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setAgentModeEnabled(chatResolvedAgentModeEnabled ?? null)
    }
  }, [chat, chatResolvedAgentModeEnabled])

  // Sync storyBackgroundsEnabled state when chatSettings loads - handled in page via chatSettings

  // Initialize isPaused from chat data
  useEffect(() => {
    if (chat?.isPaused !== undefined) {
      setIsPaused(chat.isPaused)
      if (chat.isPaused) {
        userStoppedStreamRef.current = true
      }
    }
  }, [chat?.isPaused, setIsPaused])

  // Initialize documentEditingMode from chat data
  useEffect(() => {
    if (chat?.documentEditingMode !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setDocumentEditingMode(chat.documentEditingMode)
    }
  }, [chat?.documentEditingMode])

  // Initialize allowCrossCharacterVaultReads from chat data
  useEffect(() => {
    if (chat?.allowCrossCharacterVaultReads !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by toggle handler
      setAllowCrossCharacterVaultReads(chat.allowCrossCharacterVaultReads)
    }
  }, [chat?.allowCrossCharacterVaultReads])

  // Initialize lastAllLLMPauseTurnCountRef when chat loads as paused
  useEffect(() => {
    if (chat?.isPaused && isAllLLM && allLLMTurnCount > 0) {
      lastAllLLMPauseTurnCountRef.current = allLLMTurnCount
    }
  }, [chat?.isPaused, isAllLLM, allLLMTurnCount])

  // Fetch connection profiles for participant sidebar dropdowns
  const { data: profilesData } = useSWR<{ profiles: Array<{ id: string; name: string; provider?: string; modelName?: string }> }>(
    '/api/v1/connection-profiles'
  )

  const connectionProfiles = useMemo(
    () => profilesData?.profiles?.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      modelName: p.modelName,
    })) ?? [],
    [profilesData]
  )

  // Function to set pause state and persist to database
  const setPauseState = useCallback(async (paused: boolean) => {
    setIsPaused(paused)
    userStoppedStreamRef.current = paused

    try {
      const response = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { isPaused: paused } }),
      })
      if (!response.ok) {
        console.error('[Chat] Failed to persist pause state', response.status)
      }
    } catch (error) {
      console.error('[Chat] Error persisting pause state', error)
    }
  }, [chatId, setIsPaused])

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

    try {
      const response = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { allowCrossCharacterVaultReads: newValue } }),
      })
      if (!response.ok) {
        console.error('[Chat] Failed to persist cross-character vault reads', response.status)
        setAllowCrossCharacterVaultReads(!newValue)
        showErrorToast('Could not update shared-vault setting')
        return
      }
      showInfoToast(
        newValue
          ? 'Shared vault reads enabled — characters may peek at each other’s dossiers'
          : 'Shared vault reads disabled — each character is once more a closed book'
      )
    } catch (error) {
      console.error('[Chat] Error persisting cross-character vault reads', error)
      setAllowCrossCharacterVaultReads(!newValue)
      showErrorToast('Could not update shared-vault setting')
    }
  }, [chatId, allowCrossCharacterVaultReads])

  // Toggle document editing mode and persist to database
  const handleToggleDocumentEditingMode = useCallback(async () => {
    const newMode = !documentEditingMode
    setDocumentEditingMode(newMode)

    try {
      const response = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { documentEditingMode: newMode } }),
      })
      if (!response.ok) {
        console.error('[Chat] Failed to persist document editing mode', response.status)
      }
    } catch (error) {
      console.error('[Chat] Error persisting document editing mode', error)
    }
  }, [chatId, documentEditingMode])

  const handleToggleAgentMode = useCallback(async () => {
    try {
      const newEnabled = agentModeEnabled === null || !agentModeEnabled;

      const res = await fetch(`/api/v1/chats/${chatId}?action=toggle-agent-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to toggle agent mode')
      }

      const data = await res.json()
      setAgentModeEnabled(data.resolvedAgentModeEnabled ?? data.agentModeEnabled)

      const status = data.resolvedAgentModeEnabled === true
        ? 'enabled'
        : data.resolvedAgentModeEnabled === false
        ? 'disabled'
        : 'set to inherit'

      showSuccessToast(`Agent mode ${status}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle agent mode')
    }
  }, [chatId, agentModeEnabled])

  const handleRegenerateBackground = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=regenerate-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to regenerate background')
      }

      showSuccessToast('Story background regeneration queued')
      notifyQueueChange()

      startBackgroundPolling()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to regenerate background')
    }
  }, [chatId, startBackgroundPolling])

  // Character management handlers
  const handleCharacterAdded = useCallback(() => {
    fetchChat()
  }, [fetchChat])

  const handleReattribute = useCallback((messageId: string, messages: Message[]) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      return {
        isOpen: true,
        messageId,
        currentParticipantId: message.participantId || null,
      }
    }
    return null
  }, [])

  const handleOverrideDangerFlag = useCallback(async (messageId: string) => {
    if (!chat) return
    try {
      const res = await fetch(`/api/v1/chats/${chat.id}/messages/${messageId}?action=override-danger-flag`, {
        method: 'POST',
      })
      if (res.ok) {
        await fetchChat()
      }
    } catch (err) {
      console.error('Failed to override danger flag', err)
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
      const res = await fetch(`/api/v1/chats/${chatId}?action=remove-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to remove character')
      }

      showSuccessToast(`${characterName} has been removed from the chat`)

      setEphemeralMessages(prev => prev.filter(em => em.participantId !== participantId))
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to remove character')
    }
  }, [chatId, participantData, fetchChat, streamingRef, turnState.lastSpeakerId, participantsAsBase, setEphemeralMessages, setTurnState])

  // Handle connection profile change from participant sidebar
  const handleConnectionProfileChange = useCallback(async (
    participantId: string,
    profileId: string | null,
    controlledBy: 'llm' | 'user'
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=update-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateParticipant: {
            participantId,
            connectionProfileId: controlledBy === 'user' ? undefined : profileId,
            controlledBy,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to update connection profile')
      }

      showSuccessToast('Connection profile updated')
      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update connection profile')
    }
  }, [chatId, fetchChat])

  // Handle system prompt change from participant sidebar
  const handleSystemPromptChange = useCallback(async (
    participantId: string,
    promptId: string | null
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=update-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateParticipant: {
            participantId,
            selectedSystemPromptId: promptId,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to update system prompt')
      }

      showSuccessToast('System prompt updated')
      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update system prompt')
    }
  }, [chatId, fetchChat])

  // Force-rebuild the cached system-prompt prefix for one participant —
  // picks up edits made to the underlying character record (manifesto,
  // personality, named systemPrompts, etc.) since the cache was last built.
  const handleRebuildSystemPrompt = useCallback(async (participantId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=rebuild-system-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to rebuild system prompt')
      }

      showSuccessToast('System prompt rebuilt')
      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to rebuild system prompt')
    }
  }, [chatId, fetchChat])

  // Handle participant settings change
  const handleParticipantSettingsChange = useCallback(async (
    participantId: string,
    updates: { isActive?: boolean; status?: 'active' | 'silent' | 'absent' | 'removed' }
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=update-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateParticipant: {
            participantId,
            ...updates,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to update participant settings')
      }

      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update participant settings')
    }
  }, [chatId, fetchChat])

  // All-LLM pause handlers
  const handleAllLLMContinue = useCallback(() => {
    // The caller should close the modal
  }, [])

  const handleAllLLMStop = useCallback(() => {
    setPauseState(true)
  }, [setPauseState])

  return {
    documentEditingMode,
    agentModeEnabled,
    storyBackgroundsEnabled, setStoryBackgroundsEnabled,
    allowCrossCharacterVaultReads,
    handleToggleCrossCharacterVaultReads,
    connectionProfiles,
    userStoppedStreamRef,
    setPauseState,
    togglePause,
    handleToggleDocumentEditingMode,
    handleToggleAgentMode,
    handleRegenerateBackground,
    handleCharacterAdded,
    handleReattribute,
    handleOverrideDangerFlag,
    handleRemoveCharacter,
    handleConnectionProfileChange,
    handleSystemPromptChange,
    handleRebuildSystemPrompt,
    handleParticipantSettingsChange,
    handleAllLLMContinue,
    handleAllLLMStop,
  }
}
