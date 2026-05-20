'use client'

/**
 * ChatCard - Unified chat list item component
 *
 * Used across multiple pages to display chat items in a consistent way:
 * - /chats - Main chats list
 * - /projects/[id] - Project detail page chats section
 * - /characters/[id]/view - Character conversations tab
 *
 * Configure via props to show/hide features based on context.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TagDisplay } from '@/components/tags/tag-display'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import AvatarStack from '@/components/ui/AvatarStack'
import { formatChatListDate } from '@/lib/format-time'
import { CloseIcon } from '@/components/ui/icons'

// ============================================================================
// Types
// ============================================================================

export interface ChatCardParticipant {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImageId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
}

export interface ChatCardTag {
  tag: {
    id: string
    name: string
  }
}

export interface ChatCardProject {
  id: string
  name: string
  color?: string | null
}

export interface ChatCardUserCharacter {
  id: string
  name: string
  title?: string | null
}

export interface ChatCardData {
  id: string
  title: string | null
  messageCount: number
  /** Number of memories associated with this chat */
  memoryCount?: number
  participants: ChatCardParticipant[]
  tags?: ChatCardTag[]
  updatedAt: string
  lastMessageAt?: string
  project?: ChatCardProject | null
  userCharacter?: ChatCardUserCharacter | null
  /** Last message preview text (optional) */
  previewText?: string | null
  /** Story background image URL - displayed instead of avatars when present */
  storyBackgroundUrl?: string | null
  /** Whether this chat has been classified as dangerous */
  isDangerousChat?: boolean
  /** Scriptorium rendering status: none = not rendered, rendered = markdown only, embedded = fully indexed */
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
}

export interface ChatCardProps {
  chat: ChatCardData
  /** Show avatar stack - default true */
  showAvatars?: boolean
  /** Show project indicator - default true */
  showProject?: boolean
  /** Show message preview text - default false */
  showPreview?: boolean
  /** Use relative date formatting (Today, Yesterday, etc.) - default false */
  useRelativeDates?: boolean
  /** Action type: 'delete' permanently deletes, 'remove' just unlinks from project */
  actionType?: 'delete' | 'remove'
  /** Callback for delete action */
  onDelete?: (chatId: string) => void
  /** Callback for remove action (unlink from project) */
  onRemove?: (chatId: string) => void
  /** Callback for memory re-extraction action */
  onReextractMemories?: (chatId: string) => void
  /** Callback for Scriptorium re-render action */
  onRenderConversation?: (chatId: string) => void
  /** Whether this card should be highlighted (e.g., newly imported) */
  highlighted?: boolean
  /** Ref to forward to the card element */
  cardRef?: React.Ref<HTMLDivElement>
  /** Context for character view - provides fallback title */
  characterName?: string
}

// ============================================================================
// Icons
// ============================================================================

function FolderIcon({ className, color }: { className?: string; color?: string | null }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={color || 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  )
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format participant names for display
 */
function formatParticipantNames(participants: ChatCardParticipant[]): string {
  if (participants.length === 0) return 'Unknown'
  if (participants.length === 1) return participants[0].name
  if (participants.length === 2) return `${participants[0].name} + ${participants[1].name}`
  return participants.map(p => p.name).join(' + ')
}

// ============================================================================
// Component
// ============================================================================

export function ChatCard({
  chat,
  showAvatars = true,
  showProject = true,
  showPreview = false,
  useRelativeDates = false,
  actionType = 'delete',
  onDelete,
  onRemove,
  onReextractMemories,
  onRenderConversation,
  highlighted = false,
  cardRef,
  characterName,
}: ChatCardProps) {
  const router = useRouter()
  const { formatCharacterName } = useUserCharacterDisplayName()

  const participantNames = formatParticipantNames(chat.participants)
  const dateStr = formatChatListDate(chat.lastMessageAt || chat.updatedAt, useRelativeDates)
  const displayTitle = chat.title || (characterName ? `Chat with ${characterName}` : 'Untitled Chat')

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on a button or link
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a[href]')) {
      return
    }
    router.push(`/salon/${chat.id}`)
  }

  const handleAction = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (actionType === 'delete' && onDelete) {
      onDelete(chat.id)
    } else if (actionType === 'remove' && onRemove) {
      onRemove(chat.id)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      router.push(`/salon/${chat.id}`)
    }
  }

  return (
    <div
      ref={cardRef}
      className="qt-entity-card chat-card relative cursor-pointer hover:qt-bg-surface-alt transition-colors"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Highlight animation arrow for imported chats */}
      {highlighted && (
        <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 chat-card-highlight-arrow">
          <span className="text-6xl qt-text-warning font-black" style={{ textShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}>←</span>
        </div>
      )}

      <div className="flex items-stretch justify-between gap-4">
        <div className="flex items-stretch flex-1 gap-4">
          {/* Story background thumbnail (preferred) or Avatar stack */}
          {showAvatars && chat.storyBackgroundUrl ? (
            <div className="flex-shrink-0 self-stretch w-24 min-h-[4rem] max-h-32 rounded-lg overflow-hidden qt-bg-muted">
              <img
                src={chat.storyBackgroundUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ) : showAvatars && chat.participants.length > 0 ? (
            <AvatarStack entities={chat.participants} size="lg" />
          ) : null}

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="qt-card-title truncate">
                {displayTitle}
              </h3>
              <span className="chat-card__badge inline-flex items-center gap-1 rounded-full qt-bg-primary/10 px-2.5 py-0.5 qt-body-sm font-semibold flex-shrink-0" title="Messages">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {chat.messageCount}
              </span>
              {chat.memoryCount !== undefined && (
                <button
                  type="button"
                  className="chat-card__badge inline-flex items-center gap-1 rounded-full qt-bg-primary/10 px-2.5 py-0.5 qt-body-sm font-semibold flex-shrink-0 hover:qt-bg-primary/20 transition-colors cursor-pointer"
                  title="Memories — click to delete and re-extract"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onReextractMemories?.(chat.id)
                  }}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  {chat.memoryCount}
                </button>
              )}
              {chat.scriptoriumStatus !== undefined && (
                <button
                  type="button"
                  className={`chat-card__badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 qt-body-sm font-semibold flex-shrink-0 transition-colors cursor-pointer ${
                    chat.scriptoriumStatus === 'embedded'
                      ? 'qt-bg-success/10 qt-text-success hover:qt-bg-success/20'
                      : chat.scriptoriumStatus === 'rendered'
                      ? 'qt-bg-warning/10 qt-text-warning hover:qt-bg-warning/20'
                      : 'bg-destructive/10 qt-text-destructive hover:bg-destructive/20'
                  }`}
                  title={
                    chat.scriptoriumStatus === 'embedded'
                      ? 'Scriptorium: Rendered and embedded — click to re-render'
                      : chat.scriptoriumStatus === 'rendered'
                      ? 'Scriptorium: Rendered but not fully embedded — click to re-render'
                      : 'Scriptorium: Not yet rendered — click to render'
                  }
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRenderConversation?.(chat.id)
                  }}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </button>
              )}
              {chat.isDangerousChat && (
                <span className="qt-text-destructive text-sm flex-shrink-0" title="Flagged as dangerous" aria-label="Flagged as dangerous">*</span>
              )}
            </div>

            {/* Metadata row */}
            <p className="qt-text-small qt-text-secondary">
              {showAvatars && participantNames}
              {chat.userCharacter && (
                <>
                  {showAvatars && ' with '}
                  {!showAvatars && 'with '}
                  {formatCharacterName(chat.userCharacter)}
                </>
              )}
              {(showAvatars || chat.userCharacter) && ' \u2022 '}
              {dateStr}
            </p>

            {/* Preview text */}
            {showPreview && chat.previewText && (
              <p className="qt-text-small qt-text-secondary line-clamp-1 mt-2">
                {chat.previewText}
              </p>
            )}

            {/* Project & Tags row */}
            {((showProject && chat.project) || (chat.tags && chat.tags.length > 0)) && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {showProject && chat.project && (
                  <Link
                    href={`/prospero/${chat.project.id}`}
                    className="inline-flex items-center gap-1 qt-text-xs px-2 py-1 rounded-full qt-bg-muted hover:qt-bg-surface-alt transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FolderIcon className="w-3 h-3" color={chat.project.color} />
                    <span>{chat.project.name}</span>
                  </Link>
                )}
                {chat.tags && chat.tags.length > 0 && (
                  <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action button */}
        {(onDelete || onRemove) && (
          <div className="flex items-center">
            <button
              onClick={handleAction}
              className={
                actionType === 'delete'
                  ? 'chat-card__action inline-flex h-10 w-10 items-center justify-center rounded-lg bg-destructive qt-text-destructive-foreground shadow transition hover:qt-bg-destructive/90'
                  : 'inline-flex h-10 w-10 items-center justify-center rounded-lg qt-bg-muted qt-text-secondary shadow transition hover:qt-text-destructive hover:qt-bg-destructive/10'
              }
              title={actionType === 'delete' ? 'Delete chat' : 'Remove from project'}
            >
              {actionType === 'delete' ? (
                <TrashIcon className="w-5 h-5" />
              ) : (
                <CloseIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// CSS Animation (add to parent component or global styles)
// ============================================================================

/**
 * Add this CSS to the parent component for highlight animation:
 *
 * @keyframes chatCardHighlight {
 *   0% { opacity: 1; transform: translateX(0); }
 *   50% { opacity: 1; transform: translateX(10px); }
 *   100% { opacity: 0; transform: translateX(10px); }
 * }
 * .chat-card-highlight-arrow {
 *   animation: chatCardHighlight 2.5s ease-out forwards;
 * }
 */
