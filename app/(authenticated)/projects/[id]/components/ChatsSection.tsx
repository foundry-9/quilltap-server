'use client'

/**
 * Chats Section
 *
 * Infinite scrolling list of project chats.
 * Styled identically to the /chats page chat cards.
 * Supports quick-hide filtering and displays tags.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { clientLogger } from '@/lib/client-logger'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useContentWidthOptional } from '@/components/providers/content-width-provider'
import { TagDisplay } from '@/components/tags/tag-display'
import AvatarStack from '@/components/ui/AvatarStack'
import type { ProjectChat } from '../types'

interface ChatsSectionProps {
  projectId: string
  chats: ProjectChat[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  onLoadMore: () => void
  onRemoveChat: (chatId: string) => void
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function ChatsSection({
  projectId,
  chats,
  loading,
  loadingMore,
  hasMore,
  total,
  onLoadMore,
  onRemoveChat,
}: ChatsSectionProps) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const { shouldHideByIds } = useQuickHide()
  const contentWidth = useContentWidthOptional()
  const isWide = contentWidth?.isWide ?? false

  // Filter chats based on quick-hide rules
  const visibleChats = useMemo(() => {
    return chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant character tags
      const allTagIds: string[] = (chat.tags || []).map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.tags) {
          allTagIds.push(...participant.tags)
        }
      }

      return !shouldHideByIds(allTagIds)
    })
  }, [chats, shouldHideByIds])

  useEffect(() => {
    clientLogger.debug('ChatsSection: rendered', {
      chatCount: chats.length,
      visibleCount: visibleChats.length,
      total,
      hasMore,
      loading,
      loadingMore,
    })
  }, [chats.length, visibleChats.length, total, hasMore, loading, loadingMore])

  // Set up intersection observer for infinite scroll
  const setupObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          clientLogger.debug('ChatsSection: load more triggered by intersection')
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }
  }, [hasMore, loadingMore, onLoadMore])

  useEffect(() => {
    setupObserver()
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [setupObserver])

  // Format participant names for display
  const formatParticipantNames = (participants: ProjectChat['participants']): string => {
    if (participants.length === 0) return 'Unknown'
    if (participants.length === 1) return participants[0].name
    if (participants.length === 2) return `${participants[0].name} + ${participants[1].name}`
    return participants.map(p => p.name).join(' + ')
  }

  if (loading) {
    return (
      <div className="mt-8">
        <h2 className="qt-heading-3 text-foreground mb-4">Chats</h2>
        <div className="flex items-center justify-center py-12 qt-text-secondary">
          <p>Loading chats...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="qt-heading-3 text-foreground">
          Chats
          {total > 0 && (
            <span className="ml-2 text-base font-normal qt-text-secondary">({visibleChats.length})</span>
          )}
        </h2>
        <Link
          href={`/chats/new?projectId=${projectId}`}
          className="qt-button qt-button-primary"
        >
          New Chat
        </Link>
      </div>

      {/* Empty state */}
      {visibleChats.length === 0 ? (
        <div className="rounded-2xl qt-border border-dashed qt-bg-card px-8 py-12 text-center shadow-sm">
          <p className="mb-4 text-lg qt-text-secondary">
            {chats.length === 0 ? 'No chats in this project yet.' : 'No visible chats (some may be hidden).'}
          </p>
          <Link
            href={`/chats/new?projectId=${projectId}`}
            className="font-medium qt-text-primary hover:opacity-80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <>
          {/* Chat cards - 2 columns when full-width is on, otherwise 1 */}
          <div className={`grid gap-4 ${isWide ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            {visibleChats.map((chat) => {
              // Participants already have the correct shape for AvatarStack
              // (id, name, avatarUrl, defaultImage)
              const avatarEntities = chat.participants

              return (
                <Link
                  key={chat.id}
                  href={`/chats/${chat.id}`}
                  className="qt-entity-card relative block hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-stretch justify-between gap-4">
                    <div className="flex items-stretch flex-1 gap-4">
                      <AvatarStack entities={avatarEntities} size="lg" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-xl font-semibold text-foreground">
                            {chat.title || 'Untitled Chat'}
                          </h3>
                          <span className="inline-flex items-center rounded-full qt-bg-primary/10 px-3 py-1 text-sm font-semibold qt-text-primary">
                            {chat.messageCount}
                          </span>
                        </div>
                        <p className="qt-text-small qt-text-secondary">
                          {formatParticipantNames(chat.participants)}
                          {' \u2022 '}
                          {new Date(chat.updatedAt).toLocaleDateString()}
                        </p>
                        {chat.tags && chat.tags.length > 0 && (
                          <div className="mt-2">
                            <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Remove button */}
                    <div className="flex items-center">
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onRemoveChat(chat.id)
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg qt-bg-muted qt-text-secondary shadow transition hover:qt-text-destructive hover:qt-bg-destructive/10"
                        title="Remove from project"
                      >
                        <CloseIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {/* Load more indicator / trigger */}
          <div
            ref={loadMoreRef}
            className="py-8 flex items-center justify-center"
          >
            {loadingMore ? (
              <p className="qt-text-secondary">Loading more chats...</p>
            ) : hasMore ? (
              <button
                onClick={onLoadMore}
                className="qt-button qt-button-ghost"
              >
                Load more
              </button>
            ) : visibleChats.length > 0 ? (
              <p className="qt-text-xs qt-text-secondary">All chats loaded</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
