'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

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
  userCharacter?: {
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
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  _count?: {
    messages: number
    memories?: number
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
    memoryCount: chat._count?.memories ?? 0,
    // No participants for character view - avatars not shown
    participants: [],
    tags: chat.tags,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    project: chat.project || null,
    userCharacter: chat.userCharacter || null,
    previewText: getPreviewText(chat.messages),
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    isDangerousChat: chat.isDangerousChat === true,
    scriptoriumStatus: chat.scriptoriumStatus || 'none',
  }
}

export function CharacterConversationsTab({ characterId, characterName, refreshKey }: CharacterConversationsTabProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingArchive, setRefreshingArchive] = useState(false)
  const { shouldHideByIds, hideDangerousChats } = useQuickHide()
  const visibleChats = useMemo(
    () => chats.filter(chat => {
      if (hideDangerousChats && chat.isDangerousChat) return false
      return !shouldHideByIds((chat.tags || []).map(ct => ct.tag.id))
    }),
    [chats, shouldHideByIds, hideDangerousChats]
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
    const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter(c => c.id !== chatId))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  const handleReextractMemories = async (chatId: string) => {
    const confirmed = await showConfirmation(
      'This will delete all existing memories from this chat and re-extract them from the conversation. Are you sure?'
    )
    if (!confirmed) return

    try {
      // Delete existing memories for this chat
      await fetch(`/api/v1/memories?chatId=${chatId}`, { method: 'DELETE' })

      // Queue new memory extraction
      const res = await fetch(`/api/v1/chats/${chatId}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          characterName,
        }),
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
        notifyQueueChange()
      } else {
        showErrorToast(data.error || 'Failed to queue memory extraction')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to re-extract memories')
    }
  }

  // Scriptorium status polling: re-fetch chats while render/embed is in progress
  const scriptoriumPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scriptoriumPollChatIdRef = useRef<string | null>(null)

  const stopScriptoriumPolling = useCallback(() => {
    if (scriptoriumPollRef.current) {
      clearInterval(scriptoriumPollRef.current)
      scriptoriumPollRef.current = null
    }
    scriptoriumPollChatIdRef.current = null
  }, [])

  // Clean up polling on unmount
  useEffect(() => {
    return () => stopScriptoriumPolling()
  }, [stopScriptoriumPolling])

  const handleRenderConversation = async (chatId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=render-conversation`, {
        method: 'POST',
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast('Conversation rendering queued')
        notifyQueueChange()
        // Refresh immediately
        setPage(0)
        fetchChats(0, searchQuery, false)

        // Start polling to track status updates (red → amber → green)
        if (!scriptoriumPollRef.current) {
          scriptoriumPollChatIdRef.current = chatId
          scriptoriumPollRef.current = setInterval(async () => {
            await fetchChats(0, searchQuery, false)
            // Check if the target chat has reached 'embedded' status
            const targetId = scriptoriumPollChatIdRef.current
            if (targetId) {
              setChats(currentChats => {
                const target = currentChats.find(c => c.id === targetId)
                if (target?.scriptoriumStatus === 'embedded') {
                  stopScriptoriumPolling()
                }
                return currentChats
              })
            }
          }, 5000)
        }
      } else {
        showErrorToast(data.error || 'Failed to queue conversation rendering')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to render conversation')
    }
  }

  const handleRefreshArchive = async () => {
    setRefreshingArchive(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=refresh-archive`, {
        method: 'POST',
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast(`Queued re-render for ${data.queued} of ${data.total} conversations`)
        notifyQueueChange()
        // Start polling to track status updates
        if (!scriptoriumPollRef.current) {
          scriptoriumPollRef.current = setInterval(async () => {
            await fetchChats(0, searchQuery, false)
          }, 5000)
          // Stop after 60 seconds to avoid infinite polling
          setTimeout(() => stopScriptoriumPolling(), 60000)
        }
      } else {
        showErrorToast(data.error || 'Failed to refresh conversation archive')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to refresh conversation archive')
    } finally {
      setRefreshingArchive(false)
    }
  }

  if (loading && chats.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 qt-text-secondary">
          <div className="h-5 w-5 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
          Loading conversations...
        </div>
      </div>
    )
  }

  if (error && chats.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="qt-text-destructive">{error}</p>
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
            className="qt-input pl-10"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button
          onClick={handleRefreshArchive}
          disabled={refreshingArchive || chats.length === 0}
          title="Re-render and re-embed all conversations for this character"
          className="qt-button-ghost text-xs whitespace-nowrap"
        >
          <svg className={`w-3.5 h-3.5 ${refreshingArchive ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshingArchive ? 'Refreshing...' : 'Refresh Conversation Archive'}
        </button>
        <Link
          href={`/aurora/${characterId}/view?action=chat`}
          className="flex items-center gap-2 px-4 py-2 qt-button-primary font-medium text-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </Link>
      </div>

      {/* Conversations List */}
      {visibleChats.length === 0 ? (
        <div className="text-center py-12 border border-dashed qt-border-default rounded-lg">
          <svg
            className="mx-auto h-12 w-12 qt-text-secondary"
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
              href={`/aurora/${characterId}/view?action=chat`}
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
              onReextractMemories={handleReextractMemories}
              onRenderConversation={handleRenderConversation}
              characterName={characterName}
            />
          ))}

          {/* Load more trigger */}
          <div ref={loadMoreRef} className="py-4">
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 qt-text-secondary">
                <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
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
