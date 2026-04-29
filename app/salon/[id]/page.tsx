'use client'

import { use, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import ParticipantSidebar from '@/components/chat/ParticipantSidebar'
import SpeakerSelector from '@/components/chat/SpeakerSelector'
import type { EphemeralMessageData } from '@/components/chat/EphemeralMessage'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'
import { ChatCostSummary } from '@/components/chat/ChatCostSummary'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStoryBackground } from '@/hooks/useStoryBackground'
import { useChatContext } from '@/components/providers/chat-context'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { usePageToolbar } from '@/components/providers/page-toolbar-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { getPendingMessageNavigation, scrollToMessage } from '@/lib/chat/message-navigation'
import {
  type TurnState,
  type TurnSelectionResult,
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  isAllLLMChat,
} from '@/lib/chat/turn-manager'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'

// Import extracted hooks
import {
  useChatData,
  useTurnManagement,
  useMessageActions,
  useFileAttachments,
  useAutoScroll,
  useModalState,
  useDraftPersistence,
  useMemoryActions,
  useLLMLogs,
  useParticipants,
  useImpersonation,
  useChatControls,
  useSSEStreaming,
  useOutfit,
  type SwipeState,
} from './hooks'
import type { Chat, Message, PendingToolResult, CharacterData } from './types'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'
import {
  ChatComposer,
  VirtualizedMessageList,
  ChatModals,
} from './components'
import LLMInspectorPanel from '@/components/chat/LLMInspectorPanel'
import { WhisperDialog } from '@/components/chat/WhisperDialog'
import { GiftWardrobeItemModal } from '@/components/wardrobe/gift-wardrobe-item-modal'
import SplitLayout from './components/SplitLayout'
import DocumentPane from './components/DocumentPane'
import DocumentPickerModal from './components/DocumentPickerModal'
import { useDocumentMode, type FocusRequest } from './hooks/useDocumentMode'

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  useAvatarDisplay()

  // --- Core data hook ---
  const chatDataHook = useChatData(id)
  const { chat, messages, loading, error, chatSettings, swipeStates, chatPhotoCount, chatMemoryCount } = chatDataHook
  const { setChat, setMessages, setSwipeStates } = chatDataHook
  const { fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount } = chatDataHook

  // --- Story background ---
  // When the backdrop URL changes (active regeneration poll or passive SWR revalidation), refresh
  // the chat so any Lantern announcement posted alongside the new backdrop lands in the UI without
  // requiring the user to leave and return.
  const {
    backgroundUrl: storyBackgroundUrl,
    backgroundFileId: storyBackgroundFileId,
    backgroundFilename: storyBackgroundFilename,
    startPolling: startBackgroundPolling,
  } = useStoryBackground(
    id,
    chat?.projectId,
    chatSettings?.storyBackgroundsSettings?.enabled ?? false,
    () => { void fetchChat() }
  )

  // --- UI state that stays in page ---
  const [input, setInput] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [expandedSystemMessageIds, setExpandedSystemMessageIds] = useState<Set<string>>(new Set())
  const toggleSystemMessageExpanded = useCallback((messageId: string) => {
    setExpandedSystemMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }, [])
  const [roleplayTemplateName, setRoleplayTemplateName] = useState<string | null>(null)
  const [roleplayRenderingPatterns, setRoleplayRenderingPatterns] = useState<RenderingPattern[] | undefined>(undefined)
  const [roleplayDialogueDetection, setRoleplayDialogueDetection] = useState<DialogueDetection | null | undefined>(undefined)
  const [narrationDelimiters, setNarrationDelimiters] = useState<NarrationDelimiters | undefined>(undefined)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [pendingToolResults, setPendingToolResults] = useState<PendingToolResult[]>([])
  const [showAllWhispers, setShowAllWhispers] = useState(false)
  const [whisperTarget, setWhisperTarget] = useState<{ participantId: string; name: string } | null>(null)
  const [giftTarget, setGiftTarget] = useState<{ participantId: string; characterId: string; name: string } | null>(null)

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<ComposerEditorHandle>(null)
  const hasRestoredTurnStateRef = useRef<boolean>(false)
  const triggerContinueModeRef = useRef<(participantId: string) => Promise<void>>(async () => {})
  const wasGeneratingRef = useRef(false)
  const streamingRef = useRef(false)

  // --- Whisper support ---
  const participantNames = useMemo(() => {
    const names: Record<string, string> = {}
    if (chat?.participants) {
      for (const p of chat.participants) {
        if (p.character?.name) {
          names[p.id] = p.character.name
        } else if (p.character?.name && p.controlledBy === 'user') {
          names[p.id] = p.character.name
        }
      }
    }
    return names
  }, [chat?.participants])

  const handleWhisper = useCallback((participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const name = participant?.character?.name || 'Unknown'
    setWhisperTarget({ participantId, name })
  }, [chat?.participants])

  const handleGiftItem = useCallback((participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    const name = participant?.character?.name || 'Unknown'
    if (characterId) {
      setGiftTarget({ participantId, characterId, name })
    }
  }, [chat?.participants])

  // --- Avatar generation polling ---
  // After triggering avatar generation, poll fetchChat until the avatar updates
  const avatarPollRef = useRef<NodeJS.Timeout | null>(null)
  const avatarPollCountRef = useRef(0)

  const startAvatarPoll = useCallback((characterId: string) => {
    // Snapshot the current avatar URL for this character to detect when it changes
    const participant = chat?.participants.find(p => p.character?.id === characterId)
    const snapshotAvatarUrl = participant?.character?.avatarUrl ?? null

    // Clear any existing poll
    if (avatarPollRef.current) {
      clearInterval(avatarPollRef.current)
    }
    avatarPollCountRef.current = 0

    avatarPollRef.current = setInterval(async () => {
      avatarPollCountRef.current++
      // Poll for up to 2 minutes (24 polls at 5s intervals)
      if (avatarPollCountRef.current > 24) {
        if (avatarPollRef.current) clearInterval(avatarPollRef.current)
        avatarPollRef.current = null
        return
      }
      try {
        const res = await fetch(`/api/v1/chats/${id}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        // Check the enriched participant avatar URL — this changes when avatarOverrides update
        const updatedParticipant = data.chat?.participants?.find(
          (p: { character?: { id?: string } }) => p.character?.id === characterId
        )
        const newAvatarUrl = updatedParticipant?.character?.avatarUrl ?? null
        if (newAvatarUrl && newAvatarUrl !== snapshotAvatarUrl) {
          // Avatar URL changed — do a full fetchChat to update React state
          if (avatarPollRef.current) clearInterval(avatarPollRef.current)
          avatarPollRef.current = null
          await fetchChat()
          showInfoToast('Avatar updated')
        }
      } catch {
        // Silently continue polling
      }
    }, 5000)
  }, [chat?.participants, id, fetchChat])

  // Cleanup avatar polling on unmount
  useEffect(() => {
    return () => {
      if (avatarPollRef.current) {
        clearInterval(avatarPollRef.current)
      }
    }
  }, [])

  const handleRegenerateAvatar = useCallback(async (participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    const name = participant?.character?.name || 'Unknown'
    if (!characterId) return
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=regenerate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })
      if (res.ok) {
        showInfoToast(`Avatar regeneration queued for ${name}`)
        startAvatarPoll(characterId)
      } else {
        const data = await res.json().catch(() => ({}))
        showErrorToast(data.error || 'Failed to regenerate avatar')
      }
    } catch {
      showErrorToast('Failed to regenerate avatar')
    }
  }, [chat?.participants, id, startAvatarPoll])

  const userParticipantIdSet = useMemo(() => {
    if (!chat?.participants) return new Set<string>()
    return new Set(
      chat.participants
        .filter(p => p.controlledBy === 'user')
        .map(p => p.id)
    )
  }, [chat?.participants])

  const visibleMessages = useMemo(() => {
    return messages.filter(msg => {
      if (!msg.targetParticipantIds || msg.targetParticipantIds.length === 0) return true
      if (showAllWhispers) return true
      // Show if user is sender or target
      if (msg.participantId && userParticipantIdSet.has(msg.participantId)) return true
      if (msg.targetParticipantIds.some(id => userParticipantIdSet.has(id))) return true
      return false
    })
  }, [messages, showAllWhispers, userParticipantIdSet])

  // --- Modal state hook ---
  const modals = useModalState()

  // --- Document Mode hook (Scriptorium Phase 3.5) ---
  // The Librarian announces document opens and saves as ASSISTANT-role system messages, so the
  // user never loses their turn. The hook hands us the server-persisted message; we just append.
  const appendLibrarianMessage = useCallback((message: Message) => {
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev
      return [...prev, message]
    })
  }, [setMessages])
  const documentModeHook = useDocumentMode({
    chatId: id,
    chat,
    onLibrarianMessage: appendLibrarianMessage,
  })
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)

  // --- File attachments hook ---
  const fileHook = useFileAttachments(id, chat?.projectId)
  const { attachedFiles, setAttachedFiles, uploadingFile } = fileHook
  const { handleFileSelect, removeAttachedFile, uploadFile } = fileHook
  const { conflictInfo, isConflictDialogOpen, resolvingConflict, handleConflictResolution, cancelConflict } = fileHook

  // --- Participants hook ---
  const participants = useParticipants({
    chat,
    messages,
    impersonatingParticipantIds: [], // Will be overwritten below after impersonation hook
    turnState,
    turnSelectionResult,
  })

  // --- Impersonation hook ---
  const impersonation = useImpersonation({
    chatId: id,
    chat,
    participantData: participants.participantData,
    fetchChat,
    setSelectLLMProfileDialogState: modals.setSelectLLMProfileDialogState,
  })

  // Re-derive participants with actual impersonation state
  const participantsWithImpersonation = useParticipants({
    chat,
    messages,
    impersonatingParticipantIds: impersonation.impersonatingParticipantIds,
    turnState,
    turnSelectionResult,
  })

  // --- Draft persistence hook ---
  useDraftPersistence({ chatId: id, input, setInput })
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(`quilltap-draft-${id}`)
    } catch {
      // Ignore
    }
  }, [id])

  // --- Memory actions hook ---
  const memoryActions = useMemoryActions({
    chatId: id,
    chatMemoryCount,
    setChatMemoryCount: chatDataHook.setChatMemoryCount,
    chat,
  })

  // --- LLM logs hook ---
  const llmLogs = useLLMLogs({
    chatId: id,
    messages,
  })
  // Extract stable references for use in effects
  const { toggleInspector, inspectorOpen } = llmLogs

  // --- Chat controls hook ---
  const chatControls = useChatControls({
    chatId: id,
    chat,
    participantData: participantsWithImpersonation.participantData,
    participantsAsBase: participantsWithImpersonation.participantsAsBase,
    isMultiChar: participantsWithImpersonation.isMultiChar,
    isAllLLM: participantsWithImpersonation.isAllLLM,
    allLLMTurnCount: participantsWithImpersonation.allLLMTurnCount,
    effectiveNextSpeakerId: participantsWithImpersonation.effectiveNextSpeakerId,
    userParticipantId: participantsWithImpersonation.userParticipantId,
    turnState,
    streamingRef,
    isPaused,
    setIsPaused,
    fetchChat,
    setEphemeralMessages,
    setTurnState,
    triggerContinueModeRef,
    setChat: (fn) => setChat(fn as any),
    startBackgroundPolling,
  })

  // --- SSE Streaming hook ---
  const sseStreaming = useSSEStreaming({
    chatId: id,
    chat,
    messages,
    setMessages,
    setEphemeralMessages,
    isMultiChar: participantsWithImpersonation.isMultiChar,
    hasActiveCharacters: participantsWithImpersonation.hasActiveCharacters,
    participantsAsBase: participantsWithImpersonation.participantsAsBase,
    isPaused,
    respondingParticipantId,
    setRespondingParticipantId,
    fetchChat,
    scrollOnUserMessage: () => scrollOnUserMessage(),
    scrollOnStreamComplete: () => scrollOnStreamComplete(),
    setAttachedFiles,
    inputRef: inputRef as React.RefObject<ComposerEditorHandle>,
    setSudoApprovalState: modals.setSudoApprovalState,
    setWorkspaceAcknowledgementState: modals.setWorkspaceAcknowledgementState,
    getFirstCharacterParticipant: participantsWithImpersonation.getFirstCharacterParticipant,
    setPauseState: chatControls.setPauseState,
    onToolResult: (name, success, result) => {
      // React to LLM opening/closing documents
      if (success && (name === 'doc_open_document' || name === 'doc_close_document')) {
        documentModeHook.reloadFromServer()
      }
      // React to LLM writing/moving/deleting files — any of these can invalidate
      // the editor's cached content or mtime. reloadFromServer re-reads the
      // active document (if still open) and refreshes state, keeping the next
      // autosave from racing on a stale mtime or missing path.
      if (success && (name === 'doc_write_file' || name === 'doc_move_file' || name === 'doc_delete_file')) {
        documentModeHook.reloadFromServer()
      }
      // React to LLM focusing on document location
      if (name === 'doc_focus' && success && result) {
        documentModeHook.handleDocFocus(result as FocusRequest)
      }
    },
  })

  // Keep refs in sync with SSE streaming state
  triggerContinueModeRef.current = sseStreaming.triggerContinueMode
  streamingRef.current = sseStreaming.streaming || sseStreaming.waitingForResponse

  // --- Outfit hook ---
  // Collect all character IDs from participants so we can fetch wardrobe for all of them
  // (including user-controlled characters that may not have equipped outfits yet)
  const participantCharacterIds = useMemo(() =>
    (chat?.participants ?? [])
      .filter(p => p.type === 'CHARACTER' && p.character?.id)
      .map(p => p.character!.id),
    [chat?.participants]
  )
  const outfit = useOutfit(id, participantCharacterIds)

  // Refresh outfit state when a tool result comes back (generation completes).
  // Invalidate wardrobe cache first since tools may have created/gifted new items.
  // The Aurora announcement of any tool-driven change is scheduled server-side
  // by the wardrobe-update-outfit tool handler, so the client only needs to
  // refresh its local view of the outfit.
  const wasGeneratingForOutfitRef = useRef(false)
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse
    if (wasGeneratingForOutfitRef.current && !isGenerating) {
      outfit.invalidateWardrobe()
      void outfit.refreshOutfit()
    }
    wasGeneratingForOutfitRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- outfit.refreshOutfit and invalidateWardrobe are stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, outfit.refreshOutfit, outfit.invalidateWardrobe])

  // Equip slot handler that maps participantId -> characterId
  const handleEquipSlot = useCallback(async (participantId: string, slot: string, itemId: string | null) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    if (characterId) {
      await outfit.equipSlot(characterId, slot, itemId)
      // If avatar generation is enabled, start polling for the auto-triggered avatar update
      if (chat?.avatarGenerationEnabled) {
        startAvatarPoll(characterId)
      }
    }
  }, [chat?.participants, chat?.avatarGenerationEnabled, outfit, startAvatarPoll])

  // --- Virtualizer ---
  const getItemKey = useCallback((index: number) => {
    return visibleMessages[index]?.id ?? index
  }, [visibleMessages])

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual exposes hooks the React Compiler can't analyse; safe to opt out of compiler optimisation here
  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 150,
    overscan: 5,
    getItemKey,
  })

  // --- Auto-scroll hook ---
  const {
    scrollOnUserMessage,
    scrollOnStreamComplete,
    isAutoScrollEnabled,
    isSettled,
  } = useAutoScroll({
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    virtualizer,
    messageCount: visibleMessages.length,
    isStreaming: sseStreaming.streaming,
    isWaitingForResponse: sseStreaming.waitingForResponse,
    streamingContent: sseStreaming.streamingContent,
    isLoading: loading,
  })

  // --- Message actions hook ---
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
    inputRef as React.RefObject<ComposerEditorHandle>,
    messagesEndRef as React.RefObject<HTMLDivElement>,
    chatSettings,
  )

  // --- Unpause callback for turn management ---
  const unpauseChat = useCallback(async () => {
    setIsPaused(false)
    chatControls.userStoppedStreamRef.current = false
    try {
      const response = await fetch(`/api/v1/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { isPaused: false } }),
      })
      if (!response.ok) {
        console.error('[Chat] Failed to persist unpause state', response.status)
      }
    } catch (error) {
      console.error('[Chat] Error persisting unpause state', error)
    }
  }, [id, chatControls.userStoppedStreamRef])

  // Stable callback wrapper using ref
  const stableTriggerContinueMode = useCallback(
    async (participantId: string) => {
      await triggerContinueModeRef.current(participantId)
    },
    []
  )

  // --- Turn management hook ---
  const turnManagement = useTurnManagement(
    id,
    participantsWithImpersonation.participantsAsBase,
    participantsWithImpersonation.charactersMap,
    turnState,
    participantsWithImpersonation.userParticipantId,
    participantsWithImpersonation.participantData,
    ephemeralMessages,
    setTurnState,
    setTurnSelectionResult,
    setEphemeralMessages,
    stableTriggerContinueMode,
    isPaused,
    unpauseChat,
  )

  // --- Document title ---
  useDocumentTitle(chat?.title ?? null)

  // --- Pending tool results ---
  const handleAddPendingToolResult = useCallback((result: Omit<PendingToolResult, 'id' | 'createdAt'>) => {
    const newResult: PendingToolResult = {
      ...result,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    setPendingToolResults(prev => [...prev, newResult])
  }, [])

  const handleRemovePendingToolResult = useCallback((resultId: string) => {
    setPendingToolResults(prev => prev.filter(r => r.id !== resultId))
  }, [])

  // --- Sync storyBackgroundsEnabled ---
  const storyBackgroundsSettingsEnabled = chatSettings?.storyBackgroundsSettings?.enabled
  const { setStoryBackgroundsEnabled } = chatControls
  useEffect(() => {
    if (chatSettings) {
      setStoryBackgroundsEnabled(storyBackgroundsSettingsEnabled ?? false)
    }
  }, [chatSettings, storyBackgroundsSettingsEnabled, setStoryBackgroundsEnabled])

  // --- Calculate turn state when messages change ---
  useEffect(() => {
    if (participantsWithImpersonation.participantsAsBase.length === 0 || messages.length === 0) return

    const messageEvents = messages.map(m => ({
      type: 'message' as const,
      id: m.id,
      role: m.role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
      content: m.content,
      participantId: m.participantId,
      createdAt: m.createdAt,
      attachments: m.attachments?.map(a => a.id) ?? [],
      targetParticipantIds: m.targetParticipantIds ?? null,
    }))

    const newTurnState = calculateTurnStateFromHistory({
      messages: messageEvents,
      participants: participantsWithImpersonation.participantsAsBase,
      userParticipantId: participantsWithImpersonation.userParticipantId,
    })

    setTurnState(newTurnState)

    let result = selectNextSpeaker(
      participantsWithImpersonation.participantsAsBase,
      participantsWithImpersonation.charactersMap,
      newTurnState,
      participantsWithImpersonation.userParticipantId
    )

    if (!hasRestoredTurnStateRef.current && chat?.lastTurnParticipantId !== undefined) {
      hasRestoredTurnStateRef.current = true
      const persistedParticipantId = chat.lastTurnParticipantId
      const chatIsAllLLM = isAllLLMChat(participantsWithImpersonation.participantsAsBase)

      if (persistedParticipantId === null) {
        if (result.nextSpeakerId !== null && !chatIsAllLLM) {
          result = { ...result, nextSpeakerId: null, reason: 'user_turn' }
        }
      } else {
        const persistedParticipant = participantsWithImpersonation.participantsAsBase.find(
          p => p.id === persistedParticipantId && p.isActive
        )
        if (persistedParticipant && result.nextSpeakerId !== persistedParticipantId) {
          result = { ...result, nextSpeakerId: persistedParticipantId, reason: 'queue' }
        }
      }
    }

    setTurnSelectionResult(result)
  }, [messages, participantsWithImpersonation.participantsAsBase, participantsWithImpersonation.userParticipantId, participantsWithImpersonation.charactersMap, chat?.lastTurnParticipantId])

  // --- Handle scroll-to-message from memory provenance navigation ---
  useEffect(() => {
    if (loading || messages.length === 0) return
    const pendingNav = getPendingMessageNavigation()
    if (pendingNav.scrollTo) {
      setTimeout(() => {
        scrollToMessage(pendingNav.scrollTo!, {
          behavior: 'smooth',
          highlight: !!pendingNav.highlight,
          highlightDuration: 3000,
        })
      }, 500)
    }
  }, [loading, messages.length])

  // --- Quick-hide logic ---
  const chatContext = useChatContext()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0
  const isCurrentChat = chatContext.chatId === id
  const chatTags = chatContext.tags.map(tag => tag.id)
  const awaitingTagInfo = quickHideActive && isCurrentChat && !chatContext.tagsFetched
  const chatHidden = quickHideActive && isCurrentChat && chatContext.tagsFetched && shouldHideByIds(chatTags)

  // --- Initialization effects ---
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
        setNarrationDelimiters(undefined)
        return
      }
      try {
        const res = await fetch(`/api/v1/roleplay-templates/${chat.roleplayTemplateId}`)
        if (res.ok) {
          const template = await res.json()
          setRoleplayTemplateName(template.name)
          setRoleplayRenderingPatterns(template.renderingPatterns)
          setRoleplayDialogueDetection(template.dialogueDetection)
          setNarrationDelimiters(template.narrationDelimiters)
        } else {
          setRoleplayTemplateName(null)
          setRoleplayRenderingPatterns(undefined)
          setRoleplayDialogueDetection(undefined)
          setNarrationDelimiters(undefined)
        }
      } catch {
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
        setNarrationDelimiters(undefined)
      }
    }
    fetchTemplateData()
  }, [chat?.roleplayTemplateId])

  // --- Editor focus effect ---
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Focus textarea when generation completes + refresh LLM logs
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse || sseStreaming.sending
    if (wasGeneratingRef.current && !isGenerating) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 100)
      // Refresh LLM logs after generation completes
      llmLogs.refreshLogs()
    }
    wasGeneratingRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- llmLogs.refreshLogs is stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, sseStreaming.sending, llmLogs.refreshLogs])

  // Refetch document content after LLM response completes when a document is open.
  // Always refetch rather than trying to detect doc_* edits — reading a file is cheap
  // and this avoids race conditions with pendingToolCalls being cleared.
  const wasGeneratingForDocRef = useRef(false)
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse || sseStreaming.sending
    if (wasGeneratingForDocRef.current && !isGenerating && documentModeHook.activeDocument) {
      documentModeHook.handleLLMEditEnd()
    }
    wasGeneratingForDocRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLLMEditEnd is stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, sseStreaming.sending, documentModeHook.activeDocument])

  // Keyboard shortcut: Cmd+Shift+L / Ctrl+Shift+L to toggle inspector
  const llmLoggingEnabled = chatSettings?.llmLoggingSettings?.enabled !== false
  useEffect(() => {
    if (!llmLoggingEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        toggleInspector()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [llmLoggingEnabled, toggleInspector])

  // Keyboard shortcuts for Document Mode (Scriptorium Phase 3.5)
  useEffect(() => {
    const handleDocKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+D / Ctrl+Shift+D: Toggle document mode (normal ↔ split)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        if (documentModeHook.documentMode === 'normal') {
          if (documentModeHook.activeDocument) {
            // Re-open existing document in split mode
            documentModeHook.toggleFocusMode()
          } else {
            // No document open — show picker
            setShowDocumentPicker(true)
          }
        } else {
          documentModeHook.closeDocument()
        }
        return
      }

      // Cmd+Shift+F / Ctrl+Shift+F: Toggle focus mode (split ↔ focus)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        if (documentModeHook.documentMode !== 'normal' && documentModeHook.activeDocument) {
          e.preventDefault()
          documentModeHook.toggleFocusMode()
        }
        return
      }

      // Escape: Exit focus mode to split
      if (e.key === 'Escape' && documentModeHook.documentMode === 'focus') {
        e.preventDefault()
        documentModeHook.toggleFocusMode()
      }
    }

    document.addEventListener('keydown', handleDocKeyDown)
    return () => document.removeEventListener('keydown', handleDocKeyDown)
  }, [documentModeHook])

  // --- Toolbar setup ---
  const { setLeftContent, setRightContent } = usePageToolbar()

  // Extract stable setter from modals to avoid unstable object reference in effect deps
  const { setModalImage } = modals

  // Create a stable key for character list to avoid re-running the effect on every render
  // (useParticipants returns a new array reference each time)
  const llmCharacters = participantsWithImpersonation.llmCharacters
  const llmCharacterKey = llmCharacters.map(c => c.id).join(',')

  useEffect(() => {
    if (chat?.title) {
      const getCharacterAvatarUrl = (character: CharacterData): string | null => {
        if (character.defaultImage?.url) return character.defaultImage.url
        if (character.defaultImage?.filepath) return character.defaultImage.filepath.startsWith('/') ? character.defaultImage.filepath : `/${character.defaultImage.filepath}`
        if (character.avatarUrl) return character.avatarUrl.startsWith('/') ? character.avatarUrl : `/${character.avatarUrl}`
        return null
      }

      setLeftContent(
        <div className="hidden md:flex items-center gap-2 text-sm min-w-0">
          {chat.projectId && chat.projectName && (
            <>
              <a
                href={`/projects/${chat.projectId}`}
                className="inline-flex items-center gap-1.5 qt-text-secondary hover:text-foreground transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span>{chat.projectName}</span>
              </a>
              <span className="qt-text-muted">/</span>
            </>
          )}
          {llmCharacters.map((character) => {
            const avatarUrl = getCharacterAvatarUrl(character)
            return (
              <span key={character.id} className="contents">
                <a
                  href={`/aurora/${character.id}/view?tab=conversations`}
                  className="inline-flex items-center gap-1.5 qt-text-secondary hover:text-foreground transition-colors flex-shrink-0"
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={character.name}
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full qt-bg-muted flex items-center justify-center">
                      <span className="text-xs font-medium qt-text-secondary">
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span>{character.name}</span>
                </a>
                <span className="qt-text-muted">/</span>
              </span>
            )
          })}
          {storyBackgroundUrl && (
            <button
              type="button"
              onClick={() => setModalImage({
                src: storyBackgroundUrl,
                filename: storyBackgroundFilename || 'story_background.png',
                fileId: storyBackgroundFileId || undefined,
              })}
              className="flex-shrink-0 rounded overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all"
              title="View story background"
            >
              <img
                src={storyBackgroundUrl}
                alt="Story background"
                className="w-8 h-5 object-cover"
              />
            </button>
          )}
          {chat.isDangerousChat && (
            <span
              className="qt-danger-badge flex-shrink-0"
              title={`The Concierge has flagged this chat${chat.dangerCategories?.length ? `: ${chat.dangerCategories.join(', ')}` : ''}`}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              Flagged
            </span>
          )}
          <span className="qt-text-primary truncate" title={chat.title}>
            {chat.title}
          </span>
        </div>
      )
    } else {
      setLeftContent(null)
    }
    return () => setLeftContent(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- llmCharacterKey is a stable string proxy for the llmCharacters array
  }, [chat?.projectId, chat?.projectName, chat?.title, chat?.isDangerousChat, chat?.dangerCategories, llmCharacterKey, setLeftContent, storyBackgroundUrl, storyBackgroundFileId, storyBackgroundFilename, setModalImage])

  // Set cost summary and inspector button in toolbar right section
  useEffect(() => {
    const showChatTotals = chatSettings?.tokenDisplaySettings?.showChatTotals
    const showInspectorButton = chatSettings?.llmLoggingSettings?.enabled !== false

    if (showChatTotals || showInspectorButton) {
      setRightContent(
        <div className="flex items-center gap-2">
          {showInspectorButton && (
            <button
              type="button"
              onClick={toggleInspector}
              className={`p-1.5 rounded transition-colors ${
                inspectorOpen
                  ? 'qt-bg-primary/15 text-primary'
                  : 'qt-text-secondary hover:text-foreground'
              }`}
              title="LLM Inspector (Cmd+Shift+L)"
              aria-label="Toggle LLM Inspector"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
          )}
          {showChatTotals && (
            <ChatCostSummary
              chatId={id}
              show={showChatTotals}
              variant="compact"
              refreshKey={messages.length}
            />
          )}
        </div>
      )
    } else {
      setRightContent(null)
    }
    return () => setRightContent(null)
  }, [id, chatSettings?.tokenDisplaySettings?.showChatTotals, chatSettings?.llmLoggingSettings?.enabled, setRightContent, messages.length, toggleInspector, inspectorOpen])

  // --- UI helpers ---
  const shouldShowAvatars = useCallback(() => {
    if (!chatSettings) return true
    return chatSettings.avatarDisplayMode === 'ALWAYS'
  }, [chatSettings])

  const getRespondingCharacter = useCallback(() => {
    if (respondingParticipantId) {
      const participant = chat?.participants.find(p => p.id === respondingParticipantId)
      if (participant?.character) {
        return participant.character
      }
    }
    return participantsWithImpersonation.getFirstCharacter() ?? undefined
  }, [respondingParticipantId, chat?.participants, participantsWithImpersonation])

  const getMessageAvatar = useCallback((message: Message) => {
    if (message.systemSender === 'lantern') {
      return { name: 'The Lantern', title: null, avatarUrl: '/images/avatars/lantern-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'aurora') {
      return { name: 'Aurora', title: null, avatarUrl: '/images/avatars/aurora-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'librarian') {
      return { name: 'The Librarian', title: null, avatarUrl: '/images/avatars/librarian-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'concierge') {
      return { name: 'The Concierge', title: null, avatarUrl: '/images/avatars/concierge-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'host') {
      return { name: 'The Host', title: null, avatarUrl: '/images/avatars/host-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'prospero') {
      return { name: 'Prospero', title: null, avatarUrl: '/images/avatars/prospero-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'commonplaceBook') {
      return { name: 'The Commonplace Book', title: null, avatarUrl: '/images/avatars/commonplace-book-avatar.webp', defaultImage: null }
    }
    if (message.participantId) {
      const participant = participantsWithImpersonation.getParticipantById(message.participantId)
      if (participant) {
        if (participant.type === 'CHARACTER' && participant.character) {
          return { name: participant.character.name, title: participant.character.title, avatarUrl: participant.character.avatarUrl, defaultImage: participant.character.defaultImage }
        }
      }
    }
    if (message.role === 'USER') {
      const userChar = participantsWithImpersonation.getFirstUserCharacter()
      if (userChar) {
        return { name: userChar.name, title: userChar.title, avatarUrl: userChar.avatarUrl, defaultImage: userChar.defaultImage }
      } else if (chat?.user) {
        return { name: chat.user.name || 'User', title: null, avatarUrl: chat.user.image ?? null, defaultImage: null }
      }
    } else if (message.role === 'ASSISTANT') {
      const character = participantsWithImpersonation.getFirstCharacter()
      if (character) {
        return { name: character.name, title: character.title, avatarUrl: character.avatarUrl, defaultImage: character.defaultImage }
      }
    }
    return null
  }, [participantsWithImpersonation, chat?.user])

  // --- Reattribute handler ---
  const handleReattribute = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      modals.setReattributeDialogState({
        isOpen: true,
        messageId,
        currentParticipantId: message.participantId || null,
      })
    }
  }, [messages, modals])

  // Handle document open — opens the document; the server posts a Librarian announcement which
  // the hook surfaces via onLibrarianMessage, so the user never loses their turn.
  const handleOpenDocument = useCallback(async (params: Parameters<typeof documentModeHook.openDocument>[0]) => {
    await documentModeHook.openDocument(params)
  }, [documentModeHook])

  const handleReattributed = useCallback(async () => {
    const messageId = modals.reattributeDialogState?.messageId
    modals.setReattributeDialogState(null)
    await fetchChat()
    if (messageId) {
      setTimeout(() => {
        const messageElement = document.getElementById(`message-${messageId}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }, [fetchChat, modals])

  // --- All-LLM pause handlers ---
  const handleAllLLMContinue = useCallback(() => {
    modals.setAllLLMPauseModalOpen(false)
  }, [modals])

  const handleAllLLMStop = useCallback(() => {
    modals.setAllLLMPauseModalOpen(false)
    chatControls.setPauseState(true)
  }, [modals, chatControls])

  const handleAllLLMTakeOver = useCallback(async (participantId: string) => {
    modals.setAllLLMPauseModalOpen(false)
    await impersonation.handleStartImpersonation(participantId)
  }, [modals, impersonation])

  // --- Early returns ---
  if (awaitingTagInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg qt-text-secondary">Loading chat...</p>
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
        <p className="text-lg qt-text-destructive">Error: {error || 'Chat not found'}</p>
      </div>
    )
  }

  // --- Render ---
  return (
    <div
      className="qt-chat-layout"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <div className="qt-chat-main">
        <SplitLayout
          mode={documentModeHook.documentMode}
          dividerPosition={documentModeHook.dividerPosition}
          onDividerPositionChange={documentModeHook.setDividerPosition}
          chatContent={
            <>
              {/* Chat toggles - shown in multi-character chats */}
              {participantsWithImpersonation.isMultiChar && (
                <div className="flex items-center justify-end gap-4 px-4 py-1">
                  <div className="flex items-center gap-2">
                    <span className="qt-text-secondary text-xs">Shared Vaults</span>
                    <button
                      onClick={chatControls.handleToggleCrossCharacterVaultReads}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        chatControls.allowCrossCharacterVaultReads ? 'bg-primary' : 'qt-bg-muted'
                      }`}
                      role="switch"
                      aria-checked={chatControls.allowCrossCharacterVaultReads}
                      title={
                        chatControls.allowCrossCharacterVaultReads
                          ? 'Characters may read each other’s vaults (read-only). Click to lock.'
                          : 'Each character’s vault is private. Click to let them peek at each other’s dossiers.'
                      }
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                          chatControls.allowCrossCharacterVaultReads ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="qt-text-secondary text-xs">All Whispers</span>
                    <button
                      onClick={() => setShowAllWhispers(!showAllWhispers)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showAllWhispers ? 'bg-primary' : 'qt-bg-muted'
                      }`}
                      role="switch"
                      aria-checked={showAllWhispers}
                      title={showAllWhispers ? 'Hide private whispers' : 'Show all whispers'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                          showAllWhispers ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

        <VirtualizedMessageList
          messages={visibleMessages}
          virtualizer={virtualizer}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          editingMessageId={editingMessageId}
          editContent={editContent}
          viewSourceMessageIds={viewSourceMessageIds}
          expandedSystemMessageIds={expandedSystemMessageIds}
          onToggleSystemMessageExpanded={toggleSystemMessageExpanded}
          swipeStates={swipeStates}
          setSwipeStates={setSwipeStates}
          chatSettings={chatSettings}
          roleplayRenderingPatterns={roleplayRenderingPatterns}
          roleplayDialogueDetection={roleplayDialogueDetection}
          isMultiChar={participantsWithImpersonation.isMultiChar}
          participantData={participantsWithImpersonation.participantData}
          turnState={turnState}
          streaming={sseStreaming.streaming}
          streamingContent={sseStreaming.streamingContent}
          waitingForResponse={sseStreaming.waitingForResponse}
          userParticipantId={participantsWithImpersonation.userParticipantId}
          isPaused={isPaused}
          respondingParticipantId={respondingParticipantId}
          messageActions={messageActions}
          turnManagement={turnManagement}
          setEditContent={setEditContent}
          onTogglePause={chatControls.togglePause}
          onOverrideDangerFlag={chatControls.handleOverrideDangerFlag}
          onRemoveCharacter={chatControls.handleRemoveCharacter}
          onReattribute={handleReattribute}
          onImageClick={(filepath, filename, fileId) => {
            modals.setModalImage({ src: filepath, filename, fileId })
          }}
          fetchChat={fetchChat}
          messagesWithLogs={llmLogs.messagesWithLogs}
          onViewLLMLogs={llmLogs.handleViewLLMLogs}
          pendingToolCalls={sseStreaming.pendingToolCalls}
          ephemeralMessages={ephemeralMessages}
          getRespondingCharacter={getRespondingCharacter}
          shouldShowAvatars={shouldShowAvatars}
          getFirstCharacter={participantsWithImpersonation.getFirstCharacter}
          getMessageAvatar={getMessageAvatar}
          participantNames={participantNames}
          userParticipantIdSet={userParticipantIdSet}
          isDangerousChat={chat?.isDangerousChat === true}
        />

        {/* Speaker Selector - shown when controlling multiple characters */}
        {participantsWithImpersonation.controlledCharacters.length >= 2 && (
          <div className="qt-chat-speaker-selector px-4 py-2 border-t qt-border-default">
            <SpeakerSelector
              characters={participantsWithImpersonation.controlledCharacters}
              activeParticipantId={impersonation.activeTypingParticipantId}
              onSelect={impersonation.handleSetActiveSpeaker}
              disabled={sseStreaming.streaming || sseStreaming.waitingForResponse}
            />
          </div>
        )}

        {/* Chat Composer */}
        <ChatComposer
          id={id}
          input={input}
          setInput={setInput}
          attachedFiles={attachedFiles}
          onRemoveAttachedFile={removeAttachedFile}
          pendingToolResults={pendingToolResults}
          onRemovePendingToolResult={handleRemovePendingToolResult}
          inputRef={inputRef}
          disabled={sseStreaming.sending}
          sending={sseStreaming.sending}
          hasActiveCharacters={participantsWithImpersonation.hasActiveCharacters}
          streaming={sseStreaming.streaming}
          waitingForResponse={sseStreaming.waitingForResponse}
          responseStatus={sseStreaming.responseStatus}
          toolPaletteOpen={modals.toolPaletteOpen}
          setToolPaletteOpen={modals.setToolPaletteOpen}
          showSource={modals.showPreview}
          setShowSource={modals.setShowPreview}
          uploadingFile={uploadingFile}
          toolExecutionStatus={sseStreaming.toolExecutionStatus}
          renderingPatterns={roleplayRenderingPatterns}
          dialogueDetection={roleplayDialogueDetection}
          chatPhotoCount={chatPhotoCount}
          chatMemoryCount={chatMemoryCount}
          hasImageProfile={chat?.participants.some(p => p.imageProfile) ?? false}
          isSingleCharacterChat={participantsWithImpersonation.isSingleCharacterChat}
          roleplayTemplateId={chat?.roleplayTemplateId}
          documentEditingMode={chatControls.documentEditingMode}
          onToggleDocumentEditingMode={chatControls.handleToggleDocumentEditingMode}
          onOpenDocumentClick={() => setShowDocumentPicker(true)}
          isDocumentModeActive={documentModeHook.documentMode !== 'normal'}
          agentModeEnabled={chatControls.agentModeEnabled}
          onAgentModeToggle={chatControls.handleToggleAgentMode}
          storyBackgroundsEnabled={chatControls.storyBackgroundsEnabled}
          onRegenerateBackgroundClick={chatControls.handleRegenerateBackground}
          onRoleplayTemplateChange={fetchChat}
          onSubmit={(e) => sseStreaming.sendMessage(
            e,
            input,
            setInput,
            attachedFiles,
            pendingToolResults,
            setPendingToolResults,
            clearDraft,
            chatControls.userStoppedStreamRef,
          )}
          onFileSelect={handleFileSelect}
          onAttachFileClick={() => {}}
          onImagePaste={async (file: File) => {
            try {
              const success = await uploadFile(file)
              if (success) {
                showSuccessToast('Image pasted and attached')
              }
            } catch (err) {
              showErrorToast(err instanceof Error ? err.message : 'Failed to upload pasted image')
            }
          }}
          onGalleryClick={modals.openGallery}
          onGenerateImageClick={modals.openGenerateImage}
          onLibraryFileClick={modals.openLibraryFilePicker}
          onStandaloneGenerateImageClick={modals.openStandaloneGenerateImage}
          onAddCharacterClick={modals.openAddCharacter}
          onSettingsClick={modals.openChatSettings}
          onRenameClick={modals.openRename}
          onProjectClick={modals.openChatProject}
          projectName={chat?.projectName}
          onDeleteChatMemoriesClick={memoryActions.handleDeleteChatMemories}
          onReextractMemoriesClick={memoryActions.handleReextractMemories}
          onSearchReplaceClick={modals.openSearchReplace}
          onBulkCharacterReplaceClick={modals.openBulkReplace}
          onToolSettingsClick={modals.openToolSettings}
          onRunToolClick={modals.openRunTool}
          onStateClick={modals.openStateEditor}
          onStopStreaming={sseStreaming.stopStreaming}
          hideStopButton={modals.showParticipantSidebar}
          onPendingToolResult={handleAddPendingToolResult}
          narrationDelimiters={narrationDelimiters}
        />
            </>
          }
          documentContent={
            documentModeHook.activeDocument ? (
              <DocumentPane
                document={documentModeHook.activeDocument}
                mode={documentModeHook.documentMode}
                isDirty={documentModeHook.isDirty}
                isSaving={documentModeHook.isSaving}
                isLLMEditing={documentModeHook.isLLMEditing}
                contentVersion={documentModeHook.contentVersion}
                roleplayTemplateId={chat?.roleplayTemplateId}
                attentionTop={documentModeHook.attentionTop}
                baselineContent={documentModeHook.baselineContent}
                getScrollPosition={documentModeHook.getScrollPosition}
                setScrollPosition={documentModeHook.setScrollPosition}
                onContentChange={documentModeHook.handleContentChange}
                onBlur={documentModeHook.flushSave}
                onTitleChange={documentModeHook.renameDocument}
                onToggleFocusMode={documentModeHook.toggleFocusMode}
                onCloseDocument={documentModeHook.closeDocument}
                onDeleteDocument={documentModeHook.deleteDocument}
                focusRequest={documentModeHook.focusRequest}
                onFocusResolved={documentModeHook.setAttentionTop}
                onFocusCleared={() => documentModeHook.setAttentionTop(null)}
                onFocusProcessed={documentModeHook.clearFocusRequest}
              />
            ) : null
          }
        />

        {/* Document Picker Modal */}
        <DocumentPickerModal
          isOpen={showDocumentPicker}
          onClose={() => setShowDocumentPicker(false)}
          chatId={id}
          projectId={chat?.projectId}
          projectName={chat?.projectName}
          onSelectDocument={(params) => {
            handleOpenDocument(params)
            setShowDocumentPicker(false)
          }}
        />

        {/* Modals */}
        <ChatModals
          chatId={id}
          chat={chat}
          messages={messages}
          setMessages={setMessages}
          setChat={(fn) => setChat(fn as any)}
          fetchChat={fetchChat}
          fetchChatPhotoCount={fetchChatPhotoCount}
          setAttachedFiles={setAttachedFiles}
          modalImage={modals.modalImage}
          setModalImage={modals.setModalImage}
          galleryOpen={modals.galleryOpen}
          closeGallery={modals.closeGallery}
          chatSettingsModalOpen={modals.chatSettingsModalOpen}
          closeChatSettings={modals.closeChatSettings}
          chatProjectModalOpen={modals.chatProjectModalOpen}
          closeChatProject={modals.closeChatProject}
          renameModalOpen={modals.renameModalOpen}
          closeRename={modals.closeRename}
          generateImageDialogOpen={modals.generateImageDialogOpen}
          closeGenerateImage={modals.closeGenerateImage}
          addCharacterDialogOpen={modals.addCharacterDialogOpen}
          closeAddCharacter={modals.closeAddCharacter}
          searchReplaceModalOpen={modals.searchReplaceModalOpen}
          closeSearchReplace={modals.closeSearchReplace}
          bulkReplaceModalOpen={modals.bulkReplaceModalOpen}
          closeBulkReplace={modals.closeBulkReplace}
          toolSettingsModalOpen={modals.toolSettingsModalOpen}
          closeToolSettings={modals.closeToolSettings}
          runToolModalOpen={modals.runToolModalOpen}
          closeRunTool={modals.closeRunTool}
          stateEditorModalOpen={modals.stateEditorModalOpen}
          closeStateEditor={modals.closeStateEditor}
          libraryFilePickerOpen={modals.libraryFilePickerOpen}
          closeLibraryFilePicker={modals.closeLibraryFilePicker}
          standaloneGenerateImageOpen={modals.standaloneGenerateImageOpen}
          closeStandaloneGenerateImage={modals.closeStandaloneGenerateImage}
          allLLMPauseModalOpen={modals.allLLMPauseModalOpen}
          setAllLLMPauseModalOpen={modals.setAllLLMPauseModalOpen}
          reattributeDialogState={modals.reattributeDialogState}
          setReattributeDialogState={modals.setReattributeDialogState}
          sudoApprovalState={modals.sudoApprovalState}
          setSudoApprovalState={modals.setSudoApprovalState}
          workspaceAcknowledgementState={modals.workspaceAcknowledgementState}
          setWorkspaceAcknowledgementState={modals.setWorkspaceAcknowledgementState}
          selectLLMProfileDialogState={modals.selectLLMProfileDialogState}
          setSelectLLMProfileDialogState={modals.setSelectLLMProfileDialogState}
          isConflictDialogOpen={isConflictDialogOpen}
          cancelConflict={cancelConflict}
          conflictInfo={conflictInfo}
          handleConflictResolution={handleConflictResolution}
          resolvingConflict={resolvingConflict}
          getFirstCharacter={participantsWithImpersonation.getFirstCharacter}
          getFirstUserCharacter={participantsWithImpersonation.getFirstUserCharacter}
          onCharacterAdded={chatControls.handleCharacterAdded}
          onReattributed={handleReattributed}
          onConfirmStopImpersonation={impersonation.handleConfirmStopImpersonation}
          memoryCascadeConfirmation={messageActions.memoryCascadeConfirmation}
          cancelMemoryCascadeConfirmation={messageActions.cancelMemoryCascadeConfirmation}
          handleMemoryCascadeConfirm={messageActions.handleMemoryCascadeConfirm}
          allLLMPauseTurnCount={impersonation.allLLMPauseTurnCount}
          llmParticipants={participantsWithImpersonation.llmParticipants}
          handleAllLLMContinue={handleAllLLMContinue}
          handleAllLLMStop={handleAllLLMStop}
          handleAllLLMTakeOver={handleAllLLMTakeOver}
          triggerContinueMode={sseStreaming.triggerContinueMode}
        />
      </div>

      <LLMInspectorPanel
        isOpen={llmLogs.inspectorOpen}
        onClose={llmLogs.closeInspector}
        chatId={id}
        logs={llmLogs.allChatLogs}
        loading={llmLogs.loading}
        scrollToMessageId={llmLogs.inspectorScrollToMessageId}
        onRefresh={llmLogs.refreshLogs}
        loggingEnabled={chatSettings?.llmLoggingSettings?.enabled !== false}
      />

      {modals.showParticipantSidebar && (
        <ParticipantSidebar
          participants={participantsWithImpersonation.participantData}
          turnState={turnState}
          turnSelectionResult={turnSelectionResult}
          isGenerating={sseStreaming.streaming || sseStreaming.waitingForResponse}
          userParticipantId={participantsWithImpersonation.userParticipantId}
          respondingParticipantId={respondingParticipantId}
          waitingForResponse={sseStreaming.waitingForResponse}
          isPaused={isPaused}
          onTogglePause={chatControls.togglePause}
          onNudge={turnManagement.handleNudge}
          onQueue={turnManagement.handleQueue}
          onDequeue={turnManagement.handleDequeue}
          onSkip={turnManagement.handleContinue}
          onStopStreaming={sseStreaming.stopStreaming}
          onTalkativenessChange={() => {}}
          onAddCharacter={modals.openAddCharacter}
          onRemoveCharacter={chatControls.handleRemoveCharacter}
          impersonatingParticipantIds={impersonation.impersonatingParticipantIds}
          activeTypingParticipantId={impersonation.activeTypingParticipantId}
          onImpersonate={impersonation.handleStartImpersonation}
          onStopImpersonate={impersonation.handleStopImpersonation}
          connectionProfiles={chatControls.connectionProfiles}
          onConnectionProfileChange={chatControls.handleConnectionProfileChange}
          onSystemPromptChange={chatControls.handleSystemPromptChange}
          onParticipantSettingsChange={chatControls.handleParticipantSettingsChange}
          onWhisper={handleWhisper}
          outfitState={outfit.outfitState}
          wardrobeCache={outfit.wardrobeCache}
          outfitLoading={outfit.loading}
          onEquipSlot={handleEquipSlot}
          onGiftItem={handleGiftItem}
          onRegenerateAvatar={chat?.avatarGenerationEnabled ? handleRegenerateAvatar : undefined}
          isDangerousChat={chat?.isDangerousChat === true}
        />
      )}

      {whisperTarget && (
        <WhisperDialog
          isOpen={!!whisperTarget}
          targetName={whisperTarget.name}
          targetParticipantId={whisperTarget.participantId}
          chatId={id}
          onClose={() => setWhisperTarget(null)}
          onSent={async () => {
            setWhisperTarget(null)
            await fetchChat()
          }}
        />
      )}

      {giftTarget && (
        <GiftWardrobeItemModal
          recipientCharacterId={giftTarget.characterId}
          recipientName={giftTarget.name}
          chatId={id}
          onClose={() => setGiftTarget(null)}
          onGifted={() => {
            outfit.invalidateWardrobe(giftTarget.characterId)
            setGiftTarget(null)
            outfit.refreshOutfit()
          }}
        />
      )}
    </div>
  )
}
