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
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

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
import {
  ChatComposer,
  VirtualizedMessageList,
  ChatModals,
} from './components'
import LLMInspectorPanel from '@/components/chat/LLMInspectorPanel'
import { WhisperDialog } from '@/components/chat/WhisperDialog'

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  useAvatarDisplay()

  // --- Core data hook ---
  const chatDataHook = useChatData(id)
  const { chat, messages, loading, error, chatSettings, swipeStates, chatPhotoCount, chatMemoryCount } = chatDataHook
  const { setChat, setMessages, setSwipeStates } = chatDataHook
  const { fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount } = chatDataHook

  // --- Story background ---
  const {
    backgroundUrl: storyBackgroundUrl,
    backgroundFileId: storyBackgroundFileId,
    backgroundFilename: storyBackgroundFilename,
    startPolling: startBackgroundPolling,
  } = useStoryBackground(
    id,
    chat?.projectId,
    chatSettings?.storyBackgroundsSettings?.enabled ?? false
  )

  // --- UI state that stays in page ---
  const [input, setInput] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [roleplayTemplateName, setRoleplayTemplateName] = useState<string | null>(null)
  const [roleplayRenderingPatterns, setRoleplayRenderingPatterns] = useState<RenderingPattern[] | undefined>(undefined)
  const [roleplayDialogueDetection, setRoleplayDialogueDetection] = useState<DialogueDetection | null | undefined>(undefined)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [pendingToolResults, setPendingToolResults] = useState<PendingToolResult[]>([])
  const [showAllWhispers, setShowAllWhispers] = useState(false)
  const [whisperTarget, setWhisperTarget] = useState<{ participantId: string; name: string } | null>(null)

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
        } else if (p.persona?.name) {
          names[p.id] = p.persona.name
        }
      }
    }
    return names
  }, [chat?.participants])

  const handleWhisper = useCallback((participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const name = participant?.character?.name || participant?.persona?.name || 'Unknown'
    setWhisperTarget({ participantId, name })
  }, [chat?.participants])

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
    inputRef: inputRef as React.RefObject<HTMLTextAreaElement>,
    setFileWriteApprovalState: modals.setFileWriteApprovalState,
    setSudoApprovalState: modals.setSudoApprovalState,
    setWorkspaceAcknowledgementState: modals.setWorkspaceAcknowledgementState,
    getFirstCharacterParticipant: participantsWithImpersonation.getFirstCharacterParticipant,
    setPauseState: chatControls.setPauseState,
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

  // Refresh outfit state when a tool result comes back (generation completes)
  const wasGeneratingForOutfitRef = useRef(false)
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse
    if (wasGeneratingForOutfitRef.current && !isGenerating) {
      outfit.refreshOutfit()
    }
    wasGeneratingForOutfitRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- outfit.refreshOutfit is stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, outfit.refreshOutfit])

  // Equip slot handler that maps participantId -> characterId
  const handleEquipSlot = useCallback((participantId: string, slot: string, itemId: string | null) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    if (characterId) {
      outfit.equipSlot(characterId, slot, itemId)
    }
  }, [chat?.participants, outfit])

  // --- Virtualizer ---
  const getItemKey = useCallback((index: number) => {
    return visibleMessages[index]?.id ?? index
  }, [visibleMessages])

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
    inputRef as React.RefObject<HTMLTextAreaElement>,
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
  useEffect(() => {
    if (chatSettings) {
      chatControls.setStoryBackgroundsEnabled(storyBackgroundsSettingsEnabled ?? false)
    }
  }, [chatSettings, storyBackgroundsSettingsEnabled, chatControls])

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

  // --- Textarea helpers ---
  const getTextareaMaxHeight = useCallback(() => {
    if (typeof globalThis === 'undefined' || !globalThis.window) return 200
    return globalThis.window.innerHeight / 3
  }, [])

  const resizeTextarea = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = '0'
    const maxHeight = getTextareaMaxHeight()
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = newHeight + 'px'
  }, [getTextareaMaxHeight])

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
        return
      }
      try {
        const res = await fetch(`/api/v1/roleplay-templates/${chat.roleplayTemplateId}`)
        if (res.ok) {
          const template = await res.json()
          setRoleplayTemplateName(template.name)
          setRoleplayRenderingPatterns(template.renderingPatterns)
          setRoleplayDialogueDetection(template.dialogueDetection)
        } else {
          setRoleplayTemplateName(null)
          setRoleplayRenderingPatterns(undefined)
          setRoleplayDialogueDetection(undefined)
        }
      } catch {
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
      }
    }
    fetchTemplateData()
  }, [chat?.roleplayTemplateId])

  // --- Textarea focus and resize effects ---
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
  }, [chat?.projectId, chat?.projectName, chat?.title, llmCharacterKey, setLeftContent, storyBackgroundUrl, storyBackgroundFileId, storyBackgroundFilename, setModalImage])

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
    if (message.participantId) {
      const participant = participantsWithImpersonation.getParticipantById(message.participantId)
      if (participant) {
        if (participant.type === 'CHARACTER' && participant.character) {
          return { name: participant.character.name, title: participant.character.title, avatarUrl: participant.character.avatarUrl, defaultImage: participant.character.defaultImage }
        } else if (participant.type === 'PERSONA' && participant.persona) {
          return { name: participant.persona.name, title: participant.persona.title, avatarUrl: participant.persona.avatarUrl, defaultImage: participant.persona.defaultImage }
        }
      }
    }
    if (message.role === 'USER') {
      const persona = participantsWithImpersonation.getFirstPersona()
      if (persona) {
        return { name: persona.name, title: persona.title, avatarUrl: persona.avatarUrl, defaultImage: persona.defaultImage }
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
        {/* Whisper toggle - shown in multi-character chats */}
        {participantsWithImpersonation.isMultiChar && (
          <div className="flex items-center justify-end gap-2 px-4 py-1">
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
        )}

        <VirtualizedMessageList
          messages={visibleMessages}
          virtualizer={virtualizer}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          editingMessageId={editingMessageId}
          editContent={editContent}
          viewSourceMessageIds={viewSourceMessageIds}
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
          fileWriteApprovalState={modals.fileWriteApprovalState}
          setFileWriteApprovalState={modals.setFileWriteApprovalState}
          chatId={id}
          triggerContinueMode={sseStreaming.triggerContinueMode}
          getRespondingCharacter={getRespondingCharacter}
          shouldShowAvatars={shouldShowAvatars}
          getFirstCharacter={participantsWithImpersonation.getFirstCharacter}
          getMessageAvatar={getMessageAvatar}
          participantNames={participantNames}
          userParticipantIdSet={userParticipantIdSet}
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
          showPreview={modals.showPreview}
          setShowPreview={modals.setShowPreview}
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
          agentModeEnabled={chatControls.agentModeEnabled}
          onAgentModeToggle={chatControls.handleToggleAgentMode}
          storyBackgroundsEnabled={chatControls.storyBackgroundsEnabled}
          onRegenerateBackgroundClick={chatControls.handleRegenerateBackground}
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
          fileWriteApprovalState={modals.fileWriteApprovalState}
          setFileWriteApprovalState={modals.setFileWriteApprovalState}
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
          getFirstPersona={participantsWithImpersonation.getFirstPersona}
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
          onParticipantSettingsChange={chatControls.handleParticipantSettingsChange}
          onWhisper={handleWhisper}
          outfitState={outfit.outfitState}
          wardrobeCache={outfit.wardrobeCache}
          outfitLoading={outfit.loading}
          onEquipSlot={handleEquipSlot}
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
    </div>
  )
}
