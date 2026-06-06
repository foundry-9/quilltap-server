'use client'

/**
 * ChatSidebar
 *
 * Right-side panel for the Salon chat page. Replaces the previous
 * ParticipantSidebar (cast-only) and absorbs every control that used to live
 * in the ToolPalette popover and the ChatSettingsModal. Single-open accordion:
 * Participants, Chat, Visibility, Organize, Edit Content.
 *
 * Collapsed mode is unchanged from ParticipantSidebar — a narrow strip with
 * mini avatars that still surfaces the turn order at a glance.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { ParticipantCard, type ParticipantData, type ConnectionProfileOption } from './ParticipantCard'
import { Avatar } from '@/components/ui/Avatar'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { getConciergeState, isChatActiveDangerous, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import { getQueuePosition, computePredictedTurnOrder } from '@/lib/chat/turn-manager'
import type { TurnOrderEntry, TurnOrderStatus } from '@/lib/chat/turn-manager'

const STORAGE_KEY = 'quilltap.chat-sidebar.collapsed'
const WIDTH_STORAGE_KEY = 'quilltap.chat-sidebar.width'

/** Expanded-sidebar width bounds (px). Default mirrors --qt-chat-sidebar-width: 18rem. */
const DEFAULT_WIDTH = 288
const MIN_WIDTH = 240
const MAX_WIDTH = 560
/** Keep at least this much room for the chat pane when dragging. */
const MIN_CHAT_WIDTH = 360
/** Keyboard nudge step (px). */
const WIDTH_KEY_STEP = 16

type SectionId = 'participants' | 'chat' | 'visibility' | 'organize' | 'edit' | null

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  modelName: string
}

interface ApiKey {
  id: string
  label: string
  provider: string
}

function getInitialCollapsedState(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored !== null ? stored === 'true' : true
}

/** Upper bound for the sidebar width given the current viewport (leaves room for chat). */
function maxWidthForViewport(): number {
  if (typeof window === 'undefined') return MAX_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - MIN_CHAT_WIDTH))
}

function clampWidth(value: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidthForViewport(), value)))
}

function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = localStorage.getItem(WIDTH_STORAGE_KEY)
  const parsed = stored !== null ? parseInt(stored, 10) : NaN
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH
}

export interface ChatSidebarProps {
  // --- Participants section ---
  participants: ParticipantData[]
  turnState: TurnState
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  userParticipantId: string | null
  respondingParticipantId?: string | null
  waitingForResponse?: boolean
  isPaused?: boolean
  onTogglePause?: () => void
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onSkip?: () => void
  onTalkativenessChange?: (participantId: string, value: number) => void
  onAddCharacter?: () => void
  onRemoveCharacter?: (participantId: string) => void
  onStopStreaming?: () => void
  onWhisper?: (participantId: string) => void
  impersonatingParticipantIds?: string[]
  activeTypingParticipantId?: string | null
  onImpersonate?: (participantId: string) => void
  onStopImpersonate?: (participantId: string) => void
  connectionProfiles?: ConnectionProfileOption[]
  onConnectionProfileChange?: (participantId: string, profileId: string | null, controlledBy: 'llm' | 'user') => void
  onSystemPromptChange?: (participantId: string, promptId: string | null) => void
  onRebuildSystemPrompt?: (participantId: string) => void
  onParticipantSettingsChange?: (participantId: string, updates: { isActive?: boolean; status?: 'active' | 'silent' | 'absent' | 'removed' }) => void
  chatId: string
  onRegenerateAvatar?: (participantId: string) => void
  isDangerousChat?: boolean

  // --- Chat section ---
  agentModeEnabled?: boolean | null
  onAgentModeToggle?: () => void
  roleplayTemplateId?: string | null
  /** Fired after any chat-record field is mutated from the sidebar (typically fetchChat). */
  onChatUpdated?: () => void
  projectName?: string | null
  onProjectClick?: () => void
  imageProfileId?: string | null
  alertCharactersOfLanternImages?: boolean | null
  avatarGenerationEnabled?: boolean | null
  /** Per-chat Concierge override ('OFF' = off-duty, null = follow global). */
  conciergeOverride?: 'OFF' | null
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  storyBackgroundsEnabled?: boolean
  onRegenerateBackgroundClick?: () => void

  // --- Visibility section ---
  isMultiChar?: boolean
  showAllWhispers?: boolean
  onToggleAllWhispers?: () => void
  allowCrossCharacterVaultReads?: boolean
  onToggleCrossCharacterVaultReads?: () => void
  // Aurora's Core whisper — per-chat overrides (tri-state). null = inherit.
  coreWhisperEnabled?: boolean | null
  onSetCoreWhisperEnabled?: (value: boolean | null) => void
  coreWhisperInterval?: number | null
  onSetCoreWhisperInterval?: (value: number | null) => void
  // Thinking visibility — per-chat override (tri-state). null = inherit global. DISPLAY ONLY.
  showThinking?: boolean | null
  onSetShowThinking?: (value: boolean | null) => void

  // --- Organize section ---
  onRenameClick?: () => void
  onStateClick?: () => void
  onContinueChatClick?: () => void
  chatPhotoCount?: number
  onGalleryClick?: () => void
  /** True when this chat is an autonomous room ("enclave") — gates the Edit Enclave control. */
  isAutonomousRoom?: boolean
  onEditEnclaveClick?: () => void

  // --- Edit Content section ---
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onReextractMemoriesClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  chatMemoryCount?: number

  className?: string
}

export function ChatSidebar(props: ChatSidebarProps) {
  const {
    participants,
    turnState,
    turnSelectionResult,
    isGenerating,
    userParticipantId,
    respondingParticipantId,
    waitingForResponse: _waitingForResponse,
    isPaused = false,
    onTogglePause,
    className = '',
  } = props

  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsedState)
  const [openSection, setOpenSection] = useState<SectionId>('participants')

  // Resizable width (px), persisted to localStorage. Applies to the expanded
  // panel only; the collapsed strip keeps its own fixed width.
  const [width, setWidth] = useState(getInitialWidth)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const persistWidth = useCallback((next: number) => {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next))
  }, [])

  // Drag-to-resize from the inner (left) edge. Mirrors SplitLayout.handleMouseDown:
  // capture the panel's right edge, then track the cursor against it. Dragging
  // left (toward the chat) widens the sidebar.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rightEdge = sidebarRef.current?.getBoundingClientRect().right ?? null
    if (rightEdge === null) return

    setIsResizing(true)
    let latest = width

    const onMouseMove = (moveEvent: MouseEvent) => {
      latest = clampWidth(rightEdge - moveEvent.clientX)
      setWidth(latest)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsResizing(false)
      persistWidth(latest)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, persistWidth])

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    switch (event.key) {
      case 'ArrowLeft': next = width + WIDTH_KEY_STEP; break   // widen
      case 'ArrowRight': next = width - WIDTH_KEY_STEP; break  // narrow
      case 'Home': next = MIN_WIDTH; break
      case 'End': next = maxWidthForViewport(); break
      default: return
    }
    event.preventDefault()
    const clamped = clampWidth(next)
    setWidth(clamped)
    persistWidth(clamped)
  }, [width, persistWidth])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem(STORAGE_KEY, String(newValue))
      return newValue
    })
  }, [])

  const expandSidebar = useCallback(() => {
    setIsCollapsed(false)
    localStorage.setItem(STORAGE_KEY, 'false')
  }, [])

  const turnOrderEntries = useMemo(() => {
    return computePredictedTurnOrder({
      participants,
      turnState,
      turnSelectionResult,
      isGenerating,
      respondingParticipantId,
      userParticipantId,
    })
  }, [participants, turnState, turnSelectionResult, isGenerating, respondingParticipantId, userParticipantId])

  const turnOrderMap = useMemo(() => {
    const map = new Map<string, TurnOrderEntry>()
    for (const entry of turnOrderEntries) {
      map.set(entry.participantId, entry)
    }
    return map
  }, [turnOrderEntries])

  const sortedParticipants = useMemo(() => {
    const orderIndex = new Map<string, number>()
    turnOrderEntries.forEach((entry, index) => {
      orderIndex.set(entry.participantId, index)
    })
    return [...participants].sort((a, b) => {
      const aIdx = orderIndex.get(a.id) ?? 999
      const bIdx = orderIndex.get(b.id) ?? 999
      return aIdx - bIdx
    })
  }, [participants, turnOrderEntries])

  const currentSpeakerId = useMemo(() => {
    if (isGenerating) {
      if (respondingParticipantId) return respondingParticipantId
      if (turnState.lastSpeakerId) return turnState.lastSpeakerId
    }
    return turnSelectionResult?.nextSpeakerId ?? null
  }, [isGenerating, respondingParticipantId, turnState.lastSpeakerId, turnSelectionResult?.nextSpeakerId])

  const activeCharacterCount = useMemo(() => {
    return participants.filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user' && p.id !== userParticipantId).length
  }, [participants, userParticipantId])

  const baseClasses: string[] = []
  if (className) baseClasses.push(className)

  if (isCollapsed) {
    return (
      <CollapsedStrip
        baseClasses={baseClasses}
        sortedParticipants={sortedParticipants}
        turnOrderMap={turnOrderMap}
        currentSpeakerId={currentSpeakerId}
        userParticipantId={userParticipantId}
        turnSelectionResult={turnSelectionResult}
        isGenerating={isGenerating}
        isPaused={isPaused}
        onTogglePause={onTogglePause}
        toggleCollapsed={toggleCollapsed}
        expandSidebar={expandSidebar}
      />
    )
  }

  const openController = (id: Exclude<SectionId, null>) => ({
    isOpen: openSection === id,
    onOpenChange: (next: boolean) => setOpenSection(next ? id : null),
  })

  return (
    <div
      ref={sidebarRef}
      className={['qt-chat-sidebar', ...baseClasses].join(' ')}
      style={{ width }}
    >
      <div
        className={`qt-chat-sidebar-resizer ${isResizing ? 'qt-chat-sidebar-resizer-active' : ''}`}
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize"
      >
        <div className="qt-chat-sidebar-resizer-grip">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="qt-chat-sidebar-header">
        <div className="flex items-center justify-between">
          <h3 className="qt-chat-sidebar-heading">Chat</h3>
          <button
            onClick={toggleCollapsed}
            className="qt-chat-sidebar-toggle"
            title="Collapse chat sidebar"
            aria-label="Collapse chat sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="qt-chat-sidebar-list">
        <CollapsibleCard
          title="Participants"
          description={`${activeCharacterCount} character${activeCharacterCount !== 1 ? 's' : ''}`}
          {...openController('participants')}
        >
          <ParticipantsSection
            {...props}
            sortedParticipants={sortedParticipants}
            turnOrderMap={turnOrderMap}
            currentSpeakerId={currentSpeakerId}
            activeCharacterCount={activeCharacterCount}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Chat"
          {...openController('chat')}
        >
          <ChatSection
            chatId={props.chatId}
            agentModeEnabled={props.agentModeEnabled}
            onAgentModeToggle={props.onAgentModeToggle}
            roleplayTemplateId={props.roleplayTemplateId}
            onChatUpdated={props.onChatUpdated}
            projectName={props.projectName}
            onProjectClick={props.onProjectClick}
            imageProfileId={props.imageProfileId}
            alertCharactersOfLanternImages={props.alertCharactersOfLanternImages}
            avatarGenerationEnabled={props.avatarGenerationEnabled}
            isDangerousChat={props.isDangerousChat}
            conciergeOverride={props.conciergeOverride}
            onToolSettingsClick={props.onToolSettingsClick}
            onRunToolClick={props.onRunToolClick}
            storyBackgroundsEnabled={props.storyBackgroundsEnabled}
            onRegenerateBackgroundClick={props.onRegenerateBackgroundClick}
            sectionOpen={openSection === 'chat'}
          />
        </CollapsibleCard>

        {(props.isMultiChar || props.onSetCoreWhisperEnabled || props.onSetCoreWhisperInterval || props.onSetShowThinking) && (
          <CollapsibleCard
            title="Visibility"
            {...openController('visibility')}
          >
            <VisibilitySection
              showAllWhispers={props.showAllWhispers}
              onToggleAllWhispers={props.onToggleAllWhispers}
              allowCrossCharacterVaultReads={props.allowCrossCharacterVaultReads}
              onToggleCrossCharacterVaultReads={props.onToggleCrossCharacterVaultReads}
              coreWhisperEnabled={props.coreWhisperEnabled}
              onSetCoreWhisperEnabled={props.onSetCoreWhisperEnabled}
              coreWhisperInterval={props.coreWhisperInterval}
              onSetCoreWhisperInterval={props.onSetCoreWhisperInterval}
              showThinking={props.showThinking}
              onSetShowThinking={props.onSetShowThinking}
            />
          </CollapsibleCard>
        )}

        <CollapsibleCard
          title="Organize"
          {...openController('organize')}
        >
          <OrganizeSection
            chatId={props.chatId}
            onRenameClick={props.onRenameClick}
            onStateClick={props.onStateClick}
            onContinueChatClick={props.onContinueChatClick}
            chatPhotoCount={props.chatPhotoCount}
            onGalleryClick={props.onGalleryClick}
            isAutonomousRoom={props.isAutonomousRoom}
            onEditEnclaveClick={props.onEditEnclaveClick}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Edit Content"
          {...openController('edit')}
        >
          <EditContentSection
            onSearchReplaceClick={props.onSearchReplaceClick}
            onBulkCharacterReplaceClick={props.onBulkCharacterReplaceClick}
            onReextractMemoriesClick={props.onReextractMemoriesClick}
            onDeleteChatMemoriesClick={props.onDeleteChatMemoriesClick}
            chatMemoryCount={props.chatMemoryCount}
          />
        </CollapsibleCard>
      </div>

      {turnSelectionResult?.debug && (
        <div className="qt-chat-sidebar-debug">
          <details>
            <summary className="cursor-pointer hover:text-foreground">Turn Debug Info</summary>
            <div className="mt-2 space-y-1">
              <div>Reason: {turnSelectionResult.reason}</div>
              <div>Cycle Complete: {turnSelectionResult.cycleComplete ? 'Yes' : 'No'}</div>
              {turnSelectionResult.debug.eligibleSpeakers.length > 0 && (
                <div>Eligible: {turnSelectionResult.debug.eligibleSpeakers.length}</div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

export default ChatSidebar

// =================================================================
// Collapsed strip (mini avatars) — unchanged from ParticipantSidebar
// =================================================================

interface CollapsedStripProps {
  baseClasses: string[]
  sortedParticipants: ParticipantData[]
  turnOrderMap: Map<string, TurnOrderEntry>
  currentSpeakerId: string | null
  userParticipantId: string | null
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  isPaused: boolean
  onTogglePause?: () => void
  toggleCollapsed: () => void
  expandSidebar: () => void
}

function CollapsedStrip({
  baseClasses,
  sortedParticipants,
  turnOrderMap,
  currentSpeakerId,
  userParticipantId,
  turnSelectionResult,
  isGenerating,
  isPaused,
  onTogglePause,
  toggleCollapsed,
  expandSidebar,
}: CollapsedStripProps) {
  return (
    <div className={['qt-chat-sidebar-collapsed', ...baseClasses].join(' ')}>
      <button
        onClick={toggleCollapsed}
        className="qt-chat-sidebar-toggle"
        title="Expand chat sidebar"
        aria-label="Expand chat sidebar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {onTogglePause && (
        <button
          onClick={onTogglePause}
          className={`qt-chat-sidebar-collapsed-pause ${isPaused ? 'qt-chat-sidebar-collapsed-pause-paused' : ''}`}
          title={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
          aria-label={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
        >
          {isPaused ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          )}
        </button>
      )}

      <div className="qt-chat-sidebar-collapsed-avatars">
        {sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === userParticipantId
          const turnEntry = turnOrderMap.get(participant.id)
          const isInactive = turnEntry?.status === 'inactive'
          const isUserTurn = turnSelectionResult?.nextSpeakerId === null && !isGenerating
          const isCurrentTurn = currentSpeakerId === participant.id || (isUserParticipant && isUserTurn)
          const isActivelyGenerating = currentSpeakerId === participant.id && isGenerating

          const name = participant.character?.name || 'Unknown'
          const avatarUrl = participant.character?.avatarUrl || null
          const defaultImage = participant.character?.defaultImage || null

          const positionBadgeClass = turnEntry ? getCollapsedPositionBadgeClass(turnEntry.status) : ''
          const participantStatus = (participant as ParticipantData & { status?: string }).status || 'active'

          const avatarClasses = ['qt-chat-sidebar-collapsed-avatar']
          if (isInactive) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-inactive')
          } else if (isCurrentTurn || isActivelyGenerating) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-active')
          }
          if (isActivelyGenerating) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-streaming')
          }

          const statusLabel = participantStatus !== 'active' ? ` [${participantStatus}]` : ''

          return (
            <button
              key={participant.id}
              onClick={expandSidebar}
              className={avatarClasses.join(' ')}
              title={`${name}${statusLabel}${isCurrentTurn ? ' (current turn)' : ''}${turnEntry?.position ? ` (#${turnEntry.position})` : ''}`}
              aria-label={`${name}${statusLabel} - click to expand sidebar`}
            >
              <div className="relative">
                <Avatar
                  name={name}
                  src={avatarUrl ? { avatarUrl } : defaultImage ? { defaultImage } : undefined}
                  size="sm"
                />
                {participantStatus === 'silent' && (
                  <div className="qt-participant-status-overlay qt-participant-status-overlay-silent">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  </div>
                )}
                {participantStatus === 'absent' && (
                  <div className="qt-participant-status-overlay qt-participant-status-overlay-absent">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                    </svg>
                  </div>
                )}
              </div>
              {turnEntry && turnEntry.position != null && turnEntry.position > 0 && (
                <span className={`qt-chat-sidebar-collapsed-position-badge ${positionBadgeClass}`}>
                  {turnEntry.position}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =================================================================
// Participants section
// =================================================================

interface ParticipantsSectionProps extends ChatSidebarProps {
  sortedParticipants: ParticipantData[]
  turnOrderMap: Map<string, TurnOrderEntry>
  currentSpeakerId: string | null
  activeCharacterCount: number
}

function ParticipantsSection(p: ParticipantsSectionProps) {
  const activeParticipantCount = useMemo(() => {
    return p.participants.filter(part => part.isActive).length
  }, [p.participants])

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-participants">
      {p.turnSelectionResult && (
        <div className="qt-chat-sidebar-meta">
          {p.activeCharacterCount === 0 ? (
            <span style={{ color: 'var(--qt-status-warning-fg)' }}>No characters available</span>
          ) : p.turnSelectionResult.nextSpeakerId === null ? (
            p.turnSelectionResult.cycleComplete ? (
              <span style={{ color: 'var(--qt-status-success-fg)' }}>All characters have spoken - your turn</span>
            ) : (
              <span style={{ color: 'var(--qt-status-success-fg)' }}>Your turn to speak</span>
            )
          ) : p.isGenerating ? (
            <span style={{ color: 'var(--qt-status-info-fg)' }}>Generating response...</span>
          ) : (
            <span>Waiting for next turn...</span>
          )}
        </div>
      )}

      {p.turnState.queue.length > 0 && (
        <div className="mt-1 qt-chat-sidebar-meta qt-chat-sidebar-queue">
          {p.turnState.queue.length} in queue
        </div>
      )}

      {p.onTogglePause && (
        <button
          onClick={p.onTogglePause}
          className={`qt-chat-pause-button mt-3 ${p.isPaused ? 'qt-chat-pause-button-paused' : ''}`}
          title={p.isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
        >
          {p.isPaused ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Resume</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
              <span>Pause</span>
            </>
          )}
        </button>
      )}

      <div className="qt-chat-sidebar-cards mt-3">
        {p.sortedParticipants.length === 0 && (
          <div className="qt-empty-state py-8">
            <svg className="qt-empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="qt-empty-state-title">No participants</p>
            <p className="qt-empty-state-description">Add a character to get started</p>
          </div>
        )}
        {p.sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === p.userParticipantId
          const isCurrentTurn = p.currentSpeakerId === participant.id
          const queuePos = getQueuePosition(p.turnState, participant.id)
          const canSkip = p.turnSelectionResult?.nextSpeakerId === null && !p.isGenerating
          const isImpersonating = (p.impersonatingParticipantIds ?? []).includes(participant.id)
          const isActiveTyping = p.activeTypingParticipantId === participant.id
          const canRemove = p.activeCharacterCount > 1
          const turnEntry = p.turnOrderMap.get(participant.id)

          return (
            <ParticipantCard
              key={participant.id}
              participant={participant}
              isCurrentTurn={isCurrentTurn}
              queuePosition={queuePos}
              isGenerating={p.isGenerating && isCurrentTurn}
              isUserParticipant={isUserParticipant}
              turnPosition={turnEntry?.position ?? null}
              turnStatus={turnEntry?.status}
              onStopStreaming={turnEntry?.status === 'generating' ? p.onStopStreaming : undefined}
              onNudge={p.onNudge}
              onQueue={p.onQueue}
              onDequeue={p.onDequeue}
              onSkip={isUserParticipant ? p.onSkip : undefined}
              onTalkativenessChange={p.onTalkativenessChange}
              onRemove={p.onRemoveCharacter}
              canRemove={canRemove}
              canSkip={canSkip}
              isImpersonating={isImpersonating}
              isActiveTyping={isActiveTyping}
              onImpersonate={p.onImpersonate}
              onStopImpersonate={p.onStopImpersonate}
              connectionProfiles={p.connectionProfiles}
              onConnectionProfileChange={p.onConnectionProfileChange}
              onSystemPromptChange={p.onSystemPromptChange}
              onRebuildSystemPrompt={p.onRebuildSystemPrompt}
              onActiveChange={p.onParticipantSettingsChange
                ? (pId, active) => p.onParticipantSettingsChange!(pId, { isActive: active })
                : undefined}
              onStatusChange={p.onParticipantSettingsChange
                ? (pId, status) => p.onParticipantSettingsChange!(pId, { status, isActive: status === 'active' || status === 'silent' })
                : undefined}
              onWhisper={activeParticipantCount >= 3 ? p.onWhisper : undefined}
              chatId={p.chatId}
              onRegenerateAvatar={p.onRegenerateAvatar}
              isDangerousChat={isChatActiveDangerous({ isDangerousChat: p.isDangerousChat, conciergeOverride: p.conciergeOverride })}
            />
          )
        })}
      </div>

      {p.onAddCharacter && (
        <div className="qt-chat-sidebar-add mt-3">
          <button
            onClick={p.onAddCharacter}
            className="w-full py-2 px-4 text-sm font-medium rounded-lg border border-dashed qt-border-default qt-text-secondary hover:qt-bg-surface-alt hover:qt-text transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Character
          </button>
        </div>
      )}
    </div>
  )
}

// =================================================================
// Chat section
// =================================================================

interface ChatSectionProps {
  chatId: string
  agentModeEnabled?: boolean | null
  onAgentModeToggle?: () => void
  roleplayTemplateId?: string | null
  onChatUpdated?: () => void
  projectName?: string | null
  onProjectClick?: () => void
  imageProfileId?: string | null
  alertCharactersOfLanternImages?: boolean | null
  avatarGenerationEnabled?: boolean | null
  isDangerousChat?: boolean
  conciergeOverride?: 'OFF' | null
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  storyBackgroundsEnabled?: boolean
  onRegenerateBackgroundClick?: () => void
  sectionOpen: boolean
}

function ChatSection({
  chatId,
  agentModeEnabled,
  onAgentModeToggle,
  roleplayTemplateId,
  onChatUpdated,
  projectName,
  onProjectClick,
  imageProfileId,
  alertCharactersOfLanternImages,
  avatarGenerationEnabled,
  isDangerousChat,
  conciergeOverride,
  onToolSettingsClick,
  onRunToolClick,
  storyBackgroundsEnabled,
  onRegenerateBackgroundClick,
  sectionOpen,
}: ChatSectionProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(roleplayTemplateId ?? null)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [imageProfileSaving, setImageProfileSaving] = useState(false)
  const [alertImagesSaving, setAlertImagesSaving] = useState(false)
  const [avatarGenSaving, setAvatarGenSaving] = useState(false)
  const [conciergeSaving, setConciergeSaving] = useState(false)

  // Sync from props when chat record changes upstream
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream prop changes
    setSelectedTemplateId(roleplayTemplateId ?? null)
  }, [roleplayTemplateId])

  // Fetch reference data only after the section is opened the first time —
  // avoids hitting the API for users who never expand this accordion.
  const [hasEverOpened, setHasEverOpened] = useState(false)
  useEffect(() => {
    if (sectionOpen && !hasEverOpened) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch for lazy data fetch
      setHasEverOpened(true)
    }
  }, [sectionOpen, hasEverOpened])

  const { data: templatesData } = useSWR<RoleplayTemplate[]>(
    hasEverOpened ? '/api/v1/roleplay-templates' : null
  )
  const { data: imageProfilesData } = useSWR<{ profiles: ImageProfile[] }>(
    hasEverOpened ? '/api/v1/image-profiles' : null
  )
  const { data: apiKeysData } = useSWR<{ apiKeys: ApiKey[] }>(
    hasEverOpened ? '/api/v1/api-keys' : null
  )

  const roleplayTemplates = templatesData ?? []
  const imageProfiles = imageProfilesData?.profiles ?? []
  const apiKeys = apiKeysData?.apiKeys ?? []

  const handleRoleplayTemplateChange = async (templateId: string | null) => {
    try {
      setTemplateSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleplayTemplateId: templateId }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      setSelectedTemplateId(templateId)
      showSuccessToast('Roleplay template updated')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update roleplay template')
    } finally {
      setTemplateSaving(false)
    }
  }

  const handleImageProfileChange = async (profileId: string | null) => {
    try {
      setImageProfileSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageProfileId: profileId }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast('Image profile updated')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update image profile')
    } finally {
      setImageProfileSaving(false)
    }
  }

  const handleAlertImagesChange = async (value: boolean | null) => {
    try {
      setAlertImagesSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertCharactersOfLanternImages: value }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast(
        value === null
          ? 'Lantern announcements will inherit from the project'
          : value
            ? 'Lantern images will be announced to characters'
            : 'Lantern images will stay silent for this chat'
      )
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update Lantern image announcements')
    } finally {
      setAlertImagesSaving(false)
    }
  }

  const handleConciergeStateChange = async (next: ConciergeState) => {
    try {
      setConciergeSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conciergeState: next }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast(
        next === 'safe'
          ? 'The Concierge is on watch'
          : next === 'flagged'
            ? 'Marked as flagged'
            : 'The Concierge is off-duty'
      )
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to change the Concierge state')
    } finally {
      setConciergeSaving(false)
    }
  }

  const handleAvatarGenToggle = async () => {
    try {
      setAvatarGenSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}?action=toggle-avatar-generation`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      showSuccessToast(data.avatarGenerationEnabled ? 'Avatar generation enabled' : 'Avatar generation disabled')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to toggle avatar generation')
    } finally {
      setAvatarGenSaving(false)
    }
  }

  const alertSelectValue = alertCharactersOfLanternImages === null || alertCharactersOfLanternImages === undefined
    ? 'inherit'
    : alertCharactersOfLanternImages ? 'enabled' : 'disabled'

  const conciergeState = getConciergeState({ isDangerousChat, conciergeOverride })
  const conciergeHelperText =
    conciergeState === 'off'
      ? "Off-duty gives the Concierge the afternoon off. Censored providers may refuse the conversation, and image prompts go out unaltered — the risk is yours."
      : conciergeState === 'flagged'
        ? 'Flagged routes this chat through the Concierge\'s uncensored providers.'
        : 'Safe lets the Concierge keep watch; he\'ll flip the switch if the conversation calls for it.'

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-chat flex flex-col gap-3">
      {/* The Concierge — per-chat tri-state */}
      <label className="qt-label">
        <span className="block mb-1">The Concierge</span>
        <select
          value={conciergeState}
          onChange={(e) => handleConciergeStateChange(e.target.value as ConciergeState)}
          disabled={conciergeSaving}
          className="qt-select text-sm"
        >
          <option value="safe">Safe</option>
          <option value="flagged">Flagged</option>
          <option value="off">Off-duty</option>
        </select>
        <span className="block mt-1 qt-text-secondary text-xs">{conciergeHelperText}</span>
      </label>

      {/* Agent Mode */}
      {onAgentModeToggle && (
        <button
          type="button"
          onClick={onAgentModeToggle}
          className={`qt-tool-palette-badge ${agentModeEnabled ? 'qt-tool-palette-badge-on' : 'qt-tool-palette-badge-off'}`}
          title={agentModeEnabled ? 'Disable agent mode' : 'Enable agent mode'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span>{agentModeEnabled ? 'Agent On' : 'Agent Off'}</span>
        </button>
      )}

      {/* Roleplay Template */}
      <label className="qt-label">
        <span className="block mb-1">Roleplay Template</span>
        <select
          value={selectedTemplateId || ''}
          onChange={(e) => handleRoleplayTemplateChange(e.target.value || null)}
          disabled={templateSaving}
          className="qt-select text-sm"
        >
          <option value="">No Template</option>
          {roleplayTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Project */}
      {onProjectClick && (
        <button
          type="button"
          onClick={onProjectClick}
          className="qt-tool-palette-button"
          title={projectName ? `In project: ${projectName}` : 'Assign to project'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span>{projectName ? `Project: ${projectName}` : 'Project'}</span>
        </button>
      )}

      {/* Image Provider */}
      <label className="qt-label">
        <span className="block mb-1">Image Provider</span>
        <select
          value={imageProfileId || ''}
          onChange={(e) => handleImageProfileChange(e.target.value || null)}
          disabled={imageProfileSaving}
          className="qt-select text-sm"
        >
          <option value="">None (image generation disabled)</option>
          {imageProfiles.map((profile) => {
            const hasKey = apiKeys.some(key => key.id === profile.apiKeyId)
            return (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.provider}){!hasKey && profile.apiKeyId ? ' ⚠️ No API Key' : ''}
              </option>
            )
          })}
        </select>
      </label>

      {/* Announce Generated Images */}
      <label className="qt-label">
        <span className="block mb-1">Announce Generated Images</span>
        <select
          value={alertSelectValue}
          onChange={(e) => {
            const v = e.target.value
            handleAlertImagesChange(v === 'inherit' ? null : v === 'enabled')
          }}
          disabled={alertImagesSaving}
          className="qt-select text-sm"
        >
          <option value="inherit">Inherit from project</option>
          <option value="enabled">Announce to characters</option>
          <option value="disabled">Keep silent</option>
        </select>
      </label>

      {/* Auto-generate Character Avatars */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!avatarGenerationEnabled}
          onChange={handleAvatarGenToggle}
          disabled={avatarGenSaving}
          className="qt-checkbox"
        />
        <span className="qt-label">Auto-generate character avatars</span>
      </label>

      {/* Tools (settings modal) */}
      {onToolSettingsClick && (
        <button
          type="button"
          onClick={onToolSettingsClick}
          className="qt-tool-palette-button"
          title="Configure LLM tools"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Tools…</span>
        </button>
      )}

      {/* Run Tool */}
      {onRunToolClick && (
        <button
          type="button"
          onClick={onRunToolClick}
          className="qt-tool-palette-button"
          title="Run a tool manually"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
          </svg>
          <span>Run Tool…</span>
        </button>
      )}

      {/* Regenerate Story Background */}
      {storyBackgroundsEnabled && onRegenerateBackgroundClick && (
        <button
          type="button"
          onClick={onRegenerateBackgroundClick}
          className="qt-tool-palette-button"
          title="Regenerate story background image"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Regenerate Background</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Visibility section
// =================================================================

interface VisibilitySectionProps {
  showAllWhispers?: boolean
  onToggleAllWhispers?: () => void
  allowCrossCharacterVaultReads?: boolean
  onToggleCrossCharacterVaultReads?: () => void
  coreWhisperEnabled?: boolean | null
  onSetCoreWhisperEnabled?: (value: boolean | null) => void
  coreWhisperInterval?: number | null
  onSetCoreWhisperInterval?: (value: number | null) => void
  showThinking?: boolean | null
  onSetShowThinking?: (value: boolean | null) => void
}

const CORE_WHISPER_INTERVAL_OPTIONS = [
  { value: '', label: 'Inherit' },
  { value: '3', label: '3 turns' },
  { value: '6', label: '6 turns' },
  { value: '9', label: '9 turns' },
  { value: '12', label: '12 turns' },
  { value: '15', label: '15 turns' },
  { value: '20', label: '20 turns' },
  { value: '25', label: '25 turns' },
  { value: '30', label: '30 turns' },
  { value: '40', label: '40 turns' },
  { value: '50', label: '50 turns' },
] as const

function VisibilitySection({
  showAllWhispers,
  onToggleAllWhispers,
  allowCrossCharacterVaultReads,
  onToggleCrossCharacterVaultReads,
  coreWhisperEnabled,
  onSetCoreWhisperEnabled,
  coreWhisperInterval,
  onSetCoreWhisperInterval,
  showThinking,
  onSetShowThinking,
}: VisibilitySectionProps) {
  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-visibility flex flex-col gap-3">
      {onToggleAllWhispers && (
        <div className="flex items-center justify-between">
          <span className="qt-text-secondary text-xs">All Whispers</span>
          <button
            onClick={onToggleAllWhispers}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showAllWhispers ? 'bg-primary' : 'qt-bg-muted'
            }`}
            role="switch"
            aria-checked={!!showAllWhispers}
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

      {onToggleCrossCharacterVaultReads && (
        <div className="flex items-center justify-between">
          <span className="qt-text-secondary text-xs">Shared Vaults</span>
          <button
            onClick={onToggleCrossCharacterVaultReads}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              allowCrossCharacterVaultReads ? 'bg-primary' : 'qt-bg-muted'
            }`}
            role="switch"
            aria-checked={!!allowCrossCharacterVaultReads}
            title={
              allowCrossCharacterVaultReads
                ? 'Characters may read each other’s vaults (read-only) and the results are public to the chat. Click to lock.'
                : 'Each character’s vault is private; results from doc_* reads are whispered to the caller. Click to let them peek at each other’s dossiers.'
            }
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                allowCrossCharacterVaultReads ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      )}

      {(onSetCoreWhisperEnabled || onSetCoreWhisperInterval) && (
        <div className="flex flex-col gap-2 pt-2 border-t qt-border-default">
          <span className="qt-text-secondary text-xs">Aurora&apos;s Core Whisper</span>
          {onSetCoreWhisperEnabled && (
            <div className="flex items-center justify-between gap-2">
              <span className="qt-text-secondary text-xs">Offering</span>
              <select
                value={coreWhisperEnabled === true ? 'on' : coreWhisperEnabled === false ? 'off' : 'inherit'}
                onChange={(e) => {
                  const v = e.target.value
                  onSetCoreWhisperEnabled(v === 'on' ? true : v === 'off' ? false : null)
                }}
                className="qt-select qt-select-sm"
                title="When does Aurora offer this chat's characters their own Core/ packet? Inherit defers to per-character and global settings."
              >
                <option value="inherit">Inherit</option>
                <option value="on">Always</option>
                <option value="off">Never</option>
              </select>
            </div>
          )}
          {onSetCoreWhisperInterval && (
            <div className="flex items-center justify-between gap-2">
              <span className="qt-text-secondary text-xs">Cadence</span>
              <select
                value={coreWhisperInterval == null ? '' : String(coreWhisperInterval)}
                onChange={(e) => {
                  const raw = e.target.value
                  onSetCoreWhisperInterval(raw === '' ? null : parseInt(raw, 10))
                }}
                className="qt-select qt-select-sm"
                title="Assistant turns between periodic Core whispers in this chat. Inherit defers to the global default."
              >
                {CORE_WHISPER_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {onSetShowThinking && (
        <div className="flex flex-col gap-2 pt-2 border-t qt-border-default">
          <div className="flex items-center justify-between gap-2">
            <span className="qt-text-secondary text-xs">Thinking</span>
            <select
              value={showThinking === true ? 'on' : showThinking === false ? 'off' : 'inherit'}
              onChange={(e) => {
                const v = e.target.value
                onSetShowThinking(v === 'on' ? true : v === 'off' ? false : null)
              }}
              className="qt-select qt-select-sm"
              title="Show reasoning models' chain-of-thought in this chat. Inherit defers to the global default. Display-only — never sent to any model."
            >
              <option value="inherit">Inherit</option>
              <option value="on">Show</option>
              <option value="off">Hide</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

// =================================================================
// Organize section
// =================================================================

interface OrganizeSectionProps {
  chatId: string
  onRenameClick?: () => void
  onStateClick?: () => void
  onContinueChatClick?: () => void
  chatPhotoCount?: number
  onGalleryClick?: () => void
  isAutonomousRoom?: boolean
  onEditEnclaveClick?: () => void
}

function OrganizeSection({
  chatId,
  onRenameClick,
  onStateClick,
  onContinueChatClick,
  chatPhotoCount = 0,
  onGalleryClick,
  isAutonomousRoom = false,
  onEditEnclaveClick,
}: OrganizeSectionProps) {
  const handleExport = () => {
    window.location.href = `/api/v1/chats/${chatId}?action=export`
  }

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-organize flex flex-col gap-2">
      {isAutonomousRoom && onEditEnclaveClick && (
        <button
          type="button"
          onClick={onEditEnclaveClick}
          className="qt-tool-palette-button"
          title="Edit this enclave’s schedule, budget, and visibility"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Edit Enclave</span>
        </button>
      )}

      {onRenameClick && (
        <button
          type="button"
          onClick={onRenameClick}
          className="qt-tool-palette-button"
          title="Rename chat"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span>Rename</span>
        </button>
      )}

      {onStateClick && (
        <button
          type="button"
          onClick={onStateClick}
          className="qt-tool-palette-button"
          title="View/edit chat state"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          <span>State…</span>
        </button>
      )}

      {onContinueChatClick && (
        <button
          type="button"
          onClick={onContinueChatClick}
          className="qt-tool-palette-button"
          title="Continue this conversation in a new chat with a different scenario or project"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span>Continue Elsewhere</span>
        </button>
      )}

      <button
        type="button"
        onClick={handleExport}
        className="qt-tool-palette-button"
        title="Export chat"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span>Export</span>
      </button>

      {chatPhotoCount > 0 && onGalleryClick && (
        <button
          type="button"
          onClick={onGalleryClick}
          className="qt-tool-palette-button"
          title="View gallery"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Gallery ({chatPhotoCount})</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Edit Content section
// =================================================================

interface EditContentSectionProps {
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onReextractMemoriesClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  chatMemoryCount?: number
}

function EditContentSection({
  onSearchReplaceClick,
  onBulkCharacterReplaceClick,
  onReextractMemoriesClick,
  onDeleteChatMemoriesClick,
  chatMemoryCount = 0,
}: EditContentSectionProps) {
  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-edit flex flex-col gap-2">
      {onSearchReplaceClick && (
        <button
          type="button"
          onClick={onSearchReplaceClick}
          className="qt-tool-palette-button"
          title="Search and replace in chat"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Replace</span>
        </button>
      )}

      {onBulkCharacterReplaceClick && (
        <button
          type="button"
          onClick={onBulkCharacterReplaceClick}
          className="qt-tool-palette-button"
          title="Bulk re-attribute messages between characters"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span>Bulk Replace</span>
        </button>
      )}

      {onReextractMemoriesClick && (
        <button
          type="button"
          onClick={onReextractMemoriesClick}
          className="qt-tool-palette-button"
          title="Re-extract memories"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Re-extract Memories</span>
        </button>
      )}

      {onDeleteChatMemoriesClick && (
        <button
          type="button"
          onClick={onDeleteChatMemoriesClick}
          className="qt-tool-palette-button qt-tool-palette-button-danger"
          title="Delete chat memories"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>Delete Memories ({chatMemoryCount})</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Helpers
// =================================================================

function getCollapsedPositionBadgeClass(status: TurnOrderStatus): string {
  switch (status) {
    case 'generating': return 'qt-participant-position-generating'
    case 'next': return 'qt-participant-position-next'
    case 'queued': return 'qt-participant-position-queued'
    case 'eligible': return 'qt-participant-position-eligible'
    case 'user-turn': return 'qt-participant-position-user-turn'
    case 'spoken': return 'qt-participant-position-spoken'
    default: return ''
  }
}
