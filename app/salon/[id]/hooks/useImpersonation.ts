'use client'

import { useState, useEffect, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { postChatAction } from './chat-actions'
import type { Chat } from '../types'
import type { SelectLLMProfileDialogState } from './useModalState'

interface UseImpersonationParams {
  chatId: string
  chat: Chat | null
  fetchChat: () => Promise<void>
  setSelectLLMProfileDialogState: (state: SelectLLMProfileDialogState | null) => void
}

/** What the impersonation actions answer with. */
interface ImpersonationResponse {
  impersonatingParticipantIds?: string[]
  activeTypingParticipantId?: string | null
}

export function useImpersonation({
  chatId,
  chat,
  fetchChat,
  setSelectLLMProfileDialogState,
}: UseImpersonationParams) {
  const [impersonatingParticipantIds, setImpersonatingParticipantIds] = useState<string[]>([])
  const [activeTypingParticipantId, setActiveTypingParticipantId] = useState<string | null>(null)
  const [allLLMPauseTurnCount, setAllLLMPauseTurnCount] = useState(0)
  const chatParticipants = chat?.participants

  // Initialize/sync impersonation state from chat metadata
  useEffect(() => {
    const impersonatingIds = chat?.impersonatingParticipantIds
    const activeTypingId = chat?.activeTypingParticipantId
    const pauseTurnCount = chat?.allLLMPauseTurnCount

    if (impersonatingIds && impersonatingIds.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user state must re-sync when chat prop changes (parent renders unconditionally)
      setImpersonatingParticipantIds(impersonatingIds)
      // The persisted `activeTypingParticipantId` is only the INITIAL default for
      // "speaking as". It must not be re-applied on every chat refetch, or it
      // clobbers the turn-follow (Bug 49) and any manual SpeakerSelector choice —
      // the composer would snap back to the stale persisted seat after each turn,
      // so one seat "hogs" every turn. Seed it once (when still unset); the
      // turn-follow and the set-active-speaker handler own it thereafter.
      setActiveTypingParticipantId(prev => prev ?? activeTypingId ?? null)
    }
    if (pauseTurnCount !== undefined) {
      setAllLLMPauseTurnCount(pauseTurnCount)
    }
  }, [chat?.impersonatingParticipantIds, chat?.activeTypingParticipantId, chat?.allLLMPauseTurnCount])

  const handleStartImpersonation = useCallback(async (participantId: string) => {
    const participant = chatParticipants?.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const data = await postChatAction<ImpersonationResponse>(chatId, 'impersonate', { participantId })

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || participantId)

      showSuccessToast(`Now speaking as ${characterName}`)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to start impersonation'))
    }
  }, [chatId, chatParticipants])

  const handleStopImpersonation = useCallback(async (participantId: string) => {
    const participant = chatParticipants?.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    // Check if we need to show the LLM profile selection dialog
    const character = participant?.character
    if (character && !participant?.connectionProfile) {
      setSelectLLMProfileDialogState({
        isOpen: true,
        participantId,
        character: {
          id: character.id,
          name: character.name,
          defaultImage: character.defaultImage,
          avatarUrl: character.avatarUrl,
          defaultConnectionProfileId: null,
        },
      })
      return
    }

    try {
      const data = await postChatAction<ImpersonationResponse>(chatId, 'stop-impersonate', { participantId }, 'DELETE')

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`Stopped speaking as ${characterName}`)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to stop impersonation'))
    }
  }, [chatId, chatParticipants, setSelectLLMProfileDialogState])

  const handleConfirmStopImpersonation = useCallback(async (participantId: string, connectionProfileId: string) => {
    const participant = chatParticipants?.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const data = await postChatAction<ImpersonationResponse>(chatId, 'stop-impersonate', { participantId, newConnectionProfileId: connectionProfileId }, 'DELETE')

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`${characterName} is now controlled by AI`)

      await fetchChat()
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to stop impersonation'))
    }
  }, [chatId, chatParticipants, fetchChat])

  const handleSetActiveSpeaker = useCallback(async (participantId: string) => {
    try {
      const data = await postChatAction<ImpersonationResponse>(chatId, 'set-active-speaker', { participantId })
      setActiveTypingParticipantId(participantId)

      if (data.impersonatingParticipantIds) {
        setImpersonatingParticipantIds(data.impersonatingParticipantIds)
      }
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'Failed to set active speaker'))
    }
  }, [chatId])

  return {
    impersonatingParticipantIds,
    setImpersonatingParticipantIds,
    activeTypingParticipantId,
    setActiveTypingParticipantId,
    allLLMPauseTurnCount,
    setAllLLMPauseTurnCount,
    handleStartImpersonation,
    handleStopImpersonation,
    handleConfirmStopImpersonation,
    handleSetActiveSpeaker,
  }
}
