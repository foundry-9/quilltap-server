'use client'

import { use, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import ImageModal from '@/components/chat/ImageModal'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import ToolPalette from '@/components/chat/ToolPalette'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import ChatProjectModal from '@/components/chat/ChatProjectModal'
import ChatRenameModal from '@/components/chat/ChatRenameModal'
import GenerateImageDialog from '@/components/chat/GenerateImageDialog'
import ParticipantSidebar from '@/components/chat/ParticipantSidebar'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'
import ReattributeMessageDialog from '@/components/chat/ReattributeMessageDialog'
import BulkCharacterReplaceModal from '@/components/chat/BulkCharacterReplaceModal'
import ChatToolSettingsModal from '@/components/chat/ChatToolSettingsModal'
import StateEditorModal from '@/components/state/StateEditorModal'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import type { SearchReplaceResult } from '@/components/tools/search-replace/types'
import AllLLMPauseModal from '@/components/chat/AllLLMPauseModal'
import LLMLogViewerModal from '@/components/chat/LLMLogViewerModal'
import FileWriteApprovalModal from '@/components/chat/FileWriteApprovalModal'
import FileWritePermissionPrompt from '@/components/chat/FileWritePermissionPrompt'
import FileConflictDialog from '@/components/chat/FileConflictDialog'
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
import { getErrorMessage } from '@/lib/error-utils'
import MessageContent from '@/components/chat/MessageContent'
import ToolMessage from '@/components/chat/ToolMessage'
import { ChatCostSummary } from '@/components/chat/ChatCostSummary'
import { formatMessageTime } from '@/lib/format-time'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStoryBackground } from '@/hooks/useStoryBackground'
import Avatar, { getAvatarSrc } from '@/components/ui/Avatar'
import { useChatContext } from '@/components/providers/chat-context'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { usePageToolbar } from '@/components/providers/page-toolbar-provider'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
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
import type { ChatParticipantBase, Character, LLMLog } from '@/lib/schemas/types'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

// Import extracted hooks
import {
  useChatData,
  useTurnManagement,
  useMessageActions,
  useFileAttachments,
  useAutoScroll,
  type SwipeState,
} from './hooks'
import type { Chat, ChatSettings, Message, MessageAttachment, Participant, CharacterData, PendingToolResult } from './types'
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

  // Use the extracted chat data hook
  const chatDataHook = useChatData(id)
  const { chat, messages, loading, error, chatSettings, swipeStates, chatPhotoCount, chatMemoryCount } = chatDataHook
  const { setChat, setMessages, setSwipeStates } = chatDataHook
  const { fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount, persistTurnState } = chatDataHook

  // Story background hook - fetches background image for chat/project
  // Enables passive polling (every 30s) when story backgrounds are enabled
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
  const [documentEditingMode, setDocumentEditingMode] = useState(false)
  const [agentModeEnabled, setAgentModeEnabled] = useState<boolean | null>(null)
  const [storyBackgroundsEnabled, setStoryBackgroundsEnabled] = useState(false)
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = useState(false)
  const [chatProjectModalOpen, setChatProjectModalOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [reattributeDialogState, setReattributeDialogState] = useState<{
    isOpen: boolean
    messageId: string
    currentParticipantId: string | null
  } | null>(null)
  const [searchReplaceModalOpen, setSearchReplaceModalOpen] = useState(false)
  const [bulkReplaceModalOpen, setBulkReplaceModalOpen] = useState(false)
  const [toolSettingsModalOpen, setToolSettingsModalOpen] = useState(false)
  const [stateEditorModalOpen, setStateEditorModalOpen] = useState(false)
  const [toolExecutionStatus, setToolExecutionStatus] = useState<{ tool: string; status: 'pending' | 'success' | 'error'; message: string } | null>(null)
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ id: string; name: string; status: 'pending' | 'success' | 'error'; result?: unknown; arguments?: Record<string, unknown> }>>([])
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [ephemeralMessages, setEphemeralMessages] = useState<EphemeralMessageData[]>([])
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [responseStatus, setResponseStatus] = useState<{
    stage: string
    message: string
    toolName?: string
    characterName?: string
    characterId?: string
  } | null>(null)

  // Connection profiles for participant sidebar
  const [connectionProfiles, setConnectionProfiles] = useState<Array<{ id: string; name: string; provider?: string; modelName?: string }>>([])

  // Impersonation state (Characters Not Personas)
  const [impersonatingParticipantIds, setImpersonatingParticipantIds] = useState<string[]>([])
  const [activeTypingParticipantId, setActiveTypingParticipantId] = useState<string | null>(null)
  const [allLLMPauseTurnCount, setAllLLMPauseTurnCount] = useState(0)
  const [allLLMPauseModalOpen, setAllLLMPauseModalOpen] = useState(false)
  const [fileWriteApprovalState, setFileWriteApprovalState] = useState<{
    isOpen: boolean
    pendingWrite: {
      filename: string
      content?: string
      mimeType?: string
      folderPath: string
      projectId: string | null
    }
    projectName?: string
    /** The participant ID that made the write request, so we can trigger them to continue */
    respondingParticipantId?: string
  } | null>(null)
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

  // LLM log viewer state
  const [llmLogViewerOpen, setLLMLogViewerOpen] = useState(false)
  const [llmLogsForViewer, setLLMLogsForViewer] = useState<LLMLog[]>([])
  const [selectedMessageIdForLogs, setSelectedMessageIdForLogs] = useState<string | null>(null)
  // Track which messages have logs (for showing the button)
  const [messagesWithLogs, setMessagesWithLogs] = useState<Set<string>>(new Set())

  // Use the extracted file attachments hook
  const fileHook = useFileAttachments(id, chat?.projectId)
  const { attachedFiles, setAttachedFiles, uploadingFile } = fileHook
  const { handleFileSelect, removeAttachedFile, uploadFile } = fileHook
  const { conflictInfo, isConflictDialogOpen, resolvingConflict, handleConflictResolution, cancelConflict } = fileHook

  // Pending tool results (shown in composer before sending)
  const [pendingToolResults, setPendingToolResults] = useState<PendingToolResult[]>([])

  // Add a pending tool result (from RNG or other tools)
  const handleAddPendingToolResult = useCallback((result: Omit<PendingToolResult, 'id' | 'createdAt'>) => {
    const newResult: PendingToolResult = {
      ...result,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    setPendingToolResults(prev => {
      return [...prev, newResult]
    })
  }, [])

  // Remove a pending tool result
  const handleRemovePendingToolResult = useCallback((resultId: string) => {
    setPendingToolResults(prev => prev.filter(r => r.id !== resultId))
  }, [])

  // Refs
  const lastAutoTriggeredRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  // Use message IDs as keys for the virtualizer to prevent stale measurement cache
  // When messages are replaced (e.g., temp ID -> server ID), the virtualizer needs to
  // know they're different items to re-measure them. Without this, it uses indices
  // and can position items at wrong locations when the array is replaced.
  const getItemKey = useCallback((index: number) => {
    return messages[index]?.id ?? index
  }, [messages])

  // Virtualizer for efficient message list rendering - must be defined before auto-scroll hook
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 150, // Estimated row height in pixels
    overscan: 5, // Render 5 extra items above/below viewport for smooth scrolling
    getItemKey, // Use message IDs to properly track items across array replacements
  })

  // Intelligent auto-scroll hook - handles settling, streaming, and user scroll intent
  const {
    scrollOnUserMessage,
    scrollOnStreamComplete,
    isAutoScrollEnabled,
    isSettled,
  } = useAutoScroll({
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    virtualizer,
    messageCount: messages.length,
    isStreaming: streaming,
    isWaitingForResponse: waitingForResponse,
    streamingContent,
    isLoading: loading,
  })

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
    } catch {
      // Failed to restore draft from localStorage
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
      } catch {
        // Failed to save draft to localStorage
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
    } catch {
      // Failed to clear draft from localStorage
    }
  }, [draftStorageKey])

  // Cleanup effect: abort any pending request when unmounting or chat changes
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [id])

  // Sync agentModeEnabled state when chat loads
  const chatAgentModeEnabled = chat?.agentModeEnabled
  useEffect(() => {
    if (chat) {
      setAgentModeEnabled(chatAgentModeEnabled ?? null)
    }
  }, [chat, chatAgentModeEnabled])

  // Sync storyBackgroundsEnabled state when chatSettings loads
  const storyBackgroundsSettingsEnabled = chatSettings?.storyBackgroundsSettings?.enabled
  useEffect(() => {
    if (chatSettings) {
      setStoryBackgroundsEnabled(storyBackgroundsSettingsEnabled ?? false)
    }
  }, [chatSettings, storyBackgroundsSettingsEnabled])

  // Fetch connection profiles for participant sidebar dropdowns
  useEffect(() => {
    const fetchConnectionProfiles = async () => {
      try {
        const res = await fetch('/api/v1/connection-profiles')
        if (res.ok) {
          const data = await res.json()
          setConnectionProfiles((data.profiles || []).map((p: { id: string; name: string; provider?: string; modelName?: string }) => ({
            id: p.id,
            name: p.name,
            provider: p.provider,
            modelName: p.modelName,
          })))
        }
      } catch (error) {
        console.error('Failed to fetch connection profiles for sidebar', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    fetchConnectionProfiles()
  }, [])

  // Handle scroll-to-message from memory provenance navigation
  useEffect(() => {
    // Only check once messages are loaded
    if (loading || messages.length === 0) return

    const pendingNav = getPendingMessageNavigation()
    if (pendingNav.scrollTo) {
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

  // Legacy scrollToBottom for explicit programmatic scroll (e.g., after message navigation)
  // Most auto-scroll logic is now handled by useAutoScroll hook
  const scrollToBottom = useCallback(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' })
    }
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [messages.length, virtualizer])

  const getTextareaMaxHeight = useCallback(() => {
    if (typeof globalThis === 'undefined' || !globalThis.window) return 200
    const windowHeight = globalThis.window.innerHeight
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
    // Filter to CHARACTER type only (personas are no longer supported) and ensure characterId is present
    return chat.participants
      .filter(p => p.type === 'CHARACTER' && (p.characterId || p.character?.id))
      .map(p => {
        const characterId = p.characterId || p.character?.id
        return {
          id: p.id,
          type: 'CHARACTER' as const,
          characterId: characterId!,
          controlledBy: p.controlledBy ?? 'llm',
          connectionProfileId: p.connectionProfile?.id ?? null,
          imageProfileId: p.imageProfile?.id ?? null,
          systemPromptOverride: p.systemPromptOverride ?? null,
          displayOrder: p.displayOrder,
          isActive: p.isActive,
          hasHistoryAccess: p.hasHistoryAccess ?? false,
          joinScenario: p.joinScenario ?? null,
          createdAt: p.createdAt ?? new Date().toISOString(),
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        }
      })
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

  // Get non-user-controlled characters for header display
  const llmCharacters = useMemo(() => {
    if (!chat?.participants) return []
    return chat.participants
      .filter(p => p.type === 'CHARACTER' && p.controlledBy === 'llm' && p.character)
      .map(p => p.character!)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [chat?.participants])

  // Set project link, character links, and title in toolbar
  const { setLeftContent, setRightContent } = usePageToolbar()
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
                    <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-xs font-medium text-muted-foreground">
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
    // Clear on unmount
    return () => setLeftContent(null)
  }, [chat?.projectId, chat?.projectName, chat?.title, llmCharacters, setLeftContent, storyBackgroundUrl, storyBackgroundFileId, storyBackgroundFilename])

  // Set cost summary in toolbar right section
  useEffect(() => {
    if (chatSettings?.tokenDisplaySettings?.showChatTotals) {
      setRightContent(
        <ChatCostSummary
          chatId={id}
          show={chatSettings.tokenDisplaySettings.showChatTotals}
          variant="compact"
          refreshKey={messages.length}
        />
      )
    } else {
      setRightContent(null)
    }
    // Clear on unmount
    return () => setRightContent(null)
  }, [id, chatSettings?.tokenDisplaySettings?.showChatTotals, setRightContent, messages.length])

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
      systemPromptOverride: p.systemPromptOverride ?? null,
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
    }
  }, [chat?.isPaused, isAllLLM, allLLMTurnCount])

  // Initialize impersonation state from chat metadata
  // We intentionally only depend on specific chat properties to avoid re-running on every chat update
  useEffect(() => {
    const impersonatingIds = chat?.impersonatingParticipantIds
    const activeTypingId = chat?.activeTypingParticipantId
    const pauseTurnCount = chat?.allLLMPauseTurnCount

    if (impersonatingIds && impersonatingIds.length > 0) {
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
      showErrorToast('This participant is no longer available in the chat.')
      return
    }

    if (!turnManagement.hasActiveCharacters) {
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

      const res = await fetch(`/api/v1/messages?chatId=${id}`, {
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

              // Handle status updates
              if (data.status) {
                setResponseStatus(data.status)
              }

              if (data.content) {
                fullContent += data.content
                setWaitingForResponse(false)
                setStreaming(true)
                setStreamingContent(fullContent)
              }

              if (data.error) {
                // Clear response status
                setResponseStatus(null)
                // Include details in error message if available
                const errorMsg = data.details
                  ? `${data.error}: ${data.details}`
                  : data.error
                throw new Error(errorMsg)
              }

              if (data.done) {
                // Clear response status
                setResponseStatus(null)

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
        let errorMessage = 'Failed to generate response'
        let errorName = 'UnknownErrorType'

        if (err instanceof Error) {
          errorMessage = err.message || err.name || errorMessage
          errorName = err.name
        } else if (typeof err === 'string') {
          errorMessage = err
        } else if (err && typeof err === 'object') {
          // Handle plain object errors (e.g., from API responses)
          const errObj = err as Record<string, unknown>
          if (typeof errObj.error === 'string') {
            errorMessage = errObj.error
          } else if (typeof errObj.message === 'string') {
            errorMessage = errObj.message
          }
        }

        showErrorToast(errorMessage)
      }
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      setStreamingContent('')
      setRespondingParticipantId(null)
      setResponseStatus(null)
      abortControllerRef.current = null
      scrollOnStreamComplete()
      // Return focus to input after AI response completes
      // Use longer timeout to let smooth scroll settle, and preventScroll to avoid conflicts
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 150)
    }
  }, [id, streaming, waitingForResponse, participantsAsBase, turnManagement.hasActiveCharacters, setMessages, setEphemeralMessages, scrollOnStreamComplete])

  // Keep the ref in sync with the current callback to break dependency cycle
  triggerContinueModeRef.current = triggerContinueMode

  // Function to set pause state and persist to database
  const setPauseState = useCallback(async (paused: boolean) => {
    setIsPaused(paused)
    userStoppedStreamRef.current = paused

    try {
      const response = await fetch(`/api/v1/chats/${id}`, {
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
  }, [id])

  // Toggle document editing mode and persist to database
  const handleToggleDocumentEditingMode = useCallback(async () => {
    const newMode = !documentEditingMode
    setDocumentEditingMode(newMode)

    try {
      const response = await fetch(`/api/v1/chats/${id}`, {
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
      // Track the turn count at which we paused
      lastAllLLMPauseTurnCountRef.current = allLLMTurnCount
      // Auto-pause the chat
      setPauseState(true)
      showInfoToast(`Auto-paused after ${allLLMTurnCount} turns. Click Resume to continue.`)
      return
    }

    if (lastAutoTriggeredRef.current === effectiveNextSpeakerId) return

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
    fetchChat()
  }, [fetchChat])

  const handleReattribute = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setReattributeDialogState({
        isOpen: true,
        messageId,
        currentParticipantId: message.participantId || null,
      })
    }
  }, [messages])

  const handleReattributed = useCallback(async () => {
    const messageId = reattributeDialogState?.messageId
    setReattributeDialogState(null)
    await fetchChat()
    // Scroll to the reattributed message after refresh
    if (messageId) {
      setTimeout(() => {
        const messageElement = document.getElementById(`message-${messageId}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100) // Small delay to ensure DOM is updated
    }
  }, [fetchChat, reattributeDialogState?.messageId])

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

    if ((streaming || waitingForResponse) && turnState.lastSpeakerId === participantId) {
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
      const res = await fetch(`/api/v1/chats/${id}?action=remove-participant`, {
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
  }, [id, participantData, fetchChat, streaming, waitingForResponse, turnState.lastSpeakerId, participantsAsBase])

  // Handle connection profile change from participant sidebar
  const handleConnectionProfileChange = useCallback(async (
    participantId: string,
    profileId: string | null,
    controlledBy: 'llm' | 'user'
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=update-participant`, {
        method: 'PUT',
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
  }, [id, fetchChat])

  // Handle participant settings change (system prompt override, active toggle) from sidebar
  const handleParticipantSettingsChange = useCallback(async (
    participantId: string,
    updates: { systemPromptOverride?: string | null; isActive?: boolean }
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=update-participant`, {
        method: 'PUT',
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
  }, [id, fetchChat])

  // Impersonation handlers
  const handleStartImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const res = await fetch(`/api/v1/chats/${id}?action=impersonate`, {
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
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to start impersonation')
    }
  }, [id, participantData])

  const handleStopImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    // Check if we need to show the LLM profile selection dialog
    // This is needed when the character doesn't have a default connection profile
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

    // Otherwise, stop impersonation directly
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=stop-impersonate`, {
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
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to stop impersonation')
    }
  }, [id, participantData])

  const handleConfirmStopImpersonation = useCallback(async (participantId: string, connectionProfileId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const res = await fetch(`/api/v1/chats/${id}?action=stop-impersonate`, {
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

      // Refresh chat to get updated participant connection profile
      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to assign LLM profile')
    }
  }, [id, participantData, fetchChat])

  const handleSetActiveSpeaker = useCallback(async (participantId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=set-active-speaker`, {
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to set active speaker')
    }
  }, [id])

  // All-LLM pause handlers
  const handleAllLLMContinue = useCallback(() => {
    setAllLLMPauseModalOpen(false)
    // The turn count will be incremented by the server after each message
  }, [])

  const handleAllLLMStop = useCallback(() => {
    setAllLLMPauseModalOpen(false)
    setPauseState(true)
  }, [setPauseState])

  const handleAllLLMTakeOver = useCallback(async (participantId: string) => {
    setAllLLMPauseModalOpen(false)
    await handleStartImpersonation(participantId)
  }, [handleStartImpersonation])

  // Check which messages have LLM logs
  const checkMessagesForLogs = useCallback(async () => {
    if (!id || !messages.length) return

    // Get assistant message IDs
    const assistantMessageIds = messages
      .filter(m => m.role === 'ASSISTANT')
      .map(m => m.id)

    if (assistantMessageIds.length === 0) return

    try {
      // Batch check - get all logs for this chat and extract message IDs
      const res = await fetch(`/api/v1/llm-logs?chatId=${id}&limit=1000`)
      if (res.ok) {
        const data = await res.json()
        const messageIdsWithLogs = new Set<string>(
          data.logs
            .filter((log: LLMLog) => log.messageId)
            .map((log: LLMLog) => log.messageId!)
        )
        setMessagesWithLogs(messageIdsWithLogs)
      }
    } catch (error) {
      // Silent fail - logging is not critical
    }
  }, [id, messages])

  // Call on mount and when messages change
  useEffect(() => {
    checkMessagesForLogs()
  }, [checkMessagesForLogs])

  // Handle viewing LLM logs
  const handleViewLLMLogs = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/v1/llm-logs?messageId=${messageId}`)
      if (!res.ok) throw new Error('Failed to fetch logs')

      const data = await res.json()
      if (data.logs && data.logs.length > 0) {
        setLLMLogsForViewer(data.logs)
        setSelectedMessageIdForLogs(messageId)
        setLLMLogViewerOpen(true)
      }
    } catch (error) {
      console.error('Failed to fetch LLM logs:', error)
      // Optionally show a toast
      showErrorToast('Failed to load LLM logs')
    }
  }, [])

  // Handle memories
  const handleDeleteChatMemories = useCallback(async () => {
    if (chatMemoryCount === 0) {
      return
    }

    const confirmed = await showConfirmation(
      `Delete all ${chatMemoryCount} memories created from this chat? This action cannot be undone.`
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/memories?chatId=${id}`, { method: 'DELETE' })

      if (res.ok) {
        const data = await res.json()
        chatDataHook.setChatMemoryCount(0)
        showSuccessToast(`Deleted ${data.deletedCount} memories`)
      } else {
        const errorData = await res.json()
        showErrorToast(`Failed to delete memories: ${errorData.error}`)
      }
    } catch {
      showErrorToast('Failed to delete memories')
    }
  }, [id, chatMemoryCount, chatDataHook])

  const handleReextractMemories = useCallback(async () => {
    const characterParticipant = chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)
    if (!characterParticipant?.character) {
      showErrorToast('Cannot re-extract memories: no active character in chat')
      return
    }

    const confirmed = await showConfirmation(
      `Queue memory extraction jobs for all messages in this chat? This will process the entire conversation history.`
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/chats/${id}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: characterParticipant.character.id,
          characterName: characterParticipant.character.name,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
        notifyQueueChange()
      } else {
        const errorData = await res.json()
        showErrorToast(`Failed to queue memory extraction: ${errorData.error}`)
      }
    } catch {
      showErrorToast('Failed to queue memory extraction')
    }
  }, [id, chat])

  const handleToggleAgentMode = useCallback(async () => {
    try {
      const newEnabled = agentModeEnabled === null || !agentModeEnabled;
      
      const res = await fetch(`/api/v1/chats/${id}?action=toggle-agent-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to toggle agent mode')
      }

      const data = await res.json()
      setAgentModeEnabled(data.agentModeEnabled)

      const status = data.agentModeEnabled === true 
        ? 'enabled' 
        : data.agentModeEnabled === false 
        ? 'disabled' 
        : 'set to inherit'
      
      showSuccessToast(`Agent mode ${status}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle agent mode')
    }
  }, [id, agentModeEnabled])

  const handleRegenerateBackground = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=regenerate-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to regenerate background')
      }

      showSuccessToast('Story background regeneration queued')
      notifyQueueChange()

      // Start polling for the new background
      startBackgroundPolling()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to regenerate background')
    }
  }, [id, startBackgroundPolling])

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

  // Auto-scroll is now handled by useAutoScroll hook which:
  // - Waits for page to settle after initial load before scrolling
  // - Only scrolls on streaming completion, not every content chunk
  // - Respects user scroll intent (disables auto-scroll if user scrolls up)

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
    if ((!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) || sending) return

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
    // Capture pending tool results before clearing
    const toolResultsToSend = [...pendingToolResults]
    setInput('')
    clearDraft()
    setAttachedFiles([])
    setPendingToolResults([])
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

    // Add pending tool result messages to UI (before user message)
    const toolMessages: Message[] = toolResultsToSend.map((result, index) => ({
      id: `temp-tool-${Date.now()}-${index}`,
      role: 'TOOL',
      content: JSON.stringify({
        tool: result.tool,
        initiatedBy: 'user',
        success: result.success,
        result: result.formattedResult,
        prompt: result.requestPrompt,
        arguments: result.arguments,
      }),
      createdAt: result.createdAt,
    }))

    // Add user message to UI
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    }
    setMessages((prev) => [...prev, ...toolMessages, tempUserMessage])

    // Scroll to show user message - this also re-enables auto-scroll
    scrollOnUserMessage()

    // Build request payload with pending tool results
    const requestPayload = {
      content: userMessage || (attachedFiles.length > 0 ? 'Please look at the attached file(s).' : ''),
      fileIds,
      // Include pending tool results to be persisted as TOOL messages
      pendingToolResults: toolResultsToSend.length > 0 ? toolResultsToSend.map(r => ({
        tool: r.tool,
        success: r.success,
        result: r.formattedResult,
        prompt: r.requestPrompt,
        arguments: r.arguments,
        createdAt: r.createdAt,
      })) : undefined,
    }

    try {
      // Create AbortController for this request
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/v1/messages?chatId=${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal,
      })

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

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim()
            // Skip SSE markers that aren't JSON (OpenAI/OpenRouter use [DONE] to signal end of stream)
            if (!rawData || rawData === '[DONE]' || rawData === '{}') {
              continue
            }
            try {
              const data = JSON.parse(rawData)

              // Handle status updates
              if (data.status) {
                setResponseStatus(data.status)
              }

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
                const { index, name, success, result, requiresPermission, pendingWrite } = data.toolResult

                // Update pending tool call status by index (more reliable) or fall back to name
                setPendingToolCalls(prev => prev.map((tc, idx) =>
                  (index !== undefined && idx === index) || (index === undefined && tc.name === name)
                    ? { ...tc, status: success ? 'success' : 'error', result }
                    : tc
                ))

                // Handle file write permission requirement
                if (requiresPermission && pendingWrite) {
                  setFileWriteApprovalState({
                    isOpen: false, // Start with modal closed; inline prompt shows first
                    pendingWrite: {
                      filename: pendingWrite.filename || 'unknown',
                      content: pendingWrite.content,
                      mimeType: pendingWrite.mimeType || 'text/plain',
                      folderPath: pendingWrite.folderPath || '/',
                      projectId: pendingWrite.projectId ?? chat?.projectId ?? null,
                    },
                    projectName: chat?.projectName ?? undefined,
                    // Store the responding participant so we can trigger them to continue after approval
                    respondingParticipantId: respondingParticipantId ?? undefined,
                  })
                  // Toast removed - inline prompt provides clear visual indication
                }

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

              if (data.done) {
                // Clear response status
                setResponseStatus(null)

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
                // Scroll to bottom now that streaming is complete
                scrollOnStreamComplete()
                // Refresh chat to get tool messages
                await fetchChat()
                // Notify queue badges that jobs may have been enqueued
                notifyQueueChange()
                // Clear tool status after a short delay
                setTimeout(() => {
                  setToolExecutionStatus(null)
                  setPendingToolCalls([])
                }, 3000)
              }

              if (data.error) {
                // Clear response status
                setResponseStatus(null)
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
              // Skip logging for SSE parse issues (chunking artifacts)
            }
          }
        }
      }
    } catch (err) {
      // Check if this was an abort (user stopped the response)
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (isAbort) {
        // Don't remove user message or show error for abort
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
      } else {
        // Extract error message, handling cases where message may be undefined
        // Network errors (connection dropped, timeout) may have empty messages
        const errorMessage = err instanceof Error
          ? (err.message || err.name || 'Unknown error')
          : String(err) || 'Unknown error'
        const errorName = err instanceof Error ? err.name : 'UnknownErrorType'

        // Show user-friendly message for common network errors
        const displayMessage = errorMessage === 'Unknown error' || errorMessage === 'TypeError'
          ? 'Connection lost. Please try again.'
          : errorMessage
        showErrorToast(displayMessage || 'Failed to send message')

        // Remove the temporary user message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMessageId))
        setStreamingContent('')
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
      }
    } finally {
      setSending(false)
      abortControllerRef.current = null
      setResponseStatus(null)
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
    <div
      className="qt-chat-layout"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <div className="qt-chat-main">
        <div className="qt-chat-messages" ref={messagesContainerRef}>
          <div className="qt-chat-messages-list">
            {/* Virtualized messages rendering */}
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const messageIndex = virtualRow.index
                const message = messages[messageIndex]
                const isEditing = editingMessageId === message.id
                const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null
                const showResendButton = messageActions.canResendMessage(message.id, messageIndex)

                if (message.role === 'TOOL') {
                  return (
                    <div
                      key={message.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ToolMessage
                        message={message}
                        character={getFirstCharacter() ?? undefined}
                        onImageClick={(filepath, filename, fileId) => {
                          setModalImage({ src: filepath, filename, fileId })
                        }}
                      />
                    </div>
                  )
                }

                const messageAvatarData = shouldShowAvatars() ? getMessageAvatar(message) : null
                const messageAvatar = messageAvatarData as any

                return (
                  <div
                    key={message.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <MessageRow
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
                      forceRender={messageIndex >= messages.length - 5}
                      isMultiChar={isMultiChar}
                      participantData={participantData}
                      turnState={turnState}
                      streaming={streaming}
                      waitingForResponse={waitingForResponse}
                      userParticipantId={userParticipantId}
                      isPaused={isPaused}
                      onTogglePause={togglePause}
                      tokenDisplaySettings={chatSettings?.tokenDisplaySettings}
                      dangerousContentSettings={chatSettings?.dangerousContentSettings}
                      onOverrideDangerFlag={handleOverrideDangerFlag}
                      character={getFirstCharacter() ?? undefined}
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
                      onHandleNudge={turnManagement.handleNudge}
                      onHandleQueue={turnManagement.handleQueue}
                      onHandleDequeue={turnManagement.handleDequeue}
                      onHandleTalkativenessChange={(pId, value) => {
                        // Handle talkativeness change - this would need to be implemented
                      }}
                      onHandleRemoveCharacter={handleRemoveCharacter}
                      onHandleContinue={turnManagement.handleContinue}
                      onReattribute={handleReattribute}
                      hasLLMLogs={messagesWithLogs.has(message.id)}
                      onViewLLMLogs={handleViewLLMLogs}
                    />
                  </div>
                )
              })}
            </div>

            {/* Pending tool calls */}
            <PendingToolCalls pendingToolCalls={pendingToolCalls} />

            {/* Ephemeral messages */}
            <EphemeralMessagesComponent
              messages={ephemeralMessages}
              onDismiss={turnManagement.handleDismissEphemeral}
            />

            {/* Inline file write permission prompt */}
            {fileWriteApprovalState && (
              <FileWritePermissionPrompt
                request={{
                  filename: fileWriteApprovalState.pendingWrite.filename,
                  content: fileWriteApprovalState.pendingWrite.content,
                  mimeType: fileWriteApprovalState.pendingWrite.mimeType,
                  folderPath: fileWriteApprovalState.pendingWrite.folderPath,
                  projectId: fileWriteApprovalState.pendingWrite.projectId,
                }}
                projectName={fileWriteApprovalState.projectName}
                chatId={id}
                onApprove={async () => {
                  // Store participant ID before clearing state
                  const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
                  setFileWriteApprovalState(null)
                  // Refresh chat to show any new files/messages
                  await fetchChat()
                  // Trigger the LLM to continue and respond to the tool result
                  if (participantToTrigger) {
                    // Small delay to ensure the tool message is saved first
                    setTimeout(() => {
                      triggerContinueMode(participantToTrigger)
                    }, 500)
                  }
                }}
                onDeny={async () => {
                  // Store participant ID before clearing state
                  const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
                  setFileWriteApprovalState(null)
                  showInfoToast('File write denied.')
                  // Refresh chat to show the denial tool message
                  await fetchChat()
                  // Trigger the LLM to continue and acknowledge the denial
                  if (participantToTrigger) {
                    setTimeout(() => {
                      triggerContinueMode(participantToTrigger)
                    }, 500)
                  }
                }}
                onViewDetails={() => {
                  // Open the modal for full details
                  setFileWriteApprovalState(prev => prev ? { ...prev, isOpen: true } : null)
                }}
              />
            )}

            {/* Streaming message - using extracted component */}
            <StreamingMessage
              streaming={streaming}
              streamingContent={streamingContent}
              waitingForResponse={waitingForResponse}
              respondingCharacter={getRespondingCharacter() || undefined}
              renderingPatterns={roleplayRenderingPatterns}
              dialogueDetection={roleplayDialogueDetection}
              shouldShowAvatars={shouldShowAvatars()}
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
          pendingToolResults={pendingToolResults}
          onRemovePendingToolResult={handleRemovePendingToolResult}
          disabled={sending}
          sending={sending}
          hasActiveCharacters={hasActiveCharacters}
          streaming={streaming}
          waitingForResponse={waitingForResponse}
          responseStatus={responseStatus}
          toolPaletteOpen={toolPaletteOpen}
          setToolPaletteOpen={setToolPaletteOpen}
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
          agentModeEnabled={agentModeEnabled}
          onAgentModeToggle={handleToggleAgentMode}
          storyBackgroundsEnabled={storyBackgroundsEnabled}
          onRegenerateBackgroundClick={handleRegenerateBackground}
          onSubmit={sendMessage}
          onFileSelect={handleFileSelect}
          onAttachFileClick={() => {
            // File input ref will be created in component
          }}
          onImagePaste={async (file: File) => {
            // Upload pasted image using the existing upload logic
            try {
              const success = await uploadFile(file)
              if (success) {
                showSuccessToast('Image pasted and attached')
              }
            } catch (err) {
              showErrorToast(err instanceof Error ? err.message : 'Failed to upload pasted image')
            }
          }}
          onGalleryClick={() => setGalleryOpen(true)}
          onGenerateImageClick={() => setGenerateImageDialogOpen(true)}
          onAddCharacterClick={handleAddCharacter}
          onSettingsClick={() => setChatSettingsModalOpen(true)}
          onRenameClick={handleRenameClick}
          onProjectClick={() => setChatProjectModalOpen(true)}
          projectName={chat?.projectName}
          onDeleteChatMemoriesClick={handleDeleteChatMemories}
          onReextractMemoriesClick={handleReextractMemories}
          onSearchReplaceClick={() => setSearchReplaceModalOpen(true)}
          onBulkCharacterReplaceClick={() => setBulkReplaceModalOpen(true)}
          onToolSettingsClick={() => setToolSettingsModalOpen(true)}
          onStateClick={() => setStateEditorModalOpen(true)}
          onStopStreaming={stopStreaming}
          hideStopButton={shouldShowParticipantSidebar}
          onPendingToolResult={handleAddPendingToolResult}
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
          roleplayTemplateId={chat?.roleplayTemplateId}
          imageProfileId={chat?.imageProfileId}
          onSuccess={fetchChat}
        />

        <ChatProjectModal
          isOpen={chatProjectModalOpen}
          onClose={() => setChatProjectModalOpen(false)}
          chatId={id}
          projectId={chat?.projectId}
          projectName={chat?.projectName}
          onSuccess={fetchChat}
        />

        <ChatRenameModal
          isOpen={renameModalOpen}
          onClose={() => setRenameModalOpen(false)}
          chatId={id}
          currentTitle={chat?.title || ''}
          isManuallyRenamed={chat?.isManuallyRenamed ?? false}
          onSuccess={(newTitle, isManuallyRenamed) => {
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
          imageProfileId={chat?.imageProfileId || undefined}
          onImagesGenerated={(images, prompt) => {
            fetch(`/api/v1/chats/${id}?action=add-tool-result`, {
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
              .catch((err) => console.error('Failed to save tool result:', err instanceof Error ? err.message : String(err)))

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
          onComplete={(result: SearchReplaceResult) => {
            // Refresh chat data if any messages were updated
            if (result.messagesUpdated > 0) {
              fetchChat()
            }
          }}
        />

        {/* Bulk Character Replace Modal */}
        {chat && (
          <BulkCharacterReplaceModal
            isOpen={bulkReplaceModalOpen}
            onClose={() => setBulkReplaceModalOpen(false)}
            chatId={id}
            participants={chat.participants}
            messages={messages}
            onSuccess={fetchChat}
          />
        )}

        {/* Tool Settings Modal */}
        {chat && (
          <ChatToolSettingsModal
            isOpen={toolSettingsModalOpen}
            onClose={() => setToolSettingsModalOpen(false)}
            chatId={id}
            disabledTools={chat.disabledTools || []}
            disabledToolGroups={chat.disabledToolGroups || []}
            onSuccess={(newDisabledTools, newDisabledToolGroups) => {
              // Update local chat state with new disabled tools and groups
              setChat(prev => prev ? {
                ...prev,
                disabledTools: newDisabledTools,
                disabledToolGroups: newDisabledToolGroups,
              } : prev)
            }}
          />
        )}

        {/* State Editor Modal */}
        {chat && (
          <StateEditorModal
            isOpen={stateEditorModalOpen}
            onClose={() => setStateEditorModalOpen(false)}
            entityType="chat"
            entityId={id}
            entityName={chat.title}
          />
        )}

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

        {/* File Write Approval Modal */}
        {fileWriteApprovalState && (
          <FileWriteApprovalModal
            isOpen={fileWriteApprovalState.isOpen}
            onClose={() => setFileWriteApprovalState(null)}
            request={{
              filename: fileWriteApprovalState.pendingWrite.filename,
              content: fileWriteApprovalState.pendingWrite.content || '',
              mimeType: fileWriteApprovalState.pendingWrite.mimeType || 'text/plain',
              folderPath: fileWriteApprovalState.pendingWrite.folderPath,
              projectId: fileWriteApprovalState.pendingWrite.projectId,
              projectName: fileWriteApprovalState.projectName,
            }}
            chatId={id}
            onApprove={async () => {
              // Store participant ID before clearing state
              const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
              setFileWriteApprovalState(null)
              // Refresh chat to show any new files/messages
              await fetchChat()
              // Trigger the LLM to continue and respond to the tool result
              if (participantToTrigger) {
                setTimeout(() => {
                  triggerContinueMode(participantToTrigger)
                }, 500)
              }
            }}
            onDeny={async () => {
              // Store participant ID before clearing state
              const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
              setFileWriteApprovalState(null)
              showInfoToast('File write denied.')
              // Refresh chat to show the denial tool message
              await fetchChat()
              // Trigger the LLM to continue and acknowledge the denial
              if (participantToTrigger) {
                setTimeout(() => {
                  triggerContinueMode(participantToTrigger)
                }, 500)
              }
            }}
          />
        )}

        {/* File Conflict Dialog for duplicate detection */}
        <FileConflictDialog
          isOpen={isConflictDialogOpen}
          onClose={cancelConflict}
          conflict={conflictInfo}
          onResolve={handleConflictResolution}
          resolving={resolvingConflict}
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

        {/* LLM Log Viewer Modal */}
        <LLMLogViewerModal
          isOpen={llmLogViewerOpen}
          onClose={() => {
            setLLMLogViewerOpen(false)
            setLLMLogsForViewer([])
            setSelectedMessageIdForLogs(null)
          }}
          logs={llmLogsForViewer}
          messageId={selectedMessageIdForLogs ?? undefined}
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
          waitingForResponse={waitingForResponse}
          isPaused={isPaused}
          onTogglePause={togglePause}
          onNudge={turnManagement.handleNudge}
          onQueue={turnManagement.handleQueue}
          onDequeue={turnManagement.handleDequeue}
          onSkip={turnManagement.handleContinue}
          onStopStreaming={stopStreaming}
          onTalkativenessChange={(pId, value) => {
          }}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
          impersonatingParticipantIds={impersonatingParticipantIds}
          activeTypingParticipantId={activeTypingParticipantId}
          onImpersonate={handleStartImpersonation}
          onStopImpersonate={handleStopImpersonation}
          connectionProfiles={connectionProfiles}
          onConnectionProfileChange={handleConnectionProfileChange}
          onParticipantSettingsChange={handleParticipantSettingsChange}
        />
      )}
    </div>
  )
}
