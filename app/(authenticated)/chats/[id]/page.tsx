'use client'

import { use, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import ImageModal from '@/components/chat/ImageModal'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import ToolPalette from '@/components/chat/ToolPalette'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import GenerateImageDialog from '@/components/chat/GenerateImageDialog'
import ParticipantSidebar from '@/components/chat/ParticipantSidebar'
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
import MessageContent from '@/components/chat/MessageContent'
import ToolMessage from '@/components/chat/ToolMessage'
import RoleplayAnnotationButtons from '@/components/chat/RoleplayAnnotationButtons'
import { formatMessageTime } from '@/lib/format-time'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useDebugOptional } from '@/components/providers/debug-provider'
import type { TagVisualStyle } from '@/lib/schemas/types'
import { useChatContext } from '@/components/providers/chat-context'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import {
  type TurnState,
  type TurnSelectionResult,
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  findUserParticipant,
  isMultiCharacterChat,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'

interface MessageAttachment {
  id: string
  filename: string
  filepath: string
  mimeType: string
}

interface Message {
  id: string
  role: string
  content: string
  createdAt: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
  attachments?: MessageAttachment[]
  debugMemoryLogs?: string[]
  participantId?: string | null
}

interface CharacterData {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  talkativeness?: number
}

interface PersonaData {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
}

interface ConnectionProfileData {
  id: string
  name: string
  provider?: string
  modelName?: string
  apiKey?: {
    id: string
    provider: string
    label?: string
  } | null
}

interface Participant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  displayOrder: number
  isActive: boolean
  systemPromptOverride?: string | null
  characterId?: string | null
  personaId?: string | null
  character?: CharacterData | null
  persona?: PersonaData | null
  connectionProfile?: ConnectionProfileData | null
  imageProfile?: {
    id: string
    name: string
    provider: string
    modelName: string
  } | null
  // Multi-character chat fields
  hasHistoryAccess?: boolean
  joinScenario?: string | null
  createdAt?: string
  updatedAt?: string
}

interface Chat {
  id: string
  title: string
  roleplayTemplateId?: string | null
  participants: Participant[]
  user: {
    id: string
    name?: string | null
    image?: string | null
  }
  messages: Message[]
}

interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
  avatarDisplayStyle?: 'CIRCULAR' | 'RECTANGULAR'
  tagStyles?: Record<string, TagVisualStyle>
  createdAt: string
  updatedAt: string
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  useAvatarDisplay()
  const debug = useDebugOptional()
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [swipeStates, setSwipeStates] = useState<Record<string, { current: number; total: number; messages: Message[] }>>({})
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<Array<{ id: string; filename: string; filepath: string; mimeType: string; url: string }>>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [chatPhotoCount, setChatPhotoCount] = useState(0)
  const [chatMemoryCount, setChatMemoryCount] = useState(0)
  const [roleplayTemplateName, setRoleplayTemplateName] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false)
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [toolExecutionStatus, setToolExecutionStatus] = useState<{ tool: string; status: 'pending' | 'success' | 'error'; message: string } | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ id: string; name: string; status: 'pending' | 'success' | 'error'; result?: unknown; arguments?: Record<string, unknown> }>>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  // Phase 5: Ephemeral messages for nudge/queue notifications (session-only, not persisted)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  // Track which participant is currently responding during streaming (for correct avatar display)
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  // Track the last auto-triggered participant to prevent duplicate triggers
  const lastAutoTriggeredRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
    const isMobilePortrait = globalThis.window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches
    return isMobilePortrait ? windowHeight / 2 : windowHeight / 3
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

  // Get the character that is currently responding (for streaming avatar display)
  // Falls back to first character if no responding participant is set
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
  // Convert Participant[] to ChatParticipantBase[] for turn manager functions
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

  // Phase 7: Track if there are any active characters (edge case handling)
  const hasActiveCharacters = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length > 0
  }, [participantsAsBase])

  // Single-character chat: exactly 1 active character (show "Add Character" in tool palette)
  const isSingleCharacterChat = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length === 1
  }, [participantsAsBase])

  // Build character map for turn selection
  // The turn manager expects Character objects with at least id and talkativeness
  const charactersMap = useMemo((): Map<string, Character> => {
    const map = new Map<string, Character>()
    if (!chat?.participants) return map
    chat.participants.forEach(p => {
      if (p.type === 'CHARACTER' && p.character) {
        // Create a minimal Character object with required fields
        map.set(p.character.id, {
          id: p.character.id,
          userId: '', // Not needed for turn selection
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

  // Convert participants to ParticipantData format for sidebar
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

  // Get participant by ID for message avatar lookup
  const getParticipantById = useCallback((participantId: string | null | undefined) => {
    if (!participantId || !chat?.participants) return null
    return chat.participants.find(p => p.id === participantId) ?? null
  }, [chat?.participants])

  // Calculate turn state when messages change
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

    // Calculate next speaker
    const result = selectNextSpeaker(
      participantsAsBase,
      charactersMap,
      newTurnState,
      userParticipantId
    )

    setTurnSelectionResult(result)

    clientLogger.debug('[Chat] Turn state calculated', {
      nextSpeakerId: result.nextSpeakerId,
      reason: result.reason,
      cycleComplete: result.cycleComplete,
    })
  }, [messages, participantsAsBase, userParticipantId, charactersMap])

  // Phase 5: Trigger character response without user message (for nudge action)
  // Phase 7: Enhanced with edge case validation
  const triggerContinueMode = useCallback(async (participantId: string) => {
    if (streaming || waitingForResponse) {
      clientLogger.debug('[Chat] Skipping continue mode - already generating')
      return
    }

    // Phase 7: Edge Case 5 - Validate that the participant still exists and is active
    const participant = participantsAsBase.find(p => p.id === participantId && p.isActive)
    if (!participant) {
      clientLogger.warn('[Chat] Cannot trigger continue mode - participant not found or inactive', {
        participantId,
      })
      showErrorToast('This participant is no longer available in the chat.')
      return
    }

    // Phase 7: Edge Case 3 - Check if there are any eligible speakers
    if (!hasActiveCharacters) {
      clientLogger.warn('[Chat] No active characters available for continue mode')
      showErrorToast('No characters available. Add a character to continue the conversation.')
      return
    }

    clientLogger.debug('[Chat] Triggering continue mode for participant', { participantId })

    setWaitingForResponse(true)
    setStreaming(false)
    setStreamingContent('')
    // Set the responding participant for correct avatar display during streaming
    setRespondingParticipantId(participantId)
    clientLogger.debug('[Chat] Set responding participant for streaming', { participantId })

    try {
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          continueMode: true,
          respondingParticipantId: participantId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to trigger response')
      }

      // Handle streaming response
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
            try {
              const data = JSON.parse(line.slice(6))

              if (data.content) {
                fullContent += data.content
                setWaitingForResponse(false)
                setStreaming(true)
                setStreamingContent(fullContent)
              }

              if (data.done) {
                // Response complete - add message to state
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

                // Clear ephemeral messages for this participant after response
                setEphemeralMessages(prev =>
                  prev.filter(em => em.participantId !== participantId)
                )

                // Update turn state if provided
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
      clientLogger.error('[Chat] Continue mode error:', {
        error: err instanceof Error ? err.message : String(err),
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to generate response')
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      setStreamingContent('')
      setRespondingParticipantId(null)
      scrollToBottom()
    }
  }, [id, streaming, waitingForResponse, participantsAsBase, hasActiveCharacters])

  // Auto-trigger next character in multi-character mode when it's their turn
  // This ensures characters who haven't spoken yet (including newly added ones) get their turn
  useEffect(() => {
    // Only auto-trigger in multi-character mode
    if (!isMultiChar) {
      clientLogger.debug('[Chat] Auto-trigger skipped - not multi-character mode')
      return
    }

    // Don't trigger if we're already generating or waiting
    if (streaming || waitingForResponse) {
      clientLogger.debug('[Chat] Auto-trigger skipped - already generating', {
        streaming,
        waitingForResponse,
      })
      return
    }

    // Don't trigger if there's no turn selection result yet
    if (!turnSelectionResult) {
      clientLogger.debug('[Chat] Auto-trigger skipped - no turn selection result')
      return
    }

    // Don't trigger if it's the user's turn (nextSpeakerId is null)
    if (turnSelectionResult.nextSpeakerId === null) {
      clientLogger.debug('[Chat] Auto-trigger skipped - user\'s turn', {
        reason: turnSelectionResult.reason,
        cycleComplete: turnSelectionResult.cycleComplete,
      })
      // Reset the last auto-triggered ref when cycle completes
      lastAutoTriggeredRef.current = null
      return
    }

    // Don't trigger if the next speaker is the user participant
    if (turnSelectionResult.nextSpeakerId === userParticipantId) {
      clientLogger.debug('[Chat] Auto-trigger skipped - next speaker is user')
      return
    }

    const nextSpeakerId = turnSelectionResult.nextSpeakerId

    // Don't trigger the same participant twice in a row (prevents race condition loops)
    if (lastAutoTriggeredRef.current === nextSpeakerId) {
      clientLogger.debug('[Chat] Auto-trigger skipped - same participant already triggered', {
        nextSpeakerId,
      })
      return
    }

    // We have a character who should speak - trigger them
    clientLogger.info('[Chat] Auto-triggering next character in multi-character mode', {
      nextSpeakerId,
      reason: turnSelectionResult.reason,
    })

    // Mark this participant as triggered before starting
    lastAutoTriggeredRef.current = nextSpeakerId

    // Small delay to allow state to settle and prevent race conditions
    const timeoutId = setTimeout(() => {
      triggerContinueMode(nextSpeakerId)
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [isMultiChar, streaming, waitingForResponse, turnSelectionResult, userParticipantId, triggerContinueMode])

  // Handle nudge action - Phase 5: Shows ephemeral message and triggers immediate response
  const handleNudge = useCallback((participantId: string) => {
    clientLogger.debug('[Chat] Nudging participant', { participantId })

    // Find participant name for ephemeral message
    const participant = participantData.find(p => p.id === participantId)
    const participantName = participant?.character?.name || participant?.persona?.name || 'Participant'

    // Add ephemeral nudge notification
    const ephemeral = createEphemeralMessage('nudge', participantId, participantName)
    setEphemeralMessages(prev => [...prev, ephemeral])

    // Update turn state
    const newTurnState = nudgeParticipant(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }

    // Trigger immediate response generation (Phase 5 enhancement)
    triggerContinueMode(participantId)
  }, [turnState, participantsAsBase, charactersMap, userParticipantId, participantData, triggerContinueMode])

  // Handle queue action
  const handleQueue = useCallback((participantId: string) => {
    clientLogger.debug('[Chat] Queueing participant', { participantId })
    const newTurnState = addToQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }
  }, [turnState, participantsAsBase, charactersMap, userParticipantId])

  // Handle dequeue action
  const handleDequeue = useCallback((participantId: string) => {
    clientLogger.debug('[Chat] Dequeuing participant', { participantId })
    const newTurnState = removeFromQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }
  }, [turnState, participantsAsBase, charactersMap, userParticipantId])

  // Handle talkativeness change (optimistic update - would need API for persistence)
  const handleTalkativenessChange = useCallback((participantId: string, value: number) => {
    clientLogger.debug('[Chat] Talkativeness change', { participantId, value })
    // TODO: Persist this to the database via API
    // For now, just log it - the local slider state handles display
  }, [])

  // Phase 5: Dismiss an ephemeral message
  const handleDismissEphemeral = useCallback((ephemeralId: string) => {
    clientLogger.debug('[Chat] Dismissing ephemeral message', { ephemeralId })
    setEphemeralMessages(prev => prev.filter(em => em.id !== ephemeralId))
  }, [])

  // Phase 7: Continue button - User passes turn to next character
  const handleContinue = useCallback(() => {
    clientLogger.debug('[Chat] User passing turn via Continue button')

    // Edge case: No active characters
    if (!hasActiveCharacters) {
      clientLogger.warn('[Chat] Cannot continue - no active characters')
      showErrorToast('No characters available. Add a character to continue.')
      return
    }

    // Get the next character to speak
    const result = selectNextSpeaker(participantsAsBase, charactersMap, turnState, userParticipantId)
    if (result.nextSpeakerId && result.nextSpeakerId !== userParticipantId) {
      clientLogger.debug('[Chat] Selected next speaker for continue', {
        participantId: result.nextSpeakerId,
        reason: result.reason,
      })
      triggerContinueMode(result.nextSpeakerId)
    } else {
      clientLogger.warn('[Chat] Continue button clicked but no valid next speaker', {
        nextSpeakerId: result.nextSpeakerId,
        reason: result.reason,
      })
      // User-friendly message for edge case 3
      showInfoToast('All characters have spoken. Send a message to continue the conversation.')
    }
  }, [participantsAsBase, charactersMap, turnState, userParticipantId, triggerContinueMode, hasActiveCharacters])

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/chat-settings')
      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'Unable to read response body')
        throw new Error(`Failed to fetch chat settings: ${res.status} ${res.statusText} - ${errorBody}`)
      }
      const data = await res.json()
      setChatSettings(data)
    } catch (err) {
      clientLogger.error('Failed to fetch chat settings', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      // Use default settings if fetch fails
      setChatSettings({ id: '', userId: '', avatarDisplayMode: 'ALWAYS', avatarDisplayStyle: 'CIRCULAR', tagStyles: {}, createdAt: '', updatedAt: '' })
    }
  }, [])

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}`)
      if (!res.ok) throw new Error('Failed to fetch chat')
      const data = await res.json()
      setChat(data.chat)

      const allMessages = data.chat.messages.filter((m: Message) => m.role !== 'SYSTEM')

      // Organize swipe groups
      const swipeGroups: Record<string, Message[]> = {}
      const displayMessages: Message[] = []
      const newSwipeStates: Record<string, { current: number; total: number; messages: Message[] }> = {}

      allMessages.forEach((msg: Message) => {
        if (msg.swipeGroupId) {
          if (!swipeGroups[msg.swipeGroupId]) {
            swipeGroups[msg.swipeGroupId] = []
          }
          swipeGroups[msg.swipeGroupId].push(msg)
        } else {
          displayMessages.push(msg)
        }
      })

      // For each swipe group, show only the current swipe (index 0 by default)
      Object.entries(swipeGroups).forEach(([groupId, groupMessages]) => {
        const sorted = groupMessages.sort((a, b) => (a.swipeIndex || 0) - (b.swipeIndex || 0))
        displayMessages.push(sorted[0])
        newSwipeStates[groupId] = {
          current: 0,
          total: sorted.length,
          messages: sorted
        }
      })

      // Sort by creation time
      displayMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      setMessages(displayMessages)
      setSwipeStates(newSwipeStates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchChatPhotoCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}/files`)
      if (res.ok) {
        const data = await res.json()
        const imageCount = (data.files || []).filter((f: { mimeType: string }) => f.mimeType.startsWith('image/')).length
        setChatPhotoCount(imageCount)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch chat photo count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [id])

  // Fetch memory count for this chat
  const fetchChatMemoryCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}/memories`)
      if (res.ok) {
        const data = await res.json()
        setChatMemoryCount(data.memoryCount || 0)
        clientLogger.debug('[Chat] Fetched memory count', { chatId: id, memoryCount: data.memoryCount })
      }
    } catch (err) {
      clientLogger.error('Failed to fetch chat memory count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [id])

  // Handle deleting all memories for this chat
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
        setChatMemoryCount(0)
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
  }, [id, chatMemoryCount])

  // Handle re-extracting memories for this chat
  const handleReextractMemories = useCallback(async () => {
    // Get the first character participant for queueing
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

  // Phase 6: Handle adding a character to the chat
  const handleAddCharacter = useCallback(() => {
    clientLogger.debug('[Chat] Opening add character dialog')
    setAddCharacterDialogOpen(true)
  }, [])

  // Phase 6: Handle character added callback - refresh chat data
  const handleCharacterAdded = useCallback(() => {
    clientLogger.info('[Chat] Character added, refreshing chat data')
    fetchChat()
  }, [fetchChat])

  // Phase 6: Handle removing a character from the chat
  // Phase 7: Enhanced with edge case handling
  const handleRemoveCharacter = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'This character'

    clientLogger.debug('[Chat] Requesting character removal', {
      participantId,
      characterName,
      isGenerating: streaming || waitingForResponse,
      currentSpeakerId: turnState.lastSpeakerId,
    })

    // Edge Case 4: Check if this character is currently generating
    if ((streaming || waitingForResponse) && turnState.lastSpeakerId === participantId) {
      clientLogger.warn('[Chat] Cannot remove character while they are generating', {
        participantId,
        characterName,
      })
      showErrorToast(`Cannot remove ${characterName} while they are generating a response. Please wait for them to finish.`)
      return
    }

    // Confirm with user
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

      clientLogger.info('[Chat] Character removed successfully', {
        participantId,
        characterName,
      })

      showSuccessToast(`${characterName} has been removed from the chat`)

      // Clear ephemeral messages for this participant
      setEphemeralMessages(prev => prev.filter(em => em.participantId !== participantId))

      // Remove from queue if they were queued
      setTurnState(prev => ({
        ...prev,
        queue: prev.queue.filter(qId => qId !== participantId),
      }))

      // Refresh chat data
      await fetchChat()

      // Edge Case 1: Check if this was the last character
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

  useEffect(() => {
    fetchChat()
    fetchChatSettings()
    fetchChatPhotoCount()
    fetchChatMemoryCount()
  }, [fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount])

  // Fetch roleplay template name when the chat's template ID changes
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
          clientLogger.warn('[Chat] Failed to fetch roleplay template', {
            templateId: chat.roleplayTemplateId,
            status: res.status,
          })
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

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/chats/${id}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await safeJsonParse<{ file?: { id: string; filepath: string; mimeType: string; url: string }; error?: string }>(res)

      if (!res.ok || !data.file) {
        throw new Error(data.error || 'Failed to upload file')
      }
      const uploadedFile = data.file
      setAttachedFiles((prev) => [...prev, {
        id: uploadedFile.id,
        filename: file.name,
        filepath: uploadedFile.filepath,
        mimeType: uploadedFile.mimeType,
        url: uploadedFile.url,
      }])
      showSuccessToast('File attached')
    } catch (err) {
      clientLogger.error('Error uploading file:', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploadingFile(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Remove attached file
  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachedFiles.length === 0) || sending) return

    // Reset auto-trigger ref when user sends a message (new turn cycle starts)
    lastAutoTriggeredRef.current = null

    const userMessage = input.trim()
    const fileIds = attachedFiles.map((f) => f.id)
    // Capture attachments before clearing state
    const messageAttachments: MessageAttachment[] = attachedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      mimeType: f.mimeType,
    }))
    setInput('')
    setAttachedFiles([])
    setSending(true)
    setWaitingForResponse(true)
    setStreaming(false)
    setStreamingContent('')
    // Set the responding participant for correct avatar display during streaming
    // For normal messages, the server uses the first active character
    const firstCharParticipant = getFirstCharacterParticipant()
    setRespondingParticipantId(firstCharParticipant?.id || null)
    clientLogger.debug('[Chat] Set responding participant for streaming', {
      participantId: firstCharParticipant?.id,
      characterName: firstCharParticipant?.character?.name,
    })
    // Reset textarea to minimum height (single line)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    // Build display content with file indicators
    const displayContent = messageAttachments.length > 0
      ? `${userMessage}${userMessage ? '\n' : ''}[Attached: ${messageAttachments.map(f => f.filename).join(', ')}]`
      : userMessage

    // Add user message to UI
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    }
    setMessages((prev) => [...prev, tempUserMessage])

    // Debug: Log outgoing request
    const requestPayload = { content: userMessage || 'Please look at the attached file(s).', fileIds }
    let debugEntryId: string | undefined
    const connectionProfile = getFirstConnectionProfile()
    const debugProviderName = connectionProfile?.name || 'LLM Provider'
    const debugProviderType = (connectionProfile?.apiKey?.provider || 'UNKNOWN') as import('@/components/providers/debug-provider').LLMProviderType
    const debugModel = connectionProfile?.modelName

    if (debug?.isDebugMode) {
      debugEntryId = debug.addEntry({
        direction: 'outgoing',
        provider: debugProviderName,
        providerType: debugProviderType,
        model: debugModel,
        endpoint: `/api/chats/${id}/messages`,
        status: 'pending',
        data: JSON.stringify(requestPayload, null, 2),
        contentType: 'application/json',
      })
    }

    // Debug: Prepare response entry
    let responseEntryId: string | undefined
    if (debug?.isDebugMode) {
      responseEntryId = debug.addEntry({
        direction: 'incoming',
        provider: debugProviderName,
        providerType: debugProviderType,
        model: debugModel,
        endpoint: `/api/chats/${id}/messages`,
        status: 'streaming',
        data: '',
        contentType: 'text/event-stream',
      })
    }

    try {
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })

      // Debug: Mark request as complete
      if (debug?.isDebugMode && debugEntryId) {
        debug.updateEntry(debugEntryId, { status: 'complete' })
      }

      if (!res.ok) {
        // Try to get error details from response
        let errorMessage = 'Failed to send message'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = res.statusText || errorMessage
        }
        throw new Error(errorMessage)
      }

      // Handle streaming response
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No response body')

      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        // Debug: Append raw chunk to response entry
        if (debug?.isDebugMode && responseEntryId) {
          debug.appendToEntry(responseEntryId, chunk)
        }

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.content) {
                fullContent += data.content
                setWaitingForResponse(false)
                setStreaming(true)
                setStreamingContent(fullContent)
              }

              // Handle tool detection - create pending entries for each tool
              if (data.toolsDetected && data.toolNames) {
                const toolNames = data.toolNames as string[]
                const toolArgs = (data.toolArguments || []) as Record<string, unknown>[]
                setPendingToolCalls(toolNames.map((name, idx) => ({
                  id: `tool-${idx}`,
                  name,
                  status: 'pending' as const,
                  arguments: toolArgs[idx],
                })))
                // Only show image generation status for generate_image tool
                if (toolNames.includes('generate_image')) {
                  setToolExecutionStatus({
                    tool: 'generate_image',
                    status: 'pending',
                    message: `Generating image...`,
                  })
                }
              }

              // Handle tool results
              if (data.toolResult) {
                const { index, name, success, result } = data.toolResult
                // Update pending tool call status by index (more reliable) or fall back to name
                setPendingToolCalls(prev => prev.map((tc, idx) =>
                  (index !== undefined && idx === index) || (index === undefined && tc.name === name)
                    ? { ...tc, status: success ? 'success' : 'error', result }
                    : tc
                ))
                // Only show toast/status for image generation
                if (name === 'generate_image') {
                  if (success) {
                    const imageCount = result?.images?.length || 1
                    setToolExecutionStatus({
                      tool: name,
                      status: 'success',
                      message: `Successfully generated ${imageCount} image${imageCount > 1 ? 's' : ''}!`,
                    })
                    showSuccessToast(`Image generation complete! ${imageCount} image${imageCount > 1 ? 's' : ''} generated.`)
                  } else {
                    setToolExecutionStatus({
                      tool: name,
                      status: 'error',
                      message: result?.error || 'Failed to generate image',
                    })
                    showErrorToast(`Image generation failed: ${result?.error || 'Unknown error'}`)
                  }
                }
              }

              // Handle memory debug logs (arrive after done event)
              if (data.debugMemoryLogs && debug?.isDebugMode && responseEntryId) {
                debug.updateEntry(responseEntryId, { debugMemoryLogs: data.debugMemoryLogs })
              }

              if (data.done) {
                // Debug: Finalize streaming entry with stitched content
                if (debug?.isDebugMode && responseEntryId) {
                  debug.finalizeStreamingEntry(responseEntryId)
                }

                // Check for empty response (known Gemini API issue)
                if (data.emptyResponse) {
                  showErrorToast(data.emptyResponseReason || 'The AI returned an empty response. Use the Resend button to try again.')
                  setStreamingContent('')
                  setStreaming(false)
                  setWaitingForResponse(false)
                  setSending(false)
                  setRespondingParticipantId(null)
                  return
                }

                // Add assistant message to messages list
                const assistantMessage: Message = {
                  id: data.messageId,
                  role: 'ASSISTANT',
                  content: fullContent,
                  createdAt: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, assistantMessage])
                setStreamingContent('')
                setStreaming(false)
                setRespondingParticipantId(null)
                // Refresh chat to get tool messages and memory debug logs
                await fetchChat()
                // Update debug entry with memory logs from the fetched chat (with polling)
                if (debug?.isDebugMode && responseEntryId) {
                  let pollCount = 0
                  const maxPolls = 20 // Poll for up to 20 seconds (1 second intervals)
                  const pollInterval = setInterval(async () => {
                    pollCount++
                    try {
                      const chatRes = await fetch(`/api/chats/${id}`)
                      if (chatRes.ok) {
                        const chatData = await chatRes.json()
                        const fetchedMessage = chatData.chat.messages.find((m: Message) => m.id === data.messageId)
                        if (fetchedMessage?.debugMemoryLogs) {
                          debug.updateEntry(responseEntryId, { debugMemoryLogs: fetchedMessage.debugMemoryLogs })
                          clearInterval(pollInterval)
                        } else if (pollCount >= maxPolls) {
                          clearInterval(pollInterval)
                        }
                      }
                    } catch {
                      if (pollCount >= maxPolls) {
                        clearInterval(pollInterval)
                      }
                    }
                  }, 1000)
                }
                // Clear tool status after a short delay
                setTimeout(() => {
                  setToolExecutionStatus(null)
                  setPendingToolCalls([])
                }, 3000)
              }

              if (data.error) {
                throw new Error(data.error)
              }
            } catch (parseError) {
              // Only log if it's a real parse error, not an empty JSON object
              const errorMessage = parseError instanceof Error ? parseError.message : String(parseError)
              if (errorMessage && errorMessage !== 'undefined' && errorMessage !== '[object Object]') {
                clientLogger.error('Failed to parse SSE data:', { error: errorMessage, raw: line.slice(6).substring(0, 100) })
              }
            }
          }
        }
      }
    } catch (err) {
      clientLogger.error('Error sending message:', { error: err instanceof Error ? err.message : String(err) })
      showErrorToast(err instanceof Error ? err.message : 'Failed to send message')

      // Debug: Mark entries as error
      if (debug?.isDebugMode) {
        if (debugEntryId) {
          debug.updateEntry(debugEntryId, { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
        }
        if (responseEntryId) {
          debug.updateEntry(responseEntryId, { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
        }
      }

      // Remove the temporary user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessageId))
      setStreamingContent('')
      setStreaming(false)
      setWaitingForResponse(false)
      setRespondingParticipantId(null)
    } finally {
      setSending(false)
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }

  const startEdit = (message: Message) => {
    setEditingMessageId(message.id)
    setEditContent(message.content)
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditContent('')
  }

  const saveEdit = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })

      if (!res.ok) throw new Error('Failed to update message')

      const updated = await res.json()
      setMessages(messages.map(m => m.id === messageId ? { ...m, content: updated.content } : m))
      setEditingMessageId(null)
      setEditContent('')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update message')
    }
  }

  const deleteMessage = async (messageId: string) => {
    if (!(await showConfirmation('Are you sure you want to delete this message?'))) return

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to delete message')

      // Remove message from display
      setMessages(messages.filter(m => m.id !== messageId))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete message')
    }
  }

  // Check if a user message can be resent
  // Returns true if: it's the last user message AND there are either no messages after it,
  // or only blank/empty assistant messages after it
  const canResendMessage = (messageId: string, messageIndex: number): boolean => {
    const message = messages[messageIndex]
    if (!message || message.role !== 'USER') return false

    // Check all messages after this one
    const messagesAfter = messages.slice(messageIndex + 1)

    // If no messages after, can resend
    if (messagesAfter.length === 0) return true

    // Check if all messages after are blank assistant messages
    // A message is considered "blank" if it has no content or only whitespace
    for (const msg of messagesAfter) {
      // Skip TOOL messages - they don't count as meaningful responses
      if (msg.role === 'TOOL') continue

      // If there's a non-blank assistant message, can't resend
      if (msg.role === 'ASSISTANT' && msg.content && msg.content.trim().length > 0) {
        return false
      }

      // If there's another user message after this, can't resend
      if (msg.role === 'USER') {
        return false
      }
    }

    return true
  }

  // Resend a user message: delete blank responses after it, delete the message, then resend
  const resendMessage = async (message: Message) => {
    if (sending) return

    // Extract the original content (strip [Attached: ...] suffix)
    const originalContent = getDisplayContent(message.content)

    // Get attachments from the original message
    const originalAttachments = message.attachments || []

    // Find the index of this message
    const messageIndex = messages.findIndex(m => m.id === message.id)
    if (messageIndex === -1) return

    // Delete blank assistant messages after this one (from the server)
    const messagesAfter = messages.slice(messageIndex + 1)
    for (const msg of messagesAfter) {
      if (msg.role === 'ASSISTANT' && (!msg.content || msg.content.trim().length === 0)) {
        try {
          await fetch(`/api/messages/${msg.id}`, { method: 'DELETE' })
        } catch {
          // Ignore errors deleting blank messages
        }
      }
    }

    // Delete the original user message from server
    try {
      const deleteRes = await fetch(`/api/messages/${message.id}`, { method: 'DELETE' })
      if (!deleteRes.ok) {
        throw new Error('Failed to delete original message')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to resend message')
      return
    }

    // Remove the message and any blank messages after it from the UI
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === message.id)
      if (idx === -1) return prev
      // Keep messages before this one
      return prev.slice(0, idx)
    })

    // Set up the input and attachments for resending
    setInput(originalContent)

    // If there were attachments, we need to re-attach them
    if (originalAttachments.length > 0) {
      setAttachedFiles(originalAttachments.map(a => ({
        id: a.id,
        filename: a.filename,
        filepath: a.filepath,
        mimeType: a.mimeType,
        size: 0, // Size not stored in message attachments
        url: a.filepath.startsWith('/') ? a.filepath : `/${a.filepath}`,
      })))
    }

    // Focus the input so user can see the restored message
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
      }
    }, 100)

    showSuccessToast('Message restored to input. Press Enter to resend.')
  }

  const generateSwipe = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/swipe`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to generate alternative response')

      const newSwipe = await res.json()

      // Refresh chat to get updated swipe groups
      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to generate alternative response')
    }
  }

  const switchSwipe = (groupId: string, direction: 'prev' | 'next') => {
    const state = swipeStates[groupId]
    if (!state) return

    const newIndex = direction === 'next'
      ? Math.min(state.current + 1, state.total - 1)
      : Math.max(state.current - 1, 0)

    if (newIndex === state.current) return

    const newMessage = state.messages[newIndex]
    setMessages(messages.map(m =>
      m.swipeGroupId === groupId ? newMessage : m
    ))
    setSwipeStates({
      ...swipeStates,
      [groupId]: { ...state, current: newIndex }
    })
  }

  const copyMessageContent = (content: string) => {
    navigator.clipboard.writeText(content)
    showSuccessToast('Message copied to clipboard!')
  }

  const toggleSourceView = (messageId: string) => {
    setViewSourceMessageIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  const shouldShowAvatars = () => {
    if (!chatSettings) return true // Default to showing avatars
    return chatSettings.avatarDisplayMode === 'ALWAYS'
  }

  const getMessageAvatar = (message: Message) => {
    // Multi-character support: use participantId if available
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

    // Fallback to original logic for messages without participantId
    if (message.role === 'USER') {
      // Use persona participant if available, otherwise fall back to user
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

  const getAvatarSrc = (avatar: ReturnType<typeof getMessageAvatar>) => {
    if (!avatar) return null
    if (avatar.defaultImage) {
      const filepath = avatar.defaultImage.url || avatar.defaultImage.filepath;
      return filepath.startsWith('/') ? filepath : `/${filepath}`;
    }
    return avatar.avatarUrl || null
  }

  // Strip [Attached: ...] from message content for display
  const getDisplayContent = (content: string) => {
    return content.replace(/\n?\[Attached: [^\]]+\]$/, '').trim()
  }

  // Get image attachments from a message
  const getImageAttachments = (message: Message) => {
    return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
  }

  const renderAvatar = (avatar: ReturnType<typeof getMessageAvatar>) => {
    if (!avatar) return null

    const avatarSrc = getAvatarSrc(avatar)
    // 4:5 ratio: width 100px = height 125px, max height 200px = width 160px
    // Using width 120px and height 150px as a good balance
    const avatarWidth = 120
    const avatarHeight = 150

    return (
      <div className="flex flex-col items-center flex-shrink-0 w-32 gap-1">
        <div
          className="bg-muted flex items-center justify-center overflow-hidden"
          style={{
            width: `${avatarWidth}px`,
            height: `${avatarHeight}px`,
          }}
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt={avatar.name}
              width={avatarWidth}
              height={avatarHeight}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-4xl font-bold text-muted-foreground">
              {avatar.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground line-clamp-2">
            {avatar.name}
          </div>
          {avatar.title && (
            <div className="text-xs italic text-muted-foreground line-clamp-2">
              {avatar.title}
            </div>
          )}
        </div>
      </div>
    )
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

  // Show participant sidebar when:
  // - Multi-character chat (2+ characters)
  // - User hasn't hidden it
  const shouldShowParticipantSidebar = isMultiChar && showParticipantSidebar

  return (
    <div className="qt-chat-layout">
      {/* Main chat area */}
      <div className="qt-chat-main">

      {/* Messages */}
      <div className="qt-chat-messages">
        <div className="qt-chat-messages-list">
        {messages.map((message, messageIndex) => {
          const isEditing = editingMessageId === message.id
          const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null
          const showResendButton = canResendMessage(message.id, messageIndex)

          // Render TOOL messages differently
          if (message.role === 'TOOL') {
            return (
              <ToolMessage
                key={message.id}
                message={message}
                character={getFirstCharacter() ?? undefined}
                onImageClick={(filepath, filename, fileId) => {
                  // filepath is already normalized by ToolMessage
                  setModalImage({ src: filepath, filename, fileId })
                }}
              />
            )
          }

        const messageAvatar = shouldShowAvatars() ? getMessageAvatar(message) : null
        const messageRowClasses = ['qt-chat-message-row']
        if (message.role === 'USER') {
          messageRowClasses.push('qt-chat-message-row-user')
        } else {
          messageRowClasses.push('qt-chat-message-row-assistant')
        }

        return (
          <div
            key={message.id}
            className={messageRowClasses.join(' ')}
          >
              {/* Desktop avatar - assistant (left side) */}
              {message.role === 'ASSISTANT' && shouldShowAvatars() && (
                <div className="flex-shrink-0 qt-chat-desktop-avatar">
                  {renderAvatar(messageAvatar)}
                </div>
              )}
            <div className="qt-chat-message-body group">
                {/* Mobile header - avatar and name in a row above the message */}
                {shouldShowAvatars() && messageAvatar && (
                  <div className="qt-chat-message-mobile-header">
                    <div className="qt-chat-message-mobile-avatar">
                      {getAvatarSrc(messageAvatar) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getAvatarSrc(messageAvatar)!}
                          alt={messageAvatar.name}
                        />
                      ) : (
                        <div className="qt-chat-message-mobile-avatar-initial">
                          {messageAvatar.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className="qt-chat-message-mobile-name">{messageAvatar.name}</span>
                  </div>
                )}

                <div
                  className={`chat-message ${
                    message.role === 'USER'
                      ? 'qt-chat-message-user'
                      : 'qt-chat-message-assistant'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="qt-textarea"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(message.id)}
                          className="qt-button qt-button-primary qt-button-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="qt-button qt-button-secondary qt-button-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {viewSourceMessageIds.has(message.id) ? (
                        <div className="qt-code-block whitespace-pre-wrap break-words overflow-auto max-h-96">
                          {message.content}
                        </div>
                      ) : (
                        <MessageContent content={getDisplayContent(message.content)} roleplayTemplateName={roleplayTemplateName} />
                      )}
                      {/* Image attachment thumbnails */}
                      {getImageAttachments(message).length > 0 && (
                        <div className="qt-chat-attachment-list">
                          {getImageAttachments(message).map((attachment) => (
                            <button
                              key={attachment.id}
                              onClick={() => setModalImage({
                                src: attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`,
                                filename: attachment.filename,
                                fileId: attachment.id,
                              })}
                              type="button"
                              className="qt-button qt-chat-attachment-button"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/${attachment.filepath.startsWith('/') ? attachment.filepath.slice(1) : attachment.filepath}`}
                                alt={attachment.filename}
                                width={80}
                                height={80}
                                className="qt-chat-attachment-image"
                              />
                              <div className="qt-chat-attachment-overlay">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                </svg>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Mobile/responsive action bar - shown on mobile, hidden on desktop */}
                      <div className="qt-chat-message-action-bar">
                        <div className="qt-chat-message-action-bar-icons">
                          {/* Copy */}
                          <button
                            onClick={() => copyMessageContent(message.content)}
                            className="qt-chat-message-action-icon"
                            title="Copy message"
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          {/* View source/rendered */}
                          <button
                            onClick={() => toggleSourceView(message.id)}
                            className="qt-chat-message-action-icon"
                            title={viewSourceMessageIds.has(message.id) ? 'View rendered' : 'View source'}
                          >
                            {viewSourceMessageIds.has(message.id) ? (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            ) : (
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                              </svg>
                            )}
                          </button>
                          {/* Edit (user messages only) */}
                          {message.role === 'USER' && (
                            <button
                              onClick={() => startEdit(message)}
                              className="qt-chat-message-action-icon"
                              title="Edit message"
                            >
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {/* Delete */}
                          <button
                            onClick={() => deleteMessage(message.id)}
                            className="qt-chat-message-action-icon qt-chat-message-action-icon-danger"
                            title="Delete message"
                          >
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          {/* Regenerate (assistant messages only) */}
                          {message.role === 'ASSISTANT' && (
                            <button
                              onClick={() => generateSwipe(message.id)}
                              className="qt-chat-message-action-icon"
                              title="Regenerate response"
                            >
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                          )}
                          {/* Resend (user messages only) */}
                          {message.role === 'USER' && showResendButton && (
                            <button
                              onClick={() => resendMessage(message)}
                              className="qt-chat-message-action-icon"
                              title="Resend this message"
                            >
                              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                              </svg>
                            </button>
                          )}
                          {/* Swipe controls */}
                          {message.role === 'ASSISTANT' && swipeState && swipeState.total > 1 && (
                            <>
                              <button
                                onClick={() => switchSwipe(message.swipeGroupId!, 'prev')}
                                disabled={swipeState.current === 0}
                                className="qt-chat-message-action-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Previous response"
                              >
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                              </button>
                              <span className="text-muted-foreground text-xs px-1">
                                {swipeState.current + 1}/{swipeState.total}
                              </span>
                              <button
                                onClick={() => switchSwipe(message.swipeGroupId!, 'next')}
                                disabled={swipeState.current === swipeState.total - 1}
                                className="qt-chat-message-action-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Next response"
                              >
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                        <span className="qt-chat-message-action-timestamp">
                          {formatMessageTime(message.createdAt)}
                        </span>
                      </div>

                      {/* Desktop timestamp - hidden on mobile */}
                      <div className="text-xs text-muted-foreground mt-2 qt-chat-desktop-timestamp">
                        {formatMessageTime(message.createdAt)}
                      </div>
                    </>
                  )}
                </div>

                {/* Desktop hover action buttons - hidden on mobile */}
                {!isEditing && (
                  <div className="absolute -top-8 right-0 flex gap-1 bg-muted rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity qt-chat-desktop-hover-actions">
                    <button
                      onClick={() => copyMessageContent(message.content)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Copy message"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleSourceView(message.id)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title={viewSourceMessageIds.has(message.id) ? 'View rendered' : 'View source'}
                    >
                      {viewSourceMessageIds.has(message.id) ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

                {/* Desktop message actions - hidden on mobile */}
                {!isEditing && (
                  <div className="flex gap-2 mt-1 text-sm qt-chat-message-desktop-actions">
                    {message.role === 'USER' && (
                      <>
                        <button
                          onClick={() => startEdit(message)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteMessage(message.id)}
                          className="text-destructive hover:text-destructive/80"
                        >
                          Delete
                        </button>
                        {showResendButton && (
                          <button
                            onClick={() => resendMessage(message)}
                            className="text-warning hover:text-warning/80"
                            title="Resend this message (deletes blank responses and restores to input)"
                          >
                            ↻ Resend
                          </button>
                        )}
                      </>
                    )}

                    {message.role === 'ASSISTANT' && (
                      <>
                        <button
                          onClick={() => deleteMessage(message.id)}
                          className="text-destructive hover:text-destructive/80"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => generateSwipe(message.id)}
                          className="text-info hover:text-info/80"
                        >
                          Regenerate
                        </button>

                        {/* Swipe controls */}
                        {swipeState && swipeState.total > 1 && (
                          <div className="flex items-center gap-2 ml-2">
                            <button
                              onClick={() => switchSwipe(message.swipeGroupId!, 'prev')}
                              disabled={swipeState.current === 0}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              ←
                            </button>
                            <span className="text-muted-foreground text-xs">
                              {swipeState.current + 1} / {swipeState.total}
                            </span>
                            <button
                              onClick={() => switchSwipe(message.swipeGroupId!, 'next')}
                              disabled={swipeState.current === swipeState.total - 1}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              →
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {/* Desktop avatar - user (right side) */}
              {message.role === 'USER' && shouldShowAvatars() && (
                <div className="flex-shrink-0 qt-chat-desktop-avatar">
                  {renderAvatar(messageAvatar)}
                </div>
              )}
            </div>
          )
        })}

        {/* Waiting for response - show large quill animation */}
        {waitingForResponse && !streaming && (
          <div className="qt-chat-message-row qt-chat-message-row-assistant items-center">
            {shouldShowAvatars() && (
              <div className="flex-shrink-0 qt-chat-desktop-avatar">
                {renderAvatar({
                  name: getRespondingCharacter()?.name || 'AI',
                  title: null,
                  avatarUrl: getRespondingCharacter()?.avatarUrl,
                  defaultImage: getRespondingCharacter()?.defaultImage,
                })}
              </div>
            )}
            <div className="qt-chat-message-body">
              {/* Mobile header for waiting state */}
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

        {/* Pending tool calls - shown collapsed before streaming response */}
        {pendingToolCalls.length > 0 && (
          <div className="qt-chat-message-row qt-chat-message-row-assistant">
            <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-muted text-lg">
              {(() => {
                if (pendingToolCalls.some(tc => tc.name === 'generate_image')) return '🎨'
                if (pendingToolCalls.some(tc => tc.name === 'search_memories')) return '🧠'
                if (pendingToolCalls.some(tc => tc.name === 'search_web')) return '🔍'
                return '⚙️'
              })()}
            </div>
            <div className="flex-1 min-w-0">
              <details className="group" open={pendingToolCalls.some(tc => tc.status === 'pending')}>
                <summary className="px-4 py-2 rounded-lg bg-muted border border-border cursor-pointer list-none flex items-center gap-2">
                  <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm font-medium text-foreground">
                    {pendingToolCalls.map(tc => {
                      const displayNames: Record<string, string> = {
                        'generate_image': 'Image Generation',
                        'search_memories': 'Memory Search',
                        'search_web': 'Web Search',
                      }
                      return displayNames[tc.name] || tc.name
                    }).join(', ')}
                  </span>
                  {pendingToolCalls.some(tc => tc.status === 'pending') && (
                    <QuillAnimation size="sm" className="ml-auto text-muted-foreground" />
                  )}
                  {pendingToolCalls.every(tc => tc.status === 'success') && (
                    <span className="ml-auto text-xs px-2 py-0.5 bg-success/20 text-success rounded">
                      Complete
                    </span>
                  )}
                  {pendingToolCalls.some(tc => tc.status === 'error') && (
                    <span className="ml-auto text-xs px-2 py-0.5 bg-destructive/20 text-destructive rounded">
                      Error
                    </span>
                  )}
                </summary>
                <div className="mt-2 px-4 py-2 rounded-lg bg-muted border border-border">
                  {pendingToolCalls.map((tc) => (
                    <div key={tc.id} className="text-xs text-muted-foreground">
                      <span className="font-medium">{tc.name}</span>
                      {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                        <span className="ml-2 text-muted-foreground/70">
                          ({Object.entries(tc.arguments).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v)}`).join(', ')})
                        </span>
                      )}
                      {tc.status === 'success' && <span className="ml-2 text-success">✓</span>}
                      {tc.status === 'error' && <span className="ml-2 text-destructive">✗</span>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}

        {/* Phase 5: Ephemeral messages (nudge notifications, etc.) */}
        {ephemeralMessages.map((em) => (
          <EphemeralMessage
            key={em.id}
            message={em}
            onDismiss={handleDismissEphemeral}
          />
        ))}

        {/* Streaming message */}
        {streaming && streamingContent && (
          <div className="qt-chat-message-row qt-chat-message-row-assistant">
            {shouldShowAvatars() && (
              <div className="flex-shrink-0 qt-chat-desktop-avatar">
                {renderAvatar({
                  name: getRespondingCharacter()?.name || 'AI',
                  title: null,
                  avatarUrl: getRespondingCharacter()?.avatarUrl,
                  defaultImage: getRespondingCharacter()?.defaultImage,
                })}
              </div>
            )}
            <div className="qt-chat-message-body">
              {/* Mobile header for streaming state */}
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
              <div className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-card border border-border text-foreground">
                <MessageContent content={streamingContent} roleplayTemplateName={roleplayTemplateName} />
                <QuillAnimation size="sm" className="inline-block ml-2 text-muted-foreground" />
              </div>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="qt-chat-composer">
        {/* Phase 7: Edge Case 1 - No active characters warning */}
        {!hasActiveCharacters && messages.length > 0 && (
          <div className="qt-alert qt-alert-warning flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <p className="font-medium text-sm">No characters in this chat</p>
              <p className="text-xs opacity-80 mt-0.5">
                Add a character to continue the conversation.
              </p>
            </div>
            {isMultiChar && (
              <button
                onClick={handleAddCharacter}
                className="qt-button qt-button-secondary qt-button-sm"
              >
                Add Character
              </button>
            )}
          </div>
        )}
        <div className="qt-chat-composer-content">
          {/* Tool execution status indicator */}
          {toolExecutionStatus && (
            <div
              className={`qt-alert flex items-center gap-2 ${
                toolExecutionStatus.status === 'pending'
                  ? 'qt-alert-info'
                  : toolExecutionStatus.status === 'success'
                    ? 'qt-alert-success'
                    : 'qt-alert-error'
              }`}
            >
              {toolExecutionStatus.status === 'pending' ? (
                <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ) : toolExecutionStatus.status === 'success' ? (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <span className="text-sm font-medium">{toolExecutionStatus.message}</span>
            </div>
          )}

          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="qt-chat-attachment-list mb-2">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="qt-chat-attachment-chip"
                >
                  {file.mimeType.startsWith('image/') ? (
                    <svg className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  <span className="text-foreground max-w-[150px] truncate">
                    {file.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(file.id)}
                    className="qt-chat-attachment-chip-remove"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Roleplay annotation buttons */}
          <RoleplayAnnotationButtons
            roleplayTemplateId={chat?.roleplayTemplateId}
            inputRef={inputRef}
            input={input}
            setInput={setInput}
            disabled={sending || !hasActiveCharacters}
          />
          <form onSubmit={sendMessage} className="qt-chat-composer-inner">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
              className="hidden"
            />
            {/* Buttons column */}
            <div className="qt-chat-toolbar">
              {/* Attach file button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || uploadingFile}
                className="qt-button qt-chat-toolbar-button"
                title="Attach file"
              >
                {uploadingFile ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                )}
              </button>
              {/* Tools button - opens palette with gallery and settings */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setToolPaletteOpen(!toolPaletteOpen)
                  }}
                  className="qt-button qt-chat-toolbar-button"
                  title="Tools menu"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <ToolPalette
                  isOpen={toolPaletteOpen}
                  onClose={() => setToolPaletteOpen(false)}
                  onGalleryClick={() => setGalleryOpen(true)}
                  onGenerateImageClick={() => setGenerateImageDialogOpen(true)}
                  onSettingsClick={() => setChatSettingsModalOpen(true)}
                  onAddCharacterClick={handleAddCharacter}
                  onDeleteChatMemoriesClick={handleDeleteChatMemories}
                  onReextractMemoriesClick={handleReextractMemories}
                  chatPhotoCount={chatPhotoCount}
                  hasImageProfile={chat?.participants.some(p => p.imageProfile) ?? false}
                  showAddCharacter={isSingleCharacterChat}
                  chatId={id}
                  chatMemoryCount={chatMemoryCount}
                />
              </div>
            </div>
            {showPreview ? (
              <div className="qt-chat-composer-input overflow-y-auto"
                style={{
                  lineHeight: '1.5'
                }}
              >
                <MessageContent content={input} roleplayTemplateName={roleplayTemplateName} />
              </div>
            ) : (
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  resizeTextarea(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    // Shift+Enter: insert newline, don't submit
                    e.preventDefault()
                    const textarea = e.currentTarget
                    const start = textarea.selectionStart
                    const end = textarea.selectionEnd
                    const newValue = input.substring(0, start) + '\n' + input.substring(end)
                    setInput(newValue)
                    // Move cursor after the inserted newline
                    setTimeout(() => {
                      textarea.selectionStart = textarea.selectionEnd = start + 1
                      resizeTextarea(textarea)
                    }, 0)
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    // Enter (without Shift): submit form
                    e.preventDefault()
                    if (input.trim() || attachedFiles.length > 0) {
                      const form = e.currentTarget.form
                      if (form) {
                        form.dispatchEvent(new Event('submit', { bubbles: true }))
                      }
                    }
                  }
                }}
                disabled={sending || !hasActiveCharacters}
                rows={1}
                placeholder={!hasActiveCharacters ? "Add a character to start chatting..." : attachedFiles.length > 0 ? "Add a message (optional)..." : "Type a message..."}
                className="qt-chat-composer-input resize-none overflow-y-auto"
                style={{
                  lineHeight: '1.5'
                }}
              />
            )}
            {/* Buttons column - right side */}
            <div className="qt-chat-toolbar">
              {/* Send button */}
              <button
                type="submit"
                disabled={sending || (!input.trim() && attachedFiles.length === 0) || !hasActiveCharacters}
                className="qt-chat-composer-send"
                title={!hasActiveCharacters ? "Add a character to start chatting" : "Send message"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
              {/* Continue button - Phase 7: Pass turn to next character */}
              {isMultiChar && hasActiveCharacters && (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={
                    streaming ||
                    waitingForResponse ||
                    turnSelectionResult?.nextSpeakerId !== null
                  }
                  className="qt-chat-toolbar-button qt-chat-continue-button"
                  title={
                    turnSelectionResult?.nextSpeakerId !== null
                      ? "It's not your turn"
                      : "Pass turn to next character"
                  }
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
              {/* Toggle Preview button */}
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="qt-chat-toolbar-button"
                title="Toggle preview"
              >
                {showPreview ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Image Modal */}
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
          // Refresh chat to update message attachments
          fetchChat()
        }}
      />

      {/* Photo Gallery Modal */}
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
          // Update messages to show deleted indicator for this file
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.attachments?.some((a) => a.id === fileId)) {
                // Remove the attachment and add deleted indicator to content
                const newAttachments = msg.attachments.filter((a) => a.id !== fileId)
                const newContent = msg.content.includes('[attached photo deleted]')
                  ? msg.content
                  : `${msg.content} [attached photo deleted]`
                return { ...msg, attachments: newAttachments, content: newContent }
              }
              return msg
            })
          )
          // Refresh photo count
          fetchChatPhotoCount()
        }}
      />

      {/* Chat Settings Modal */}
      <ChatSettingsModal
        isOpen={chatSettingsModalOpen}
        onClose={() => setChatSettingsModalOpen(false)}
        chatId={id}
        participants={chat?.participants || []}
        roleplayTemplateId={chat?.roleplayTemplateId}
        onSuccess={fetchChat}
      />

      {/* Generate Image Dialog */}
      <GenerateImageDialog
        isOpen={generateImageDialogOpen}
        onClose={() => setGenerateImageDialogOpen(false)}
        chatId={id}
        participants={chat?.participants || []}
        imageProfileId={chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)?.imageProfile?.id}
        onImagesGenerated={(images, prompt) => {
          // Save tool result message to chat
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
              // Refresh chat to show the new tool message
              fetchChat()
            })
            .catch((err) => clientLogger.error('Failed to save tool result:', { error: err instanceof Error ? err.message : String(err) }))

          // Attach generated images to the next message
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
      </div>

      {/* Participant Sidebar - shown for multi-character chats when debug mode is off */}
      {shouldShowParticipantSidebar && (
        <ParticipantSidebar
          participants={participantData}
          turnState={turnState}
          turnSelectionResult={turnSelectionResult}
          isGenerating={streaming || waitingForResponse}
          userParticipantId={userParticipantId}
          onNudge={handleNudge}
          onQueue={handleQueue}
          onDequeue={handleDequeue}
          onTalkativenessChange={handleTalkativenessChange}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
        />
      )}

      {/* Add Character Dialog - Phase 6 */}
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
  )
}
