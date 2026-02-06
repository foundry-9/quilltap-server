'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

interface Chat {
  id: string
  title: string | null
  updatedAt: string
  lastMessageAt?: string
  character?: {
    id: string
    name: string
  }
  persona?: {
    id: string
    name: string
    title?: string | null
  } | null
  project?: {
    id: string
    name: string
  } | null
  storyBackground?: {
    id: string
    filepath: string
  } | null
  messages: Message[]
  tags?: Array<{
    tag: {
      id: string
      name: string
    }
  }>
  isDangerousChat?: boolean
  _count?: {
    messages: number
  }
}

interface CharacterConversationsTabProps {
  characterId: string
  characterName: string
  /** Optional key to trigger data refresh when changed */
  refreshKey?: number
}

const CHATS_PER_PAGE = 10

/**
 * Get preview text from messages
 */
function getPreviewText(messages: Message[]): string | null {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return null
  const content = lastMessage.content.replace(/\n/g, ' ').trim()
  return content.length > 100 ? content.slice(0, 100) + '...' : content
}

/**
 * Transform API chat data to ChatCardData format
 */
function transformChatToCardData(chat: Chat): ChatCardData {
  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count?.messages ?? chat.messages.length,
    // No participants for character view - avatars not shown
    participants: [],
    tags: chat.tags,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    project: chat.project || null,
    persona: chat.persona || null,
    previewText: getPreviewText(chat.messages),
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    isDangerousChat: chat.isDangerousChat === true,
  }
}

export function CharacterConversationsTab({ characterId, characterName, refreshKey }: CharacterConversationsTabProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const { shouldHideByIds } = useQuickHide()
  const visibleChats = useMemo(
    () => chats.filter(chat => !shouldHideByIds((chat.tags || []).map(ct => ct.tag.id))),
    [chats, shouldHideByIds]
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const fetchChats = useCallback(async (pageNum: number, search: string, append: boolean = false) => {
    if (pageNum === 0) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const url = new URL(`/api/v1/characters/${characterId}`, window.location.origin)
      url.searchParams.set('action', 'chats')
      url.searchParams.set('limit', String(CHATS_PER_PAGE))
      url.searchParams.set('offset', String(pageNum * CHATS_PER_PAGE))
      if (search) {
        url.searchParams.set('search', search)
      }

      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to fetch conversations')

      const data = await res.json()
      const newChats = data.chats || data || []

      if (append) {
        setChats(prev => [...prev, ...newChats])
      } else {
        setChats(newChats)
      }

      setHasMore(newChats.length === CHATS_PER_PAGE)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [characterId])

  // Initial load and refresh when refreshKey changes
  useEffect(() => {
    setPage(0)
    fetchChats(0, searchQuery, false)
  }, [fetchChats, searchQuery, refreshKey])

  // Set up infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          const nextPage = page + 1
          setPage(nextPage)
          fetchChats(nextPage, searchQuery, true)
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, loading, loadingMore, page, searchQuery, fetchChats])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setPage(0)
  }

  const deleteChat = async (chatId: string) => {
    const confirmed = confirm('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter(c => c.id !== chatId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  if (loading && chats.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-r-transparent"></div>
          Loading conversations...
        </div>
      </div>
    )
  }

  if (error && chats.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => fetchChats(0, searchQuery, false)}
          className="mt-4 text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={handleSearch}
            className="w-full pl-10 pr-4 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <Link
          href={`/characters/${characterId}/view?action=chat`}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </Link>
      </div>

      {/* Conversations List */}
      {visibleChats.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="mt-2 qt-text-small">
            {searchQuery
              ? `No conversations found matching "${searchQuery}"`
              : `No conversations with ${characterName} yet`
            }
          </p>
          {!searchQuery && (
            <Link
              href={`/characters/${characterId}/view?action=chat`}
              className="mt-4 inline-flex items-center gap-2 text-primary hover:underline"
            >
              Start your first conversation
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={transformChatToCardData(chat)}
              showAvatars={false}
              showProject={true}
              showPreview={true}
              useRelativeDates={true}
              actionType="delete"
              onDelete={deleteChat}
              characterName={characterName}
            />
          ))}

          {/* Load more trigger */}
          <div ref={loadMoreRef} className="py-4">
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent"></div>
                Loading more...
              </div>
            )}
            {!hasMore && visibleChats.length > 0 && (
              <p className="text-center qt-text-small">
                No more conversations
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
