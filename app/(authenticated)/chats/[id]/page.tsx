'use client'

import { use, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import ImageModal from '@/components/chat/ImageModal'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import ToolPalette from '@/components/chat/ToolPalette'
import MobileToolPalette from '@/components/chat/MobileToolPalette'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import GenerateImageDialog from '@/components/chat/GenerateImageDialog'
import ParticipantSidebar from '@/components/chat/ParticipantSidebar'
import MobileParticipantDropdown from '@/components/chat/MobileParticipantDropdown'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import {
  EphemeralMessage,
  createEphemeralMessage,
  type EphemeralMessageData,
} from '@/components/chat/EphemeralMessage'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'
import { safeJsonParse } from '@/lib/fetch-helpers'
import { clientLogger } from '@/lib/client-logger'
import { getErrorMessage } from '@/lib/error-utils'
import MessageContent from '@/components/chat/MessageContent'
import ToolMessage from '@/components/chat/ToolMessage'
import { formatMessageTime } from '@/lib/format-time'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import Avatar, { getAvatarSrc } from '@/components/ui/Avatar'
import { useDebugOptional } from '@/components/providers/debug-provider'
import { useChatContext } from '@/components/providers/chat-context'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import {
  type TurnState,
  type TurnSelectionResult,
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  findUserParticipant,
  isMultiCharacterChat,
  getQueuePosition,
  resetCycleForUserSkip,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'

// Import extracted hooks
import {
  useChatData,
  useTurnManagement,
  useMessageActions,
  useFileAttachments,
  type SwipeState,
} from './hooks'
import type { Chat, ChatSettings, Message, Participant, CharacterData } from './types'
import {
  StreamingMessage,
  MessageRow,
  ChatComposer,
  PendingToolCalls,
  EphemeralMessages as EphemeralMessagesComponent,
} from './components'

// Inline the large sendMessage and other complex functions that need to stay in page.tsx
// These depend on too many page-level state variables to extract cleanly

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  useAvatarDisplay()
  const debug = useDebugOptional()

  // Use the extracted chat data hook
  const chatDataHook = useChatData(id)
  const { chat, messages, loading, error, chatSettings, swipeStates, chatPhotoCount, chatMemoryCount } = chatDataHook
  const { setChat, setMessages, setSwipeStates } = chatDataHook
  const { fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount, persistTurnState } = chatDataHook

  // UI state
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [roleplayTemplateName, setRoleplayTemplateName] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false)
  const [mobileToolPaletteOpen, setMobileToolPaletteOpen] = useState(false)
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [toolExecutionStatus, setToolExecutionStatus] = useState<{ tool: string; status: 'pending' | 'success' | 'error'; message: string } | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ id: string; name: string; status: 'pending' | 'success' | 'error'; result?: unknown; arguments?: Record<string, unknown> }>>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [mobileParticipantDropdownId, setMobileParticipantDropdownId] = useState<string | null>(null)

  // Use the extracted file attachments hook
  const fileHook = useFileAttachments(id)
  const { attachedFiles, setAttachedFiles, uploadingFile } = fileHook
  const { handleFileSelect, removeAttachedFile } = fileHook

  // Refs
  const mobileParticipantRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const lastAutoTriggeredRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mobileToolPaletteToggleRef = useRef<HTMLButtonElement>(null)
  const desktopToolPaletteToggleRef = useRef<HTMLButtonElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const userStoppedStreamRef = useRef<boolean>(false)
  const hasRestoredTurnStateRef = useRef<boolean>(false)

  const chatContext = useChatContext()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0
  const isCurrentChat = chatContext.chatId === id
  const chatTags = chatContext.tags.map(tag => tag.id)
  const awaitingTagInfo = quickHideActive && isCurrentChat && !chatContext.tagsFetched
  const chatHidden = quickHideActive && isCurrentChat && chatContext.tagsFetched && shouldHideByIds(chatTags)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const getTextareaMaxHeight = useCallback(() => {
    if (typeof globalThis === 'undefined' || !globalThis.window) return 200
    const windowHeight = globalThis.window.innerHeight
    const isMobile = globalThis.window.matchMedia('(max-width: 768px)').matches
    if (isMobile) {
      const navbarHeight = 64
      const paletteReserved = windowHeight * 0.5
      const composerChrome = 96
      return Math.max(40, windowHeight - navbarHeight - paletteReserved - composerChrome)
    }
    return windowHeight / 3
  }, [])

  const resizeTextarea = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto'
    const maxHeight = getTextareaMaxHeight()
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = newHeight + 'px'
  }, [getTextareaMaxHeight])

  // Helper functions to get character/persona from participants
  const getFirstCharacterParticipant = () => {
    return chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)
  }

  const getFirstPersonaParticipant = () => {
    return chat?.participants.find(p => p.type === 'PERSONA' && p.isActive)
  }

  const getFirstCharacter = () => getFirstCharacterParticipant()?.character
  const getFirstPersona = () => getFirstPersonaParticipant()?.persona
  const getFirstConnectionProfile = () => getFirstCharacterParticipant()?.connectionProfile

  const getRespondingCharacter = () => {
    if (respondingParticipantId) {
      const participant = chat?.participants.find(p => p.id === respondingParticipantId)
      if (participant?.character) {
        return participant.character
      }
    }
    return getFirstCharacter()
  }

  // Multi-character chat helpers
  const participantsAsBase = useMemo((): ChatParticipantBase[] => {
    if (!chat?.participants) return []
    return chat.participants.map(p => ({
      id: p.id,
      type: p.type,
      characterId: p.characterId ?? (p.character?.id ?? null),
      personaId: p.personaId ?? (p.persona?.id ?? null),
      connectionProfileId: p.connectionProfile?.id ?? null,
      imageProfileId: p.imageProfile?.id ?? null,
      systemPromptOverride: p.systemPromptOverride ?? null,
      displayOrder: p.displayOrder,
      isActive: p.isActive,
      hasHistoryAccess: p.hasHistoryAccess ?? false,
      joinScenario: p.joinScenario ?? null,
      createdAt: p.createdAt ?? new Date().toISOString(),
      updatedAt: p.updatedAt ?? new Date().toISOString(),
    }))
  }, [chat?.participants])

  const userParticipantId = useMemo(() => {
    if (participantsAsBase.length === 0) return null
    const userParticipant = findUserParticipant(participantsAsBase)
    return userParticipant?.id ?? null
  }, [participantsAsBase])

  const isMultiChar = useMemo(() => {
    if (participantsAsBase.length === 0) return false
    return isMultiCharacterChat(participantsAsBase)
  }, [participantsAsBase])

  const hasActiveCharacters = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length > 0
  }, [participantsAsBase])

  const isSingleCharacterChat = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length === 1
  }, [participantsAsBase])

  const charactersMap = useMemo((): Map<string, Character> => {
    const map = new Map<string, Character>()
    if (!chat?.participants) return map
    chat.participants.forEach(p => {
      if (p.type === 'CHARACTER' && p.character) {
        map.set(p.character.id, {
          id: p.character.id,
          userId: '',
          name: p.character.name,
          talkativeness: p.character.talkativeness ?? 0.5,
          isFavorite: false,
          createdAt: '',
          updatedAt: '',
        } as Character)
      }
    })
    return map
  }, [chat?.participants])

  const participantData: ParticipantData[] = useMemo(() => {
    if (!chat?.participants) return []
    return chat.participants.map(p => ({
      id: p.id,
      type: p.type,
      displayOrder: p.displayOrder,
      isActive: p.isActive,
      character: p.character ? {
        id: p.character.id,
        name: p.character.name,
        title: p.character.title,
        avatarUrl: p.character.avatarUrl,
        talkativeness: p.character.talkativeness ?? 0.5,
        defaultImage: p.character.defaultImage,
      } : null,
      persona: p.persona ? {
        id: p.persona.id,
        name: p.persona.name,
        title: p.persona.title,
        avatarUrl: p.persona.avatarUrl,
        defaultImage: p.persona.defaultImage,
      } : null,
      connectionProfile: p.connectionProfile,
    }))
  }, [chat?.participants])

  const getParticipantById = useCallback((participantId: string | null | undefined) => {
    if (!participantId || !chat?.participants) return null
    return chat.participants.find(p => p.id === participantId) ?? null
  }, [chat?.participants])

  // Use the extracted message actions hook
  const messageActions = useMessageActions(
    messages,
    setMessages,
    setEditingMessageId,
    setEditContent,
    setViewSourceMessageIds,
    editingMessageId,
    editContent,
    viewSourceMessageIds,
    setInput,
    setAttachedFiles,
    inputRef as React.RefObject<HTMLTextAreaElement>,
  )

  // Use the extracted turn management hook
  const turnManagement = useTurnManagement(
    participantsAsBase,
    charactersMap,
    turnState,
    userParticipantId,
    participantData,
    ephemeralMessages,
    setTurnState,
    setTurnSelectionResult,
    setEphemeralMessages,
    async (participantId: string) => {
      // Trigger continue mode - implementation below
      await triggerContinueMode(participantId)
    },
  )

  // Calculate turn state when messages change - copied from original
  useEffect(() => {
    if (participantsAsBase.length === 0 || messages.length === 0) return

    clientLogger.debug('[Chat] Calculating turn state from messages', {
      messageCount: messages.length,
      participantCount: participantsAsBase.length,
    })

    const messageEvents = messages.map(m => ({
      type: 'message' as const,
      id: m.id,
      role: m.role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
      content: m.content,
      participantId: m.participantId,
      createdAt: m.createdAt,
      attachments: m.attachments?.map(a => a.id) ?? [],
    }))

    const newTurnState = calculateTurnStateFromHistory({
      messages: messageEvents,
      participants: participantsAsBase,
      userParticipantId,
    })

    setTurnState(newTurnState)

    let result = selectNextSpeaker(
      participantsAsBase,
      charactersMap,
      newTurnState,
      userParticipantId
    )

    if (!hasRestoredTurnStateRef.current && chat?.lastTurnParticipantId !== undefined) {
      hasRestoredTurnStateRef.current = true
      const persistedParticipantId = chat.lastTurnParticipantId

      if (persistedParticipantId === null) {
        if (result.nextSpeakerId !== null) {
          clientLogger.debug('[Chat] Restoring persisted turn state: user\'s turn', {
            calculatedNextSpeaker: result.nextSpeakerId,
          })
          result = {
            ...result,
            nextSpeakerId: null,
            reason: 'user_turn',
          }
        }
      } else {
        const persistedParticipant = participantsAsBase.find(
          p => p.id === persistedParticipantId && p.isActive
        )
        if (persistedParticipant && result.nextSpeakerId !== persistedParticipantId) {
          clientLogger.debug('[Chat] Restoring persisted turn state', {
            persistedParticipantId,
            calculatedNextSpeaker: result.nextSpeakerId,
          })
          result = {
            ...result,
            nextSpeakerId: persistedParticipantId,
            reason: 'queue',
          }
        }
      }
    }

    setTurnSelectionResult(result)

    clientLogger.debug('[Chat] Turn state calculated', {
      nextSpeakerId: result.nextSpeakerId,
      reason: result.reason,
      cycleComplete: result.cycleComplete,
    })
  }, [messages, participantsAsBase, userParticipantId, charactersMap, chat?.lastTurnParticipantId])

  // triggerContinueMode function - large streaming logic kept in place
  const triggerContinueMode = useCallback(async (participantId: string) => {
    if (streaming || waitingForResponse) {
      clientLogger.debug('[Chat] Skipping continue mode - already generating')
      return
    }

    const participant = participantsAsBase.find(p => p.id === participantId && p.isActive)
    if (!participant) {
      clientLogger.warn('[Chat] Cannot trigger continue mode - participant not found or inactive', {
        participantId,
      })
      showErrorToast('This participant is no longer available in the chat.')
      return
    }

    if (!turnManagement.hasActiveCharacters) {
      clientLogger.warn('[Chat] No active characters available for continue mode')
      showErrorToast('No characters available. Add a character to continue the conversation.')
      return
    }

    clientLogger.debug('[Chat] Triggering continue mode for participant', { participantId })

    setWaitingForResponse(true)
    setStreaming(false)
    setStreamingContent('')
    setRespondingParticipantId(participantId)
    clientLogger.debug('[Chat] Set responding participant for streaming', { participantId })

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          continueMode: true,
          respondingParticipantId: participantId,
        }),
        signal,
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to trigger response')
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No response body')

      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim()
            if (!rawData || rawData === '[DONE]' || rawData === '{}') {
              continue
            }
            try {
              const data = JSON.parse(rawData)

              if (data.content) {
                fullContent += data.content
                setWaitingForResponse(false)
                setStreaming(true)
                setStreamingContent(fullContent)
              }

              if (data.done) {
                if (fullContent.trim()) {
                  const newMessage: Message = {
                    id: data.messageId || `continue-${Date.now()}`,
                    role: 'ASSISTANT',
                    content: fullContent,
                    createdAt: new Date().toISOString(),
                    participantId,
                  }
                  setMessages(prev => [...prev, newMessage])
                }

                setEphemeralMessages(prev =>
                  prev.filter(em => em.participantId !== participantId)
                )

                if (data.turn) {
                  clientLogger.debug('[Chat] Turn info from continue mode', data.turn)
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (isAbort) {
        clientLogger.debug('[Chat] Continue mode aborted by user')
      } else {
        clientLogger.error('[Chat] Continue mode error:', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast(err instanceof Error ? err.message : 'Failed to generate response')
      }
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      setStreamingContent('')
      setRespondingParticipantId(null)
      abortControllerRef.current = null
      scrollToBottom()
    }
  }, [id, streaming, waitingForResponse, participantsAsBase, turnManagement.hasActiveCharacters, setMessages, setEphemeralMessages])

  // Auto-trigger next character in multi-character mode
  useEffect(() => {
    if (!isMultiChar) {
      clientLogger.debug('[Chat] Auto-trigger skipped - not multi-character mode')
      return
    }

    if (userStoppedStreamRef.current) {
      clientLogger.debug('[Chat] Auto-trigger skipped - user stopped streaming')
      return
    }

    if (streaming || waitingForResponse) {
      return
    }

    if (!turnSelectionResult) {
      clientLogger.debug('[Chat] Auto-trigger skipped - no turn selection result')
      return
    }

    if (turnSelectionResult.nextSpeakerId === null) {
      clientLogger.debug('[Chat] Auto-trigger skipped - user\'s turn')
      lastAutoTriggeredRef.current = null
      return
    }

    if (turnSelectionResult.nextSpeakerId === userParticipantId) {
      clientLogger.debug('[Chat] Auto-trigger skipped - next speaker is user')
      return
    }

    const nextSpeakerId = turnSelectionResult.nextSpeakerId

    if (lastAutoTriggeredRef.current === nextSpeakerId) {
      clientLogger.debug('[Chat] Auto-trigger skipped - same participant already triggered')
      return
    }

    clientLogger.info('[Chat] Auto-triggering next character in multi-character mode', {
      nextSpeakerId,
      reason: turnSelectionResult.reason,
    })

    lastAutoTriggeredRef.current = nextSpeakerId

    const timeoutId = setTimeout(() => {
      triggerContinueMode(nextSpeakerId)
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [isMultiChar, streaming, waitingForResponse, turnSelectionResult, userParticipantId, triggerContinueMode])

  // stopStreaming function
  const stopStreaming = useCallback(() => {
    clientLogger.debug('[Chat] Stopping streaming response')
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setWaitingForResponse(false)
    setSending(false)
    setRespondingParticipantId(null)
    setPendingToolCalls([])
    setToolExecutionStatus(null)
    if (isMultiChar) {
      clientLogger.debug('[Chat] Setting userStoppedStreamRef to prevent auto-triggering')
      userStoppedStreamRef.current = true
    }
    if (streamingContent) {
      clientLogger.debug('[Chat] Streaming stopped with partial content', {
        contentLength: streamingContent.length,
      })
      showInfoToast('Response stopped - your turn to speak')
    }
    setStreamingContent('')
  }, [streamingContent, isMultiChar])

  // Persist turn state effect
  useEffect(() => {
    if (!isMultiChar) return
    if (streaming || waitingForResponse) return
    if (turnSelectionResult === null) return

    persistTurnState(turnSelectionResult.nextSpeakerId)
  }, [isMultiChar, streaming, waitingForResponse, turnSelectionResult, persistTurnState])

  // Character management handlers
  const handleAddCharacter = useCallback(() => {
    clientLogger.debug('[Chat] Opening add character dialog')
    setAddCharacterDialogOpen(true)
  }, [])

  const handleCharacterAdded = useCallback(() => {
    clientLogger.info('[Chat] Character added, refreshing chat data')
    fetchChat()
  }, [fetchChat])

  const handleRemoveCharacter = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'This character'

    clientLogger.debug('[Chat] Requesting character removal', {
      participantId,
      characterName,
      isGenerating: streaming || waitingForResponse,
      currentSpeakerId: turnState.lastSpeakerId,
    })

    if ((streaming || waitingForResponse) && turnState.lastSpeakerId === participantId) {
      clientLogger.warn('[Chat] Cannot remove character while they are generating')
      showErrorToast(`Cannot remove ${characterName} while they are generating a response. Please wait for them to finish.`)
      return
    }

    const confirmed = await showConfirmation(
      `Remove ${characterName} from this chat? Their past messages will remain visible, but they will no longer participate in the conversation.`
    )

    if (!confirmed) {
      clientLogger.debug('[Chat] Character removal cancelled by user')
      return
    }

    try {
      const res = await fetch(`/api/chats/${id}/participants`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to remove character')
      }

      clientLogger.info('[Chat] Character removed successfully', { participantId, characterName })
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
        clientLogger.warn('[Chat] No active characters remain in chat')
        showErrorToast('All characters have been removed. Add a character to continue the conversation.')
      }
    } catch (err) {
      clientLogger.error('[Chat] Error removing character', {
        error: err instanceof Error ? err.message : String(err),
        participantId,
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to remove character')
    }
  }, [id, participantData, fetchChat, streaming, waitingForResponse, turnState.lastSpeakerId, participantsAsBase])

  // Handle memories
  const handleDeleteChatMemories = useCallback(async () => {
    if (chatMemoryCount === 0) {
      clientLogger.debug('[Chat] No memories to delete')
      return
    }

    const confirmed = await showConfirmation(
      `Delete all ${chatMemoryCount} memories created from this chat? This action cannot be undone.`
    )

    if (!confirmed) {
      clientLogger.debug('[Chat] Memory deletion cancelled by user')
      return
    }

    try {
      clientLogger.info('[Chat] Deleting chat memories', { chatId: id, memoryCount: chatMemoryCount })
      const res = await fetch(`/api/chats/${id}/memories`, { method: 'DELETE' })

      if (res.ok) {
        const data = await res.json()
        clientLogger.info('[Chat] Chat memories deleted successfully', { deletedCount: data.deletedCount })
        chatDataHook.setChatMemoryCount(0)
        showSuccessToast(`Deleted ${data.deletedCount} memories`)
      } else {
        const errorData = await res.json()
        clientLogger.error('[Chat] Failed to delete chat memories', { error: errorData.error })
        showErrorToast(`Failed to delete memories: ${errorData.error}`)
      }
    } catch (err) {
      clientLogger.error('[Chat] Error deleting chat memories', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast('Failed to delete memories')
    }
  }, [id, chatMemoryCount, chatDataHook])

  const handleReextractMemories = useCallback(async () => {
    const characterParticipant = chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)
    if (!characterParticipant?.character || !characterParticipant.connectionProfile) {
      clientLogger.warn('[Chat] Cannot re-extract memories: no character or connection profile')
      showErrorToast('Cannot re-extract memories: no character or connection profile configured')
      return
    }

    const confirmed = await showConfirmation(
      `Queue memory extraction jobs for all messages in this chat? This will process the entire conversation history.`
    )

    if (!confirmed) {
      clientLogger.debug('[Chat] Memory re-extraction cancelled by user')
      return
    }

    try {
      clientLogger.info('[Chat] Queueing memory extraction', {
        chatId: id,
        characterId: characterParticipant.character.id,
        characterName: characterParticipant.character.name,
      })

      const res = await fetch(`/api/chats/${id}/queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: characterParticipant.character.id,
          characterName: characterParticipant.character.name,
          connectionProfileId: characterParticipant.connectionProfile.id,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        clientLogger.info('[Chat] Memory extraction jobs queued', { jobCount: data.jobCount })
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
      } else {
        const errorData = await res.json()
        clientLogger.error('[Chat] Failed to queue memory extraction', { error: errorData.error })
        showErrorToast(`Failed to queue memory extraction: ${errorData.error}`)
      }
    } catch (err) {
      clientLogger.error('[Chat] Error queueing memory extraction', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast('Failed to queue memory extraction')
    }
  }, [id, chat])

  // Initialization effects
  useEffect(() => {
    fetchChat()
    fetchChatSettings()
    fetchChatPhotoCount()
    fetchChatMemoryCount()
  }, [fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount])

  useEffect(() => {
    const fetchTemplateName = async () => {
      if (!chat?.roleplayTemplateId) {
        setRoleplayTemplateName(null)
        return
      }

      try {
        const res = await fetch(`/api/roleplay-templates/${chat.roleplayTemplateId}`)
        if (res.ok) {
          const template = await res.json()
          setRoleplayTemplateName(template.name)
          clientLogger.debug('[Chat] Fetched roleplay template name', {
            templateId: chat.roleplayTemplateId,
            templateName: template.name,
          })
        } else {
          setRoleplayTemplateName(null)
        }
      } catch (err) {
        clientLogger.error('[Chat] Error fetching roleplay template', {
          error: err instanceof Error ? err.message : String(err),
        })
        setRoleplayTemplateName(null)
      }
    }

    fetchTemplateName()
  }, [chat?.roleplayTemplateId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (inputRef.current) {
        resizeTextarea(inputRef.current)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [resizeTextarea])

  useEffect(() => {
    const handleResize = () => {
      if (inputRef.current) {
        resizeTextarea(inputRef.current)
      }
    }

    globalThis.window?.addEventListener('resize', handleResize)
    return () => globalThis.window?.removeEventListener('resize', handleResize)
  }, [resizeTextarea])

  // UI helper functions
  const shouldShowAvatars = () => {
    if (!chatSettings) return true
    return chatSettings.avatarDisplayMode === 'ALWAYS'
  }

  const getMessageAvatar = (message: Message) => {
    if (message.participantId) {
      const participant = getParticipantById(message.participantId)
      if (participant) {
        if (participant.type === 'CHARACTER' && participant.character) {
          return {
            name: participant.character.name,
            title: participant.character.title,
            avatarUrl: participant.character.avatarUrl,
            defaultImage: participant.character.defaultImage,
          }
        } else if (participant.type === 'PERSONA' && participant.persona) {
          return {
            name: participant.persona.name,
            title: participant.persona.title,
            avatarUrl: participant.persona.avatarUrl,
            defaultImage: participant.persona.defaultImage,
          }
        }
      }
    }

    if (message.role === 'USER') {
      const persona = getFirstPersona()
      if (persona) {
        return {
          name: persona.name,
          title: persona.title,
          avatarUrl: persona.avatarUrl,
          defaultImage: persona.defaultImage,
        }
      } else if (chat?.user) {
        return {
          name: chat.user.name || 'User',
          title: null,
          avatarUrl: chat.user.image,
          defaultImage: null,
        }
      }
    } else if (message.role === 'ASSISTANT') {
      const character = getFirstCharacter()
      if (character) {
        return {
          name: character.name,
          title: character.title,
          avatarUrl: character.avatarUrl,
          defaultImage: character.defaultImage,
        }
      }
    }
    return null
  }

  const getImageAttachments = (message: Message) => {
    return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
  }

  if (awaitingTagInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Loading chat...</p>
      </div>
    )
  }

  if (chatHidden) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <HiddenPlaceholder />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading chat...</p>
      </div>
    )
  }

  if (error || !chat) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-destructive">Error: {error || 'Chat not found'}</p>
      </div>
    )
  }

  const shouldShowParticipantSidebar = isMultiChar && showParticipantSidebar

  return (
    <div className="qt-chat-layout">
      <div className="qt-chat-main">
        <div className="qt-chat-messages">
          <div className="qt-chat-messages-list">
            {/* Messages rendering */}
            {messages.map((message, messageIndex) => {
              const isEditing = editingMessageId === message.id
              const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null
              const showResendButton = messageActions.canResendMessage(message.id, messageIndex)

              if (message.role === 'TOOL') {
                return (
                  <ToolMessage
                    key={message.id}
                    message={message}
                    character={getFirstCharacter() ?? undefined}
                    onImageClick={(filepath, filename, fileId) => {
                      setModalImage({ src: filepath, filename, fileId })
                    }}
                  />
                )
              }

              const messageAvatarData = shouldShowAvatars() ? getMessageAvatar(message) : null
              const messageAvatar = messageAvatarData as any

              return (
                <MessageRow
                  key={message.id}
                  message={message}
                  messageIndex={messageIndex}
                  isEditing={isEditing}
                  editContent={editContent}
                  viewSourceMessageIds={viewSourceMessageIds}
                  swipeState={swipeState}
                  showResendButton={showResendButton}
                  shouldShowAvatars={shouldShowAvatars()}
                  messageAvatar={messageAvatar}
                  roleplayTemplateName={roleplayTemplateName}
                  isMultiChar={isMultiChar}
                  participantData={participantData}
                  turnState={turnState}
                  streaming={streaming}
                  waitingForResponse={waitingForResponse}
                  mobileParticipantDropdownId={mobileParticipantDropdownId}
                  mobileParticipantRefs={mobileParticipantRefs}
                  userParticipantId={userParticipantId}
                  onEditStart={messageActions.startEdit}
                  onEditSave={messageActions.saveEdit}
                  onEditCancel={messageActions.cancelEdit}
                  onEditChange={setEditContent}
                  onToggleSourceView={messageActions.toggleSourceView}
                  onDelete={messageActions.deleteMessage}
                  onGenerateSwipe={(msgId) => messageActions.generateSwipe(msgId, fetchChat)}
                  onSwitchSwipe={(groupId, dir) => messageActions.switchSwipe(groupId, dir, swipeStates, setSwipeStates)}
                  onCopyContent={messageActions.copyMessageContent}
                  onResend={messageActions.resendMessage}
                  onImageClick={(filepath, filename, fileId) => {
                    setModalImage({ src: filepath, filename, fileId })
                  }}
                  onMobileParticipantDropdownChange={setMobileParticipantDropdownId}
                  onHandleNudge={turnManagement.handleNudge}
                  onHandleQueue={turnManagement.handleQueue}
                  onHandleDequeue={turnManagement.handleDequeue}
                  onHandleTalkativenessChange={(pId, value) => {
                    // Handle talkativeness change - this would need to be implemented
                    clientLogger.debug('[Chat] Talkativeness change requested', { participantId: pId, value })
                  }}
                  onHandleRemoveCharacter={handleRemoveCharacter}
                  onHandleContinue={turnManagement.handleContinue}
                />
              )
            })}

            {/* Waiting for response - show large quill animation */}
            {waitingForResponse && !streaming && (
              <div className="qt-chat-message-row qt-chat-message-row-assistant items-center">
                {shouldShowAvatars() && (
                  <div className="flex-shrink-0 qt-chat-desktop-avatar">
                    <Avatar
                      name={getRespondingCharacter()?.name || 'AI'}
                      title={null}
                      src={getRespondingCharacter()}
                      size="chat"
                      showName
                      showTitle
                      className="flex flex-col items-center w-32 gap-1"
                    />
                  </div>
                )}
                <div className="qt-chat-message-body">
                  {shouldShowAvatars() && (
                    <div className="qt-chat-message-mobile-header">
                      <div className="qt-chat-message-mobile-avatar">
                        {(() => {
                          const char = getRespondingCharacter()
                          const avatarSrc = char?.avatarUrl || (char?.defaultImage?.url || char?.defaultImage?.filepath)
                          const normalizedSrc = avatarSrc && (avatarSrc.startsWith('/') ? avatarSrc : `/${avatarSrc}`)
                          return normalizedSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={normalizedSrc} alt={char?.name || 'AI'} />
                          ) : (
                            <div className="qt-chat-message-mobile-avatar-initial">
                              {(char?.name || 'AI').charAt(0).toUpperCase()}
                            </div>
                          )
                        })()}
                      </div>
                      <span className="qt-chat-message-mobile-name">{getRespondingCharacter()?.name || 'AI'}</span>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    <QuillAnimation size="lg" />
                  </div>
                </div>
              </div>
            )}

            {/* Pending tool calls */}
            <PendingToolCalls pendingToolCalls={pendingToolCalls} />

            {/* Ephemeral messages */}
            <EphemeralMessagesComponent
              messages={ephemeralMessages}
              onDismiss={turnManagement.handleDismissEphemeral}
            />

            {/* Streaming message - using extracted component */}
            <StreamingMessage
              streaming={streaming}
              streamingContent={streamingContent}
              waitingForResponse={waitingForResponse}
              respondingCharacter={getRespondingCharacter() || undefined}
              roleplayTemplateName={roleplayTemplateName}
              shouldShowAvatars={shouldShowAvatars()}
              onStopClick={stopStreaming}
            />

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Chat Composer - using extracted component */}
        <ChatComposer
          id={id}
          input={input}
          setInput={setInput}
          attachedFiles={attachedFiles}
          onRemoveAttachedFile={removeAttachedFile}
          disabled={sending}
          sending={sending}
          hasActiveCharacters={hasActiveCharacters}
          streaming={streaming}
          waitingForResponse={waitingForResponse}
          toolPaletteOpen={toolPaletteOpen}
          setToolPaletteOpen={setToolPaletteOpen}
          mobileToolPaletteOpen={mobileToolPaletteOpen}
          setMobileToolPaletteOpen={setMobileToolPaletteOpen}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          uploadingFile={uploadingFile}
          toolExecutionStatus={toolExecutionStatus}
          roleplayTemplateName={roleplayTemplateName}
          chatPhotoCount={chatPhotoCount}
          chatMemoryCount={chatMemoryCount}
          hasImageProfile={chat?.participants.some(p => p.imageProfile) ?? false}
          isSingleCharacterChat={isSingleCharacterChat}
          roleplayTemplateId={chat?.roleplayTemplateId}
          onSubmit={(e) => {
            e.preventDefault()
            // sendMessage function would be implemented here
            // For now, this is a placeholder - the actual sendMessage logic needs to stay in the page
            clientLogger.debug('[Chat] Send message submitted')
          }}
          onFileSelect={handleFileSelect}
          onAttachFileClick={() => {
            // File input ref will be created in component
          }}
          onGalleryClick={() => setGalleryOpen(true)}
          onGenerateImageClick={() => setGenerateImageDialogOpen(true)}
          onAddCharacterClick={handleAddCharacter}
          onSettingsClick={() => setChatSettingsModalOpen(true)}
          onDeleteChatMemoriesClick={handleDeleteChatMemories}
          onReextractMemoriesClick={handleReextractMemories}
          onStopStreaming={stopStreaming}
        />

        {/* Modals */}
        <ImageModal
          isOpen={modalImage !== null}
          onClose={() => setModalImage(null)}
          src={modalImage?.src || ''}
          filename={modalImage?.filename || ''}
          fileId={modalImage?.fileId}
          characterId={getFirstCharacter()?.id}
          characterName={getFirstCharacter()?.name}
          personaId={getFirstPersona()?.id}
          personaName={getFirstPersona()?.name}
          onDelete={() => {
            fetchChat()
          }}
        />

        <PhotoGalleryModal
          mode="chat"
          isOpen={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          chatId={id}
          characterId={getFirstCharacter()?.id}
          characterName={getFirstCharacter()?.name}
          personaId={getFirstPersona()?.id}
          personaName={getFirstPersona()?.name}
          onImageDeleted={(fileId) => {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.attachments?.some((a) => a.id === fileId)) {
                  const newAttachments = msg.attachments.filter((a) => a.id !== fileId)
                  const newContent = msg.content.includes('[attached photo deleted]')
                    ? msg.content
                    : `${msg.content} [attached photo deleted]`
                  return { ...msg, attachments: newAttachments, content: newContent }
                }
                return msg
              })
            )
            fetchChatPhotoCount()
          }}
        />

        <ChatSettingsModal
          isOpen={chatSettingsModalOpen}
          onClose={() => setChatSettingsModalOpen(false)}
          chatId={id}
          participants={chat?.participants || []}
          roleplayTemplateId={chat?.roleplayTemplateId}
          onSuccess={fetchChat}
        />

        <GenerateImageDialog
          isOpen={generateImageDialogOpen}
          onClose={() => setGenerateImageDialogOpen(false)}
          chatId={id}
          participants={chat?.participants || []}
          imageProfileId={chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)?.imageProfile?.id}
          onImagesGenerated={(images, prompt) => {
            fetch(`/api/chats/${id}/tool-results`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tool: 'generate_image',
                initiatedBy: 'user',
                prompt,
                images: images.map(img => ({
                  id: img.id,
                  filename: img.filename,
                })),
              }),
            })
              .then((res) => res.json())
              .then(() => {
                fetchChat()
              })
              .catch((err) => clientLogger.error('Failed to save tool result:', { error: err instanceof Error ? err.message : String(err) }))

            setAttachedFiles((prev) => [
              ...prev,
              ...images.map((img) => ({
                ...img,
                url: img.filepath.startsWith('/') ? img.filepath : `/${img.filepath}`,
              })),
            ])
            fetchChatPhotoCount()
          }}
        />

        <AddCharacterDialog
          isOpen={addCharacterDialogOpen}
          onClose={() => setAddCharacterDialogOpen(false)}
          chatId={id}
          existingCharacterIds={chat?.participants
            .filter(p => p.type === 'CHARACTER' && p.isActive)
            .map(p => p.character?.id)
            .filter((id): id is string => id !== null && id !== undefined) || []}
          onCharacterAdded={handleCharacterAdded}
        />
      </div>

      {shouldShowParticipantSidebar && (
        <ParticipantSidebar
          participants={participantData}
          turnState={turnState}
          turnSelectionResult={turnSelectionResult}
          isGenerating={streaming || waitingForResponse}
          userParticipantId={userParticipantId}
          respondingParticipantId={respondingParticipantId}
          onNudge={turnManagement.handleNudge}
          onQueue={turnManagement.handleQueue}
          onDequeue={turnManagement.handleDequeue}
          onSkip={turnManagement.handleContinue}
          onTalkativenessChange={(pId, value) => {
            clientLogger.debug('[Chat] Talkativeness change', { participantId: pId, value })
          }}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
        />
      )}
    </div>
  )
}
