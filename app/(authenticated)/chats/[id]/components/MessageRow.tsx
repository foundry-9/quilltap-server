'use client'

import { memo } from 'react'
import Avatar, { getAvatarSrc } from '@/components/ui/Avatar'
import LazyMessageContent from '@/components/chat/LazyMessageContent'
import ToolMessage from '@/components/chat/ToolMessage'
import { formatMessageTime } from '@/lib/format-time'
import { TokenBadge } from '@/components/chat/TokenBadge'
import { DangerFlagBadge } from '@/components/chat/DangerFlagBadge'
import { DangerContentWrapper } from '@/components/chat/DangerContentWrapper'
import type { Message, TokenDisplaySettings, DangerousContentSettings, CharacterData } from '../types'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface MessageAvatarInfo {
  name: string
  title: string | null | undefined
  avatarUrl?: string
  defaultImage?: { id: string; filepath: string; url?: string } | null | undefined
}

interface MessageRowProps {
  message: Message
  messageIndex: number
  isEditing: boolean
  editContent: string
  viewSourceMessageIds: Set<string>
  swipeState: { current: number; total: number } | null
  showResendButton: boolean
  shouldShowAvatars: boolean
  messageAvatar: MessageAvatarInfo | null
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  /** Force immediate render (skip lazy loading) - use for last few messages */
  forceRender?: boolean
  isMultiChar: boolean
  participantData: ParticipantData[]
  turnState: TurnState
  streaming: boolean
  waitingForResponse: boolean
  userParticipantId: string | null
  isPaused?: boolean
  onTogglePause?: () => void
  /** Token display settings */
  tokenDisplaySettings?: TokenDisplaySettings
  /** Dangerous content display settings */
  dangerousContentSettings?: DangerousContentSettings
  /** Callback to override danger flags on a message */
  onOverrideDangerFlag?: (messageId: string) => void
  /** Whether this message has LLM logs available */
  hasLLMLogs?: boolean
  /** Callback to view LLM logs */
  onViewLLMLogs?: (messageId: string) => void
  /** Character data for tool messages */
  character?: CharacterData

  // Callbacks
  onEditStart: (message: Message) => void
  onEditSave: (messageId: string) => void
  onEditCancel: () => void
  onEditChange: (content: string) => void
  onToggleSourceView: (messageId: string) => void
  onDelete: (messageId: string) => void
  onGenerateSwipe: (messageId: string) => void
  onSwitchSwipe: (swipeGroupId: string, direction: 'prev' | 'next') => void
  onCopyContent: (content: string) => void
  onResend: (message: Message) => void
  onImageClick: (filepath: string, filename: string, fileId?: string) => void
  onHandleNudge: (participantId: string) => void
  onHandleQueue: (participantId: string) => void
  onHandleDequeue: (participantId: string) => void
  onHandleTalkativenessChange: (participantId: string, value: number) => void
  onHandleRemoveCharacter: (participantId: string) => void
  onHandleContinue: () => void
  onReattribute?: (messageId: string) => void
}

function getImageAttachments(message: Message) {
  return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
}

function MessageRowInner({
  message,
  messageIndex,
  isEditing,
  editContent,
  viewSourceMessageIds,
  swipeState,
  showResendButton,
  shouldShowAvatars,
  messageAvatar,
  renderingPatterns,
  dialogueDetection,
  forceRender = false,
  isMultiChar,
  participantData,
  turnState,
  streaming,
  waitingForResponse,
  userParticipantId,
  isPaused = false,
  onTogglePause,
  tokenDisplaySettings,
  dangerousContentSettings,
  onOverrideDangerFlag,
  hasLLMLogs,
  onViewLLMLogs,
  character,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditChange,
  onToggleSourceView,
  onDelete,
  onGenerateSwipe,
  onSwitchSwipe,
  onCopyContent,
  onResend,
  onImageClick,
  onHandleNudge,
  onHandleQueue,
  onHandleDequeue,
  onHandleTalkativenessChange,
  onHandleRemoveCharacter,
  onHandleContinue,
  onReattribute,
}: MessageRowProps) {
  const messageRowClasses = ['qt-chat-message-row']
  if (message.role === 'USER') {
    messageRowClasses.push('qt-chat-message-row-user')
  } else {
    messageRowClasses.push('qt-chat-message-row-assistant')
  }

  const hasDangerFlags = message.dangerFlags && message.dangerFlags.length > 0
  const dangerDisplayMode = hasDangerFlags && dangerousContentSettings?.displayMode
    ? dangerousContentSettings.displayMode
    : 'SHOW'
  const showDangerBadges = hasDangerFlags && dangerousContentSettings?.showWarningBadges !== false

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      key={message.id}
      className={messageRowClasses.join(' ')}
    >
      {/* Desktop avatar - assistant (left side) */}
      {message.role === 'ASSISTANT' && shouldShowAvatars && messageAvatar && (
        <div className="flex-shrink-0 qt-chat-desktop-avatar">
          <Avatar
            name={messageAvatar.name}
            title={messageAvatar.title}
            src={messageAvatar}
            size="chat"
            showName
            showTitle
            className="flex flex-col items-center w-32 gap-1"
          />
        </div>
      )}
      <div className="qt-chat-message-body group">
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
                onChange={(e) => onEditChange(e.target.value)}
                className="qt-textarea"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onEditSave(message.id)}
                  className="qt-button qt-button-primary qt-button-sm"
                >
                  Save
                </button>
                <button
                  onClick={onEditCancel}
                  className="qt-button qt-button-secondary qt-button-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Embedded tool calls - shown at top of message */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="mb-3 space-y-2">
                  {message.toolCalls.map((toolMsg) => (
                    <ToolMessage
                      key={toolMsg.id}
                      message={toolMsg}
                      character={character}
                      onImageClick={onImageClick}
                      embedded
                    />
                  ))}
                </div>
              )}
              <DangerContentWrapper displayMode={dangerDisplayMode}>
                {viewSourceMessageIds.has(message.id) ? (
                  <div className="qt-code-block whitespace-pre-wrap break-words overflow-auto max-h-96">
                    {message.content}
                  </div>
                ) : (
                  <LazyMessageContent content={message.content} renderingPatterns={renderingPatterns} dialogueDetection={dialogueDetection} forceRender={forceRender} renderedHtml={message.renderedHtml} />
                )}
              </DangerContentWrapper>
              {/* Danger flag badges */}
              {showDangerBadges && message.dangerFlags && (
                <DangerFlagBadge
                  dangerFlags={message.dangerFlags}
                  onOverride={onOverrideDangerFlag ? () => onOverrideDangerFlag(message.id) : undefined}
                />
              )}
              {/* Image attachment thumbnails */}
              {getImageAttachments(message).length > 0 && (
                <div className="qt-chat-attachment-list">
                  {getImageAttachments(message).map((attachment) => (
                    <button
                      key={attachment.id}
                      onClick={() => onImageClick(
                        attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`,
                        attachment.filename,
                        attachment.id
                      )}
                      type="button"
                      className="qt-button qt-chat-attachment-button"
                    >
                      { }
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

              {/* Action bar - shows action icons at bottom of message */}
              <div className="qt-chat-message-action-bar">
                <div className="qt-chat-message-action-bar-icons">
                  {/* Copy */}
                  <button
                    onClick={() => onCopyContent(message.content)}
                    className="qt-chat-message-action-icon"
                    title="Copy message"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  {/* View source/rendered */}
                  <button
                    onClick={() => onToggleSourceView(message.id)}
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
                      onClick={() => onEditStart(message)}
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
                    onClick={() => onDelete(message.id)}
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
                      onClick={() => onGenerateSwipe(message.id)}
                      className="qt-chat-message-action-icon"
                      title="Regenerate response"
                    >
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}
                  {/* Re-attribute (when other participants exist) */}
                  {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
                    <button
                      onClick={() => onReattribute(message.id)}
                      className="qt-chat-message-action-icon"
                      title="Re-attribute to different participant"
                    >
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    </button>
                  )}
                  {/* View LLM Logs (assistant messages with logs) */}
                  {hasLLMLogs && message.role === 'ASSISTANT' && onViewLLMLogs && (
                    <button
                      onClick={() => onViewLLMLogs(message.id)}
                      className="qt-chat-message-action-icon"
                      title="View LLM request/response logs"
                    >
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </button>
                  )}
                  {/* Resend (user messages only) */}
                  {message.role === 'USER' && showResendButton && (
                    <button
                      onClick={() => onResend(message)}
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
                        onClick={() => onSwitchSwipe(message.swipeGroupId!, 'prev')}
                        disabled={swipeState.current === 0}
                        className="qt-chat-message-action-icon disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous response"
                      >
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="qt-text-xs px-1">
                        {swipeState.current + 1}/{swipeState.total}
                      </span>
                      <button
                        onClick={() => onSwitchSwipe(message.swipeGroupId!, 'next')}
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
                <div className="qt-chat-message-action-timestamp flex items-center gap-2">
                  <span>{formatMessageTime(message.createdAt)}</span>
                  {tokenDisplaySettings?.showPerMessageTokens && (message.promptTokens || message.completionTokens) && (
                    <TokenBadge
                      promptTokens={message.promptTokens}
                      completionTokens={message.completionTokens}
                      totalTokens={message.tokenCount}
                      showTokens={tokenDisplaySettings.showPerMessageTokens}
                      showCost={tokenDisplaySettings.showPerMessageCost}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Desktop hover action buttons */}
        {!isEditing && (
          <div className="absolute -top-8 right-0 flex gap-1 bg-muted rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity qt-chat-desktop-hover-actions">
            <button
              onClick={() => onCopyContent(message.content)}
              className="p-1 text-muted-foreground hover:text-foreground"
              title="Copy message"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={() => onToggleSourceView(message.id)}
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
            {hasLLMLogs && message.role === 'ASSISTANT' && onViewLLMLogs && (
              <button
                onClick={() => onViewLLMLogs(message.id)}
                className="p-1 text-muted-foreground hover:text-foreground"
                title="View LLM logs"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Desktop message actions */}
        {!isEditing && (
          <div className="flex gap-2 mt-1 text-sm qt-chat-message-desktop-actions">
            {message.role === 'USER' && (
              <>
                <button
                  onClick={() => onEditStart(message)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(message.id)}
                  className="text-destructive hover:text-destructive/80"
                >
                  Delete
                </button>
                {showResendButton && (
                  <button
                    onClick={() => onResend(message)}
                    className="text-warning hover:text-warning/80"
                    title="Resend this message (deletes blank responses and restores to input)"
                  >
                    Resend
                  </button>
                )}
                {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
                  <button
                    onClick={() => onReattribute(message.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Re-attribute
                  </button>
                )}
              </>
            )}

            {message.role === 'ASSISTANT' && (
              <>
                <button
                  onClick={() => onDelete(message.id)}
                  className="text-destructive hover:text-destructive/80"
                >
                  Delete
                </button>
                <button
                  onClick={() => onGenerateSwipe(message.id)}
                  className="text-info hover:text-info/80"
                >
                  Regenerate
                </button>
                {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
                  <button
                    onClick={() => onReattribute(message.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Re-attribute
                  </button>
                )}

                {/* Swipe controls */}
                {swipeState && swipeState.total > 1 && (
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => onSwitchSwipe(message.swipeGroupId!, 'prev')}
                      disabled={swipeState.current === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >

                    </button>
                    <span className="qt-text-xs">
                      {swipeState.current + 1} / {swipeState.total}
                    </span>
                    <button
                      onClick={() => onSwitchSwipe(message.swipeGroupId!, 'next')}
                      disabled={swipeState.current === swipeState.total - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >

                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {/* Desktop avatar - user (right side) */}
      {message.role === 'USER' && shouldShowAvatars && messageAvatar && (
        <div className="flex-shrink-0 qt-chat-desktop-avatar">
          <Avatar
            name={messageAvatar.name}
            title={messageAvatar.title}
            src={messageAvatar}
            size="chat"
            showName
            showTitle
            className="flex flex-col items-center w-32 gap-1"
          />
        </div>
      )}
    </div>
  )
}

/**
 * Memoized MessageRow component to prevent unnecessary re-renders.
 * Only re-renders when message content, edit state, or relevant UI state changes.
 */
export const MessageRow = memo(MessageRowInner, (prev, next) => {
  // Return true if props are equal (skip re-render)

  // Core message identity and content
  if (prev.message.id !== next.message.id) return false
  if (prev.message.content !== next.message.content) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.messageIndex !== next.messageIndex) return false

  // Edit state
  if (prev.isEditing !== next.isEditing) return false
  if (prev.isEditing && prev.editContent !== next.editContent) return false

  // View source toggle (compare Set membership for this message)
  if (prev.viewSourceMessageIds.has(prev.message.id) !== next.viewSourceMessageIds.has(next.message.id)) return false

  // Swipe state
  if (prev.swipeState?.current !== next.swipeState?.current) return false
  if (prev.swipeState?.total !== next.swipeState?.total) return false

  // Display toggles
  if (prev.showResendButton !== next.showResendButton) return false
  if (prev.shouldShowAvatars !== next.shouldShowAvatars) return false

  // Streaming/generation state
  if (prev.streaming !== next.streaming) return false
  if (prev.waitingForResponse !== next.waitingForResponse) return false
  if (prev.isPaused !== next.isPaused) return false

  // Multi-char specific state
  if (prev.isMultiChar !== next.isMultiChar) return false
  if (prev.turnState.currentTurnParticipantId !== next.turnState.currentTurnParticipantId) return false

  // Avatar info (compare by value since it's an object)
  if (prev.messageAvatar?.name !== next.messageAvatar?.name) return false
  if (prev.messageAvatar?.avatarUrl !== next.messageAvatar?.avatarUrl) return false

  // Rendering patterns (reference equality is fine - they're stable)
  if (prev.renderingPatterns !== next.renderingPatterns) return false
  if (prev.dialogueDetection !== next.dialogueDetection) return false

  // Force render flag (for last few messages to avoid lazy loading)
  if (prev.forceRender !== next.forceRender) return false

  // Attachments (check if array changed)
  const prevAttachments = prev.message.attachments || []
  const nextAttachments = next.message.attachments || []
  if (prevAttachments.length !== nextAttachments.length) return false

  // Tool calls (check if array changed)
  const prevToolCalls = prev.message.toolCalls || []
  const nextToolCalls = next.message.toolCalls || []
  if (prevToolCalls.length !== nextToolCalls.length) return false

  // Pre-rendered HTML
  if (prev.message.renderedHtml !== next.message.renderedHtml) return false

  // Character data
  if (prev.character?.id !== next.character?.id) return false

  // Token display settings
  if (prev.tokenDisplaySettings?.showPerMessageTokens !== next.tokenDisplaySettings?.showPerMessageTokens) return false
  if (prev.tokenDisplaySettings?.showPerMessageCost !== next.tokenDisplaySettings?.showPerMessageCost) return false

  // Token data (if display is enabled)
  if (prev.tokenDisplaySettings?.showPerMessageTokens || next.tokenDisplaySettings?.showPerMessageTokens) {
    if (prev.message.promptTokens !== next.message.promptTokens) return false
    if (prev.message.completionTokens !== next.message.completionTokens) return false
  }

  // LLM logs availability
  if (prev.hasLLMLogs !== next.hasLLMLogs) return false

  // Danger flags
  const prevDangerFlags = prev.message.dangerFlags || []
  const nextDangerFlags = next.message.dangerFlags || []
  if (prevDangerFlags.length !== nextDangerFlags.length) return false
  if (prev.dangerousContentSettings?.displayMode !== next.dangerousContentSettings?.displayMode) return false
  if (prev.dangerousContentSettings?.showWarningBadges !== next.dangerousContentSettings?.showWarningBadges) return false

  // Props are equal, skip re-render
  return true
})
