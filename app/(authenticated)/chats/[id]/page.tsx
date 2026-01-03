'use client'

import { use, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import ImageModal from '@/components/chat/ImageModal'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import ToolPalette from '@/components/chat/ToolPalette'
import MobileToolPalette from '@/components/chat/MobileToolPalette'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import ChatRenameModal from '@/components/chat/ChatRenameModal'
import GenerateImageDialog from '@/components/chat/GenerateImageDialog'
import ParticipantSidebar from '@/components/chat/ParticipantSidebar'
import MobileParticipantDropdown from '@/components/chat/MobileParticipantDropdown'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'
import ReattributeMessageDialog from '@/components/chat/ReattributeMessageDialog'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import AllLLMPauseModal from '@/components/chat/AllLLMPauseModal'
import { MemoryCascadeDialog } from '@/components/ui/MemoryCascadeDialog'
import { getPendingMessageNavigation, scrollToMessage } from '@/lib/chat/message-navigation'
import SelectLLMProfileDialog from '@/components/chat/SelectLLMProfileDialog'
import SpeakerSelector from '@/components/chat/SpeakerSelector'
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
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
  findUserControlledParticipants,
  isMultiCharacterChat,
  isAllLLMChat,
  getQueuePosition,
  resetCycleForUserSkip,
  getActiveLLMParticipants,
  shouldPauseForAllLLM,
  getNextPauseThreshold,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

// Import extracted hooks
import {
  useChatData,
  useTurnManagement,
  useMessageActions,
  useFileAttachments,
  type SwipeState,
} from './hooks'
import type { Chat, ChatSettings, Message, MessageAttachment, Participant, CharacterData } from './types'
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
  const [roleplayRenderingPatterns, setRoleplayRenderingPatterns] = useState<RenderingPattern[] | undefined>(undefined)
  const [roleplayDialogueDetection, setRoleplayDialogueDetection] = useState<DialogueDetection | null | undefined>(undefined)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false)
  const [mobileToolPaletteOpen, setMobileToolPaletteOpen] = useState(false)
  const [documentEditingMode, setDocumentEditingMode] = useState(false)
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [reattributeDialogState, setReattributeDialogState] = useState<{
    isOpen: boolean
    messageId: string
    currentParticipantId: string | null
  } | null>(null)
  const [searchReplaceModalOpen, setSearchReplaceModalOpen] = useState(false)
  const [toolExecutionStatus, setToolExecutionStatus] = useState<{ tool: string; status: 'pending' | 'success' | 'error'; message: string } | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ id: string; name: string; status: 'pending' | 'success' | 'error'; result?: unknown; arguments?: Record<string, unknown> }>>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [mobileParticipantDropdownId, setMobileParticipantDropdownId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)

  // Impersonation state (Characters Not Personas)
  const [impersonatingParticipantIds, setImpersonatingParticipantIds] = useState<string[]>([])
  const [activeTypingParticipantId, setActiveTypingParticipantId] = useState<string | null>(null)
  const [allLLMPauseTurnCount, setAllLLMPauseTurnCount] = useState(0)
  const [allLLMPauseModalOpen, setAllLLMPauseModalOpen] = useState(false)
  const [selectLLMProfileDialogState, setSelectLLMProfileDialogState] = useState<{
    isOpen: boolean
    participantId: string
    character: {
      id: string
      name: string
      defaultImage?: { id: string; filepath: string; url?: string } | null
      avatarUrl?: string | null
      defaultConnectionProfileId?: string | null
    } | null
  } | null>(null)

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
  const lastAllLLMPauseTurnCountRef = useRef<number>(0) // Track turn count at last auto-pause
  const draftSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedDraftRef = useRef<string>('')
  const hasRestoredDraftRef = useRef<boolean>(false)
  // Ref for triggerContinueMode to break dependency cycle in auto-trigger useEffect
  const triggerContinueModeRef = useRef<(participantId: string) => Promise<void>>(async () => {})

  // Draft persistence - localStorage key for this chat
  const draftStorageKey = `quilltap-draft-${id}`

  // Restore draft from localStorage on mount
  useEffect(() => {
    if (hasRestoredDraftRef.current) return
    hasRestoredDraftRef.current = true

    try {
      const savedDraft = localStorage.getItem(draftStorageKey)
      if (savedDraft) {
        setInput(savedDraft)
        lastSavedDraftRef.current = savedDraft
      }
    } catch (err) {
      clientLogger.warn('[Chat] Failed to restore draft from localStorage', { error: err })
    }
  }, [draftStorageKey])

  // Save draft to localStorage with debouncing (5 second minimum)
  useEffect(() => {
    // Don't save if input hasn't changed from last save
    if (input === lastSavedDraftRef.current) return

    // Clear any existing timer
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current)
    }

    // Set new timer for 5 seconds
    draftSaveTimerRef.current = setTimeout(() => {
      try {
        if (input.trim()) {
          localStorage.setItem(draftStorageKey, input)
          lastSavedDraftRef.current = input
        } else {
          // Clear draft if input is empty
          localStorage.removeItem(draftStorageKey)
          lastSavedDraftRef.current = ''
        }
      } catch (err) {
        clientLogger.warn('[Chat] Failed to save draft to localStorage', { error: err })
      }
    }, 5000)

    // Cleanup timer on unmount or input change
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current)
      }
    }
  }, [input, draftStorageKey])

  // Helper to clear draft (called on successful submission)
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftStorageKey)
      lastSavedDraftRef.current = ''
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current)
        draftSaveTimerRef.current = null
      }
    } catch (err) {
      clientLogger.warn('[Chat] Failed to clear draft from localStorage', { error: err })
    }
  }, [draftStorageKey])

  // Cleanup effect: abort any pending request when unmounting or chat changes
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        clientLogger.debug('[Chat] Cleanup: aborting pending request on unmount')
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [id])

  // Handle scroll-to-message from memory provenance navigation
  useEffect(() => {
    // Only check once messages are loaded
    if (loading || messages.length === 0) return

    const pendingNav = getPendingMessageNavigation()
    if (pendingNav.scrollTo) {
      clientLogger.debug('[Chat] Pending message navigation found', {
        scrollTo: pendingNav.scrollTo,
        highlight: pendingNav.highlight,
      })
      // Wait a bit for DOM to be ready, then scroll
      setTimeout(() => {
        scrollToMessage(pendingNav.scrollTo!, {
          behavior: 'smooth',
          highlight: !!pendingNav.highlight,
          highlightDuration: 3000,
        })
      }, 500)
    }
  }, [loading, messages.length])

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
    // Set to 0 first to force browser to recalculate scrollHeight for shrinking
    textarea.style.height = '0'
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
      controlledBy: p.controlledBy ?? (p.type === 'PERSONA' ? 'user' : 'llm'),
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

  // Update browser tab title with chat name
  useDocumentTitle(chat?.title ?? null)

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
      controlledBy: p.controlledBy ?? (p.type === 'PERSONA' ? 'user' : 'llm'),
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

  // Characters the user can speak as (for SpeakerSelector)
  const controlledCharacters = useMemo(() => {
    const result: Array<{
      participantId: string
      characterId: string
      name: string
      character: {
        defaultImage?: { id: string; filepath: string; url?: string } | null
        avatarUrl?: string | null
      } | null
    }> = []

    // Add user-controlled participants (PERSONA type or controlledBy: 'user')
    for (const p of participantData) {
      const isUserControlled = p.type === 'PERSONA' || p.controlledBy === 'user'
      const isImpersonating = impersonatingParticipantIds.includes(p.id)
      if ((isUserControlled || isImpersonating) && p.isActive) {
        const entity = p.character || p.persona
        if (entity) {
          result.push({
            participantId: p.id,
            characterId: entity.id,
            name: entity.name,
            character: {
              defaultImage: entity.defaultImage,
              avatarUrl: entity.avatarUrl,
            },
          })
        }
      }
    }

    return result
  }, [participantData, impersonatingParticipantIds])

  // LLM participants for AllLLMPauseModal
  const llmParticipants = useMemo(() => {
    return participantData
      .filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user' && !impersonatingParticipantIds.includes(p.id))
      .map(p => ({
        id: p.id,
        characterId: p.character?.id || '',
        characterName: p.character?.name || 'Unknown',
        character: p.character ? {
          defaultImage: p.character.defaultImage,
          avatarUrl: p.character.avatarUrl,
        } : null,
      }))
  }, [participantData, impersonatingParticipantIds])

  // Check if this is an all-LLM chat (no user-controlled participants)
  const isAllLLM = useMemo(() => {
    return isAllLLMChat(participantsAsBase)
  }, [participantsAsBase])

  // Count turns since last user message (for all-LLM pause logic)
  const allLLMTurnCount = useMemo(() => {
    if (!isAllLLM) return 0
    // Count ASSISTANT messages since the last USER message
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'USER') break
      if (messages[i].role === 'ASSISTANT') count++
    }
    return count
  }, [isAllLLM, messages])

  // Compute effective next speaker for all-LLM chats (recalculates if turnSelectionResult shows null)
  const effectiveNextSpeakerId = useMemo(() => {
    if (!turnSelectionResult) return null
    // If turnSelectionResult has a speaker, use it
    if (turnSelectionResult.nextSpeakerId !== null) {
      return turnSelectionResult.nextSpeakerId
    }
    // For all-LLM chats with null nextSpeakerId, recalculate to get a valid speaker
    if (isAllLLM && participantsAsBase.length > 0 && charactersMap.size > 0) {
      const freshResult = selectNextSpeaker(participantsAsBase, charactersMap, turnState, userParticipantId)
      return freshResult.nextSpeakerId
    }
    return null
  }, [turnSelectionResult, isAllLLM, participantsAsBase, charactersMap, turnState, userParticipantId])

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
    messagesEndRef as React.RefObject<HTMLDivElement>,
    chatSettings,
  )

  // Unpause callback for the turn management hook - needs to be defined before the hook call
  const unpauseChat = useCallback(async () => {
    setIsPaused(false)
    userStoppedStreamRef.current = false
    try {
      const response = await fetch(`/api/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { isPaused: false } }),
      })
      if (!response.ok) {
        clientLogger.error('[Chat] Failed to persist unpause state', { status: response.status })
      }
    } catch (error) {
      clientLogger.error('[Chat] Error persisting unpause state', { error })
    }
  }, [id])

  // Stable callback wrapper using ref - avoids recreating on every render
  const stableTriggerContinueMode = useCallback(
    async (participantId: string) => {
      await triggerContinueModeRef.current(participantId)
    },
    [] // Empty deps - uses ref internally
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
    stableTriggerContinueMode,
    isPaused,
    unpauseChat,
  )

  // Calculate turn state when messages change - copied from original
  useEffect(() => {
    if (participantsAsBase.length === 0 || messages.length === 0) return

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

      // Check if this is an all-LLM chat (no user-controlled participants)
      const chatIsAllLLM = isAllLLMChat(participantsAsBase)

      if (persistedParticipantId === null) {
        // Don't restore "user's turn" for all-LLM chats - they should auto-continue
        if (result.nextSpeakerId !== null && !chatIsAllLLM) {
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
          result = {
            ...result,
            nextSpeakerId: persistedParticipantId,
            reason: 'queue',
          }
        }
      }
    }

    setTurnSelectionResult(result)
  }, [messages, participantsAsBase, userParticipantId, charactersMap, chat?.lastTurnParticipantId])

  // Initialize isPaused from chat data
  useEffect(() => {
    if (chat?.isPaused !== undefined) {
      setIsPaused(chat.isPaused)
      if (chat.isPaused) {
        // Also set the ref to prevent auto-triggering on page load
        userStoppedStreamRef.current = true
      }
    }
  }, [chat?.isPaused])

  // Initialize documentEditingMode from chat data
  useEffect(() => {
    if (chat?.documentEditingMode !== undefined) {
      setDocumentEditingMode(chat.documentEditingMode)
    }
  }, [chat?.documentEditingMode])

  // Initialize lastAllLLMPauseTurnCountRef when chat loads as paused
  // This prevents immediate re-pause when user clicks Resume after page refresh
  useEffect(() => {
    if (chat?.isPaused && isAllLLM && allLLMTurnCount > 0) {
      lastAllLLMPauseTurnCountRef.current = allLLMTurnCount
      clientLogger.debug('[Chat] Initialized all-LLM pause count from persisted state', {
        turnCount: allLLMTurnCount,
      })
    }
  }, [chat?.isPaused, isAllLLM, allLLMTurnCount])

  // Initialize impersonation state from chat metadata
  // We intentionally only depend on specific chat properties to avoid re-running on every chat update
  useEffect(() => {
    const impersonatingIds = chat?.impersonatingParticipantIds
    const activeTypingId = chat?.activeTypingParticipantId
    const pauseTurnCount = chat?.allLLMPauseTurnCount

    if (impersonatingIds && impersonatingIds.length > 0) {
      clientLogger.debug('[Chat] Restoring impersonation state', {
        impersonatingParticipantIds: impersonatingIds,
        activeTypingParticipantId: activeTypingId,
      })
      setImpersonatingParticipantIds(impersonatingIds)
      setActiveTypingParticipantId(activeTypingId ?? null)
    }
    if (pauseTurnCount !== undefined) {
      setAllLLMPauseTurnCount(pauseTurnCount)
    }
  }, [chat?.impersonatingParticipantIds, chat?.activeTypingParticipantId, chat?.allLLMPauseTurnCount])

  // triggerContinueMode function - large streaming logic kept in place
  const triggerContinueMode = useCallback(async (participantId: string) => {
    if (streaming || waitingForResponse) {
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


    // Abort any existing request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setWaitingForResponse(true)
    setStreaming(false)
    setStreamingContent('')
    setRespondingParticipantId(participantId)

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

              if (data.error) {
                // Include details in error message if available
                const errorMsg = data.details
                  ? `${data.error}: ${data.details}`
                  : data.error
                throw new Error(errorMsg)
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
              }
            } catch (parseError) {
              // Rethrow actual errors (from data.error), ignore JSON parse errors
              if (parseError instanceof Error && !parseError.message.includes('JSON')) {
                throw parseError
              }
              // Ignore JSON parse errors (SSE chunking artifacts)
            }
          }
        }
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) {
        // Extract error message, handling cases where message may be undefined
        const errorMessage = err instanceof Error
          ? (err.message || err.name || 'Unknown error')
          : String(err) || 'Unknown error'
        const errorName = err instanceof Error ? err.name : 'UnknownErrorType'

        clientLogger.error('[Chat] Continue mode error:', {
          error: errorMessage,
          errorName,
          errorType: typeof err,
        })
        showErrorToast(errorMessage || 'Failed to generate response')
      }
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      setStreamingContent('')
      setRespondingParticipantId(null)
      abortControllerRef.current = null
      scrollToBottom()
      // Return focus to input after AI response completes
      // Use longer timeout to let smooth scroll settle, and preventScroll to avoid conflicts
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 150)
    }
  }, [id, streaming, waitingForResponse, participantsAsBase, turnManagement.hasActiveCharacters, setMessages, setEphemeralMessages])

  // Keep the ref in sync with the current callback to break dependency cycle
  triggerContinueModeRef.current = triggerContinueMode

  // Function to set pause state and persist to database
  const setPauseState = useCallback(async (paused: boolean) => {
    setIsPaused(paused)
    userStoppedStreamRef.current = paused

    try {
      const response = await fetch(`/api/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { isPaused: paused } }),
      })
      if (!response.ok) {
        clientLogger.error('[Chat] Failed to persist pause state', { status: response.status })
      }
    } catch (error) {
      clientLogger.error('[Chat] Error persisting pause state', { error })
    }
  }, [id])

  // Toggle document editing mode and persist to database
  const handleToggleDocumentEditingMode = useCallback(async () => {
    const newMode = !documentEditingMode
    setDocumentEditingMode(newMode)
    clientLogger.debug('[Chat] Toggling document editing mode', { from: documentEditingMode, to: newMode })

    try {
      const response = await fetch(`/api/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { documentEditingMode: newMode } }),
      })
      if (!response.ok) {
        clientLogger.error('[Chat] Failed to persist document editing mode', { status: response.status })
      }
    } catch (error) {
      clientLogger.error('[Chat] Error persisting document editing mode', { error })
    }
  }, [id, documentEditingMode])

  // Auto-trigger next character in multi-character mode
  useEffect(() => {
    if (!isMultiChar) return
    if (isPaused) return
    if (userStoppedStreamRef.current) return
    if (streaming || waitingForResponse) return
    if (abortControllerRef.current) return
    if (!turnSelectionResult) return

    // Use the pre-computed effective next speaker (handles all-LLM recalculation)
    if (effectiveNextSpeakerId === null) {
      lastAutoTriggeredRef.current = null
      return
    }

    if (effectiveNextSpeakerId === userParticipantId) return

    // Check if we should pause for all-LLM chat threshold
    // Only pause if we've exceeded the last paused turn count (prevents immediate re-pause on resume)
    if (isAllLLM && shouldPauseForAllLLM(allLLMTurnCount) && allLLMTurnCount > lastAllLLMPauseTurnCountRef.current) {
      clientLogger.info('[Chat] All-LLM pause threshold reached, auto-pausing', {
        turnCount: allLLMTurnCount,
        lastPausedAt: lastAllLLMPauseTurnCountRef.current,
        nextThreshold: getNextPauseThreshold(allLLMTurnCount),
      })
      // Track the turn count at which we paused
      lastAllLLMPauseTurnCountRef.current = allLLMTurnCount
      // Auto-pause the chat
      setPauseState(true)
      showInfoToast(`Auto-paused after ${allLLMTurnCount} turns. Click Resume to continue.`)
      return
    }

    if (lastAutoTriggeredRef.current === effectiveNextSpeakerId) return

    clientLogger.info('[Chat] Auto-triggering next character in multi-character mode', {
      nextSpeakerId: effectiveNextSpeakerId,
      reason: turnSelectionResult.reason,
      isAllLLM,
      allLLMTurnCount,
    })

    lastAutoTriggeredRef.current = effectiveNextSpeakerId

    const timeoutId = setTimeout(() => {
      // Use ref to avoid dependency cycle - the ref always has the latest callback
      triggerContinueModeRef.current(effectiveNextSpeakerId)
    }, 100)

    return () => clearTimeout(timeoutId)
    // Note: triggerContinueMode is accessed via ref to break dependency cycle that was causing infinite updates
  }, [isMultiChar, isPaused, streaming, waitingForResponse, turnSelectionResult, userParticipantId, isAllLLM, allLLMTurnCount, setPauseState, effectiveNextSpeakerId])

  // Toggle pause state
  const togglePause = useCallback(async () => {
    const newPausedState = !isPaused
    clientLogger.info('[Chat] Toggling pause state', { from: isPaused, to: newPausedState })
    await setPauseState(newPausedState)
    if (newPausedState) {
      showInfoToast('Auto-responses paused')
    } else {
      showInfoToast('Auto-responses resumed')
    }
  }, [isPaused, setPauseState])

  // stopStreaming function
  const stopStreaming = useCallback(() => {
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
      userStoppedStreamRef.current = true
      // Also pause the chat persistently
      setPauseState(true)
    }
    if (streamingContent) {
      clientLogger.info('[Chat] Streaming stopped with partial content', {
        contentLength: streamingContent.length,
      })
      showInfoToast('Response stopped - chat paused')
    }
    setStreamingContent('')
  }, [streamingContent, isMultiChar, setPauseState])

  // Persist turn state effect
  useEffect(() => {
    if (!isMultiChar) return
    if (streaming || waitingForResponse) return
    if (turnSelectionResult === null) return

    persistTurnState(turnSelectionResult.nextSpeakerId)
  }, [isMultiChar, streaming, waitingForResponse, turnSelectionResult, persistTurnState])

  // Character management handlers
  const handleAddCharacter = useCallback(() => {
    setAddCharacterDialogOpen(true)
  }, [])

  // Rename handler
  const handleRenameClick = useCallback(() => {
    setRenameModalOpen(true)
  }, [])

  const handleCharacterAdded = useCallback(() => {
    clientLogger.info('[Chat] Character added, refreshing chat data')
    fetchChat()
  }, [fetchChat])

  const handleReattribute = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      clientLogger.debug('[Chat] Opening re-attribute dialog', { // Useful for debugging message re-attribution
        messageId,
        currentParticipantId: message.participantId,
      })
      setReattributeDialogState({
        isOpen: true,
        messageId,
        currentParticipantId: message.participantId || null,
      })
    }
  }, [messages])

  const handleReattributed = useCallback(async () => {
    const messageId = reattributeDialogState?.messageId
    clientLogger.info('[Chat] Message re-attributed, refreshing chat data', { messageId })
    setReattributeDialogState(null)
    await fetchChat()
    // Scroll to the reattributed message after refresh
    if (messageId) {
      setTimeout(() => {
        const messageElement = document.getElementById(`message-${messageId}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          clientLogger.debug('[Chat] Scrolled to reattributed message', { messageId })
        }
      }, 100) // Small delay to ensure DOM is updated
    }
  }, [fetchChat, reattributeDialogState?.messageId])

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

  // Impersonation handlers
  const handleStartImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    clientLogger.info('[Chat] Starting impersonation', {
      participantId,
      characterName,
    })

    try {
      const res = await fetch(`/api/chats/${id}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to start impersonation')
      }

      const data = await res.json()

      // Update local state
      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || participantId)

      showSuccessToast(`Now speaking as ${characterName}`)
      clientLogger.info('[Chat] Impersonation started', { participantId, characterName })
    } catch (err) {
      clientLogger.error('[Chat] Error starting impersonation', {
        error: err instanceof Error ? err.message : String(err),
        participantId,
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to start impersonation')
    }
  }, [id, participantData])

  const handleStopImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    clientLogger.info('[Chat] Stopping impersonation', {
      participantId,
      characterName,
    })

    // Check if we need to show the LLM profile selection dialog
    // This is needed when the character doesn't have a default connection profile
    const character = participant?.character
    if (character && !participant?.connectionProfile) {
      clientLogger.debug('[Chat] Character needs LLM profile, showing dialog', {
        characterId: character.id,
        characterName: character.name,
      })
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

    // Otherwise, stop impersonation directly
    try {
      const res = await fetch(`/api/chats/${id}/impersonate`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to stop impersonation')
      }

      const data = await res.json()

      // Update local state
      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`Stopped speaking as ${characterName}`)
      clientLogger.info('[Chat] Impersonation stopped', { participantId, characterName })
    } catch (err) {
      clientLogger.error('[Chat] Error stopping impersonation', {
        error: err instanceof Error ? err.message : String(err),
        participantId,
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to stop impersonation')
    }
  }, [id, participantData])

  const handleConfirmStopImpersonation = useCallback(async (participantId: string, connectionProfileId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    clientLogger.info('[Chat] Confirming stop impersonation with profile', {
      participantId,
      connectionProfileId,
    })

    try {
      const res = await fetch(`/api/chats/${id}/impersonate`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, newConnectionProfileId: connectionProfileId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to stop impersonation')
      }

      const data = await res.json()

      // Update local state
      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`${characterName} is now controlled by AI`)
      clientLogger.info('[Chat] Impersonation stopped with profile', { participantId, connectionProfileId })

      // Refresh chat to get updated participant connection profile
      await fetchChat()
    } catch (err) {
      clientLogger.error('[Chat] Error stopping impersonation with profile', {
        error: err instanceof Error ? err.message : String(err),
        participantId,
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to assign LLM profile')
    }
  }, [id, participantData, fetchChat])

  const handleSetActiveSpeaker = useCallback(async (participantId: string) => {
    clientLogger.debug('[Chat] Setting active speaker', { participantId })

    try {
      const res = await fetch(`/api/chats/${id}/active-speaker`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to set active speaker')
      }

      const data = await res.json()
      setActiveTypingParticipantId(participantId)

      // Update impersonating IDs in case the API auto-added this participant
      if (data.impersonatingParticipantIds) {
        setImpersonatingParticipantIds(data.impersonatingParticipantIds)
      }
    } catch (err) {
      clientLogger.error('[Chat] Error setting active speaker', {
        error: err instanceof Error ? err.message : String(err),
        participantId,
      })
      showErrorToast(err instanceof Error ? err.message : 'Failed to set active speaker')
    }
  }, [id])

  // All-LLM pause handlers
  const handleAllLLMContinue = useCallback((turnsToAdd: number) => {
    clientLogger.debug('[Chat] All-LLM continue', { turnsToAdd })
    setAllLLMPauseModalOpen(false)
    // The turn count will be incremented by the server after each message
  }, [])

  const handleAllLLMStop = useCallback(() => {
    clientLogger.debug('[Chat] All-LLM stop')
    setAllLLMPauseModalOpen(false)
    setPauseState(true)
  }, [setPauseState])

  const handleAllLLMTakeOver = useCallback(async (participantId: string) => {
    clientLogger.debug('[Chat] All-LLM take over', { participantId })
    setAllLLMPauseModalOpen(false)
    await handleStartImpersonation(participantId)
  }, [handleStartImpersonation])

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
    const fetchTemplateData = async () => {
      if (!chat?.roleplayTemplateId) {
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
        return
      }

      try {
        const res = await fetch(`/api/roleplay-templates/${chat.roleplayTemplateId}`)
        if (res.ok) {
          const template = await res.json()
          setRoleplayTemplateName(template.name)
          setRoleplayRenderingPatterns(template.renderingPatterns)
          setRoleplayDialogueDetection(template.dialogueDetection)
          clientLogger.debug('[Chat] Fetched roleplay template data', {
            templateId: chat.roleplayTemplateId,
            templateName: template.name,
            hasRenderingPatterns: !!template.renderingPatterns?.length,
            hasDialogueDetection: !!template.dialogueDetection,
          })
        } else {
          setRoleplayTemplateName(null)
          setRoleplayRenderingPatterns(undefined)
          setRoleplayDialogueDetection(undefined)
        }
      } catch (err) {
        clientLogger.error('[Chat] Error fetching roleplay template', {
          error: err instanceof Error ? err.message : String(err),
        })
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
      }
    }

    fetchTemplateData()
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

  // Focus textarea when generation completes (streaming/waiting goes from true to false)
  const wasGeneratingRef = useRef(false)
  useEffect(() => {
    const isGenerating = streaming || waitingForResponse || sending

    if (wasGeneratingRef.current && !isGenerating) {
      // Just finished generating - focus the textarea
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 100)
    }

    wasGeneratingRef.current = isGenerating
  }, [streaming, waitingForResponse, sending])

  // Main sendMessage function
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachedFiles.length === 0) || sending) return

    // Reset auto-trigger ref when user sends a message (new turn cycle starts)
    lastAutoTriggeredRef.current = null
    // Only clear the user-stopped flag if NOT paused - respect pause state
    if (!isPaused) {
      userStoppedStreamRef.current = false
    }

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
    clearDraft()
    setAttachedFiles([])
    setSending(true)
    setWaitingForResponse(true)
    setStreaming(false)
    setStreamingContent('')
    // Set the responding participant for correct avatar display during streaming
    // For normal messages, the server uses the first active character
    const firstCharParticipant = getFirstCharacterParticipant()
    setRespondingParticipantId(firstCharParticipant?.id || null)
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
      // Create AbortController for this request
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal,
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
            const rawData = line.slice(6).trim()
            // Skip SSE markers that aren't JSON (OpenAI/OpenRouter use [DONE] to signal end of stream)
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
                // Include details in error message if available
                const errorMsg = data.details
                  ? `${data.error}: ${data.details}`
                  : data.error
                throw new Error(errorMsg)
              }
            } catch (parseError) {
              // Only log if it's a real parse error, not noise from SSE chunking
              // Note: rawData is already trimmed and we've skipped empty/[DONE]/{} before try block
              const errorMessage = getErrorMessage(parseError)
              // Skip logging for generic stringified objects, empty error messages,
              // or errors that look like empty JSON objects (various SSE chunk artifacts)
              const trimmedError = errorMessage.trim()
              const trimmedRaw = rawData.trim()
              const shouldSkip = !errorMessage ||
                !trimmedError ||
                trimmedError === 'undefined' ||
                trimmedError === '[object Object]' ||
                trimmedError === '{}' ||
                trimmedError === '{ }' ||
                /^\{\s*\}$/.test(trimmedError) ||
                // Also skip if the raw data itself is empty-ish (shouldn't happen but defensive)
                !trimmedRaw ||
                trimmedRaw === '{}' ||
                /^\{\s*\}$/.test(trimmedRaw) ||
                // Skip if it's a server-side error message (already logged on server)
                trimmedRaw.includes('"error":')
              if (!shouldSkip) {
                clientLogger.debug('SSE parse issue (may be chunking artifact):', { rawLength: rawData.length })
              }
            }
          }
        }
      }
    } catch (err) {
      // Check if this was an abort (user stopped the response)
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (isAbort) {
        // Debug: Mark entries as aborted
        if (debug?.isDebugMode) {
          if (debugEntryId) {
            debug.updateEntry(debugEntryId, { status: 'complete', error: 'Aborted by user' })
          }
          if (responseEntryId) {
            debug.updateEntry(responseEntryId, { status: 'complete', error: 'Aborted by user' })
          }
        }
        // Don't remove user message or show error for abort
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
      } else {
        // Extract error message, handling cases where message may be undefined
        const errorMessage = err instanceof Error
          ? (err.message || err.name || 'Unknown error')
          : String(err) || 'Unknown error'
        const errorName = err instanceof Error ? err.name : 'UnknownErrorType'

        clientLogger.error('Error sending message:', {
          error: errorMessage,
          errorName,
          errorType: typeof err,
        })
        showErrorToast(errorMessage || 'Failed to send message')

        // Debug: Mark entries as error
        if (debug?.isDebugMode) {
          if (debugEntryId) {
            debug.updateEntry(debugEntryId, { status: 'error', error: errorMessage })
          }
          if (responseEntryId) {
            debug.updateEntry(responseEntryId, { status: 'error', error: errorMessage })
          }
        }

        // Remove the temporary user message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMessageId))
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
      }
    } finally {
      setSending(false)
      abortControllerRef.current = null
      // Return focus to input after send completes
      // Use longer timeout to let smooth scroll settle, and preventScroll to avoid conflicts
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 150)
    }
  }

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
        {/* Project Indicator Banner */}
        {chat.projectId && chat.projectName && (
          <div className="border-b border-border/60 bg-card/50 px-4 py-2">
            <a
              href={`/projects/${chat.projectId}`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>{chat.projectName}</span>
            </a>
          </div>
        )}
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
                  renderingPatterns={roleplayRenderingPatterns}
                  dialogueDetection={roleplayDialogueDetection}
                  isMultiChar={isMultiChar}
                  participantData={participantData}
                  turnState={turnState}
                  streaming={streaming}
                  waitingForResponse={waitingForResponse}
                  mobileParticipantDropdownId={mobileParticipantDropdownId}
                  mobileParticipantRefs={mobileParticipantRefs}
                  userParticipantId={userParticipantId}
                  isPaused={isPaused}
                  onTogglePause={togglePause}
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
                  }}
                  onHandleRemoveCharacter={handleRemoveCharacter}
                  onHandleContinue={turnManagement.handleContinue}
                  onReattribute={handleReattribute}
                />
              )
            })}

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
              renderingPatterns={roleplayRenderingPatterns}
              dialogueDetection={roleplayDialogueDetection}
              shouldShowAvatars={shouldShowAvatars()}
              onStopClick={stopStreaming}
            />

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Speaker Selector - shown when controlling multiple characters */}
        {controlledCharacters.length >= 2 && (
          <div className="qt-chat-speaker-selector px-4 py-2 border-t border-border">
            <SpeakerSelector
              characters={controlledCharacters}
              activeParticipantId={activeTypingParticipantId}
              onSelect={handleSetActiveSpeaker}
              disabled={streaming || waitingForResponse}
            />
          </div>
        )}

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
          renderingPatterns={roleplayRenderingPatterns}
          dialogueDetection={roleplayDialogueDetection}
          chatPhotoCount={chatPhotoCount}
          chatMemoryCount={chatMemoryCount}
          hasImageProfile={chat?.participants.some(p => p.imageProfile) ?? false}
          isSingleCharacterChat={isSingleCharacterChat}
          roleplayTemplateId={chat?.roleplayTemplateId}
          documentEditingMode={documentEditingMode}
          onToggleDocumentEditingMode={handleToggleDocumentEditingMode}
          onSubmit={sendMessage}
          onFileSelect={handleFileSelect}
          onAttachFileClick={() => {
            // File input ref will be created in component
          }}
          onGalleryClick={() => setGalleryOpen(true)}
          onGenerateImageClick={() => setGenerateImageDialogOpen(true)}
          onAddCharacterClick={handleAddCharacter}
          onSettingsClick={() => setChatSettingsModalOpen(true)}
          onRenameClick={handleRenameClick}
          onDeleteChatMemoriesClick={handleDeleteChatMemories}
          onReextractMemoriesClick={handleReextractMemories}
          onSearchReplaceClick={() => setSearchReplaceModalOpen(true)}
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
          projectId={chat?.projectId}
          onSuccess={fetchChat}
        />

        <ChatRenameModal
          isOpen={renameModalOpen}
          onClose={() => setRenameModalOpen(false)}
          chatId={id}
          currentTitle={chat?.title || ''}
          isManuallyRenamed={chat?.isManuallyRenamed ?? false}
          onSuccess={(newTitle, isManuallyRenamed) => {
            clientLogger.info('[Chat] Rename successful', { newTitle, isManuallyRenamed })
            // Update local chat state with new title
            if (chat) {
              setChat({ ...chat, title: newTitle, isManuallyRenamed })
            }
          }}
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

        {reattributeDialogState && chat && (
          <ReattributeMessageDialog
            isOpen={reattributeDialogState.isOpen}
            onClose={() => setReattributeDialogState(null)}
            messageId={reattributeDialogState.messageId}
            currentParticipantId={reattributeDialogState.currentParticipantId}
            participants={chat.participants}
            onReattributed={handleReattributed}
          />
        )}

        <SearchReplaceModal
          isOpen={searchReplaceModalOpen}
          onClose={() => setSearchReplaceModalOpen(false)}
          initialScope={{ type: 'chat', chatId: id }}
          currentChatId={id}
          chatTitle={chat?.title}
        />

        {/* All-LLM Pause Modal */}
        <AllLLMPauseModal
          isOpen={allLLMPauseModalOpen}
          onClose={() => setAllLLMPauseModalOpen(false)}
          turnCount={allLLMPauseTurnCount}
          nextPauseAt={getNextPauseThreshold(allLLMPauseTurnCount)}
          participants={llmParticipants}
          onContinue={handleAllLLMContinue}
          onStop={handleAllLLMStop}
          onTakeOver={handleAllLLMTakeOver}
        />

        {/* Select LLM Profile Dialog (for stopping impersonation) */}
        {selectLLMProfileDialogState && (
          <SelectLLMProfileDialog
            isOpen={selectLLMProfileDialogState.isOpen}
            onClose={() => setSelectLLMProfileDialogState(null)}
            character={selectLLMProfileDialogState.character}
            participantId={selectLLMProfileDialogState.participantId}
            onConfirm={handleConfirmStopImpersonation}
            onCancel={() => setSelectLLMProfileDialogState(null)}
          />
        )}

        {/* Memory Cascade Confirmation Dialog */}
        {messageActions.memoryCascadeConfirmation && (
          <MemoryCascadeDialog
            isOpen={true}
            memoryCount={messageActions.memoryCascadeConfirmation.memoryCount}
            isSwipeGroup={messageActions.memoryCascadeConfirmation.isSwipeGroup}
            onClose={messageActions.cancelMemoryCascadeConfirmation}
            onConfirm={messageActions.handleMemoryCascadeConfirm}
          />
        )}
      </div>

      {shouldShowParticipantSidebar && (
        <ParticipantSidebar
          participants={participantData}
          turnState={turnState}
          turnSelectionResult={turnSelectionResult}
          isGenerating={streaming || waitingForResponse}
          userParticipantId={userParticipantId}
          respondingParticipantId={respondingParticipantId}
          isPaused={isPaused}
          onTogglePause={togglePause}
          onNudge={turnManagement.handleNudge}
          onQueue={turnManagement.handleQueue}
          onDequeue={turnManagement.handleDequeue}
          onSkip={turnManagement.handleContinue}
          onTalkativenessChange={(pId, value) => {
          }}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
          impersonatingParticipantIds={impersonatingParticipantIds}
          activeTypingParticipantId={activeTypingParticipantId}
          onImpersonate={handleStartImpersonation}
          onStopImpersonate={handleStopImpersonation}
        />
      )}
    </div>
  )
}
