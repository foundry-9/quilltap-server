'use client'

import { Icon } from '@/components/ui/icon'
import type { Message } from '../../types'
import type { ParticipantData } from '@/components/chat/ParticipantCard'

interface MessageDesktopActionsProps {
  message: Message
  viewSourceMessageIds: Set<string>
  swipeState: { current: number; total: number } | null
  showResendButton: boolean
  hasLLMLogs?: boolean
  participantData: ParticipantData[]
  onCopyContent: (content: string) => void
  onToggleSourceView: (messageId: string) => void
  onViewLLMLogs?: (messageId: string) => void
  onEditStart: (message: Message) => void
  onDelete: (messageId: string) => void
  onResend: (message: Message) => void
  onReattribute?: (messageId: string) => void
  onGenerateSwipe: (messageId: string) => void
  onSwitchSwipe: (swipeGroupId: string, direction: 'prev' | 'next') => void
}

/**
 * Desktop-only message affordances rendered when the row is not being edited:
 * the hover toolbar above the bubble (copy / source / LLM logs) and the row of
 * text actions below it (edit, delete, resend, regenerate, re-attribute, swipe).
 */
export function MessageDesktopActions({
  message,
  viewSourceMessageIds,
  swipeState,
  showResendButton,
  hasLLMLogs,
  participantData,
  onCopyContent,
  onToggleSourceView,
  onViewLLMLogs,
  onEditStart,
  onDelete,
  onResend,
  onReattribute,
  onGenerateSwipe,
  onSwitchSwipe,
}: MessageDesktopActionsProps) {
  return (
    <>
      {/* Desktop hover action buttons */}
      <div className="absolute -top-8 right-0 flex gap-1 qt-bg-muted rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity qt-chat-desktop-hover-actions">
        <button
          onClick={() => onCopyContent(message.content)}
          className="p-1 qt-text-secondary hover:text-foreground"
          title="Copy message"
        >
          <Icon name="copy" className="w-4 h-4" />
        </button>
        <button
          onClick={() => onToggleSourceView(message.id)}
          className="p-1 qt-text-secondary hover:text-foreground"
          title={viewSourceMessageIds.has(message.id) ? 'View rendered' : 'View source'}
        >
          {viewSourceMessageIds.has(message.id) ? (
            <Icon name="eye" className="w-4 h-4" />
          ) : (
            <Icon name="code" className="w-4 h-4" />
          )}
        </button>
        {hasLLMLogs && message.role === 'ASSISTANT' && onViewLLMLogs && (
          <button
            onClick={() => onViewLLMLogs(message.id)}
            className="p-1 qt-text-secondary hover:text-foreground"
            title="View LLM logs"
          >
            <Icon name="cpu" className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Desktop message actions */}
      <div className="flex gap-2 mt-1 text-sm qt-chat-message-desktop-actions">
        {message.role === 'USER' && (
          <>
            <button
              onClick={() => onEditStart(message)}
              className="qt-text-secondary hover:text-foreground"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(message.id)}
              className="qt-text-destructive hover:qt-text-destructive/80"
            >
              Delete
            </button>
            {showResendButton && (
              <button
                onClick={() => onResend(message)}
                className="qt-text-warning hover:qt-text-warning/80"
                title="Resend this message (deletes blank responses and restores to input)"
              >
                Resend
              </button>
            )}
            {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
              <button
                onClick={() => onReattribute(message.id)}
                className="qt-text-secondary hover:text-foreground"
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
              className="qt-text-destructive hover:qt-text-destructive/80"
            >
              Delete
            </button>
            <button
              onClick={() => onGenerateSwipe(message.id)}
              className="qt-text-info hover:qt-text-info/80"
            >
              Regenerate
            </button>
            {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
              <button
                onClick={() => onReattribute(message.id)}
                className="qt-text-secondary hover:text-foreground"
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
                  className="qt-text-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >

                </button>
                <span className="qt-text-xs">
                  {swipeState.current + 1} / {swipeState.total}
                </span>
                <button
                  onClick={() => onSwitchSwipe(message.swipeGroupId!, 'next')}
                  disabled={swipeState.current === swipeState.total - 1}
                  className="qt-text-secondary hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >

                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
