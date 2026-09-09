'use client'

import { useCallback, useState } from 'react'
import { useRealtimeTopic } from '@/hooks/useRealtime'
import type { Chat, ChatSettings, Message } from '../types'

export interface SwipeState {
  current: number
  total: number
  messages: Message[]
}

export function useChatData(chatId: string) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [swipeStates, setSwipeStates] = useState<Record<string, SwipeState>>({})
  const [chatPhotoCount, setChatPhotoCount] = useState(0)
  const [chatMemoryCount, setChatMemoryCount] = useState(0)

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/chat', { cache: 'no-store' })
      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'Unable to read response body')
        throw new Error(`Failed to fetch chat settings: ${res.status} ${res.statusText} - ${errorBody}`)
      }
      const data = await res.json()
      setChatSettings(data)
    } catch (err) {
      console.error('Failed to fetch chat settings', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      // Use default settings if fetch fails
      setChatSettings({ id: '', userId: '', avatarDisplayMode: 'ALWAYS', avatarDisplayStyle: 'CIRCULAR', tagStyles: {}, createdAt: '', updatedAt: '' })
    }
  }, [])

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch chat')
      const data = await res.json()
      setChat(data.chat)

      const allMessages = data.chat.messages.filter((m: Message) => m.role !== 'SYSTEM')

      // Organize swipe groups
      const swipeGroups: Record<string, Message[]> = {}
      const displayMessages: Message[] = []
      const newSwipeStates: Record<string, SwipeState> = {}

      allMessages.forEach((msg: Message) => {
        if (msg.swipeGroupId) {
          if (!swipeGroups[msg.swipeGroupId]) {
            swipeGroups[msg.swipeGroupId] = []
          }
          swipeGroups[msg.swipeGroupId].push(msg)
        } else {
          displayMessages.push(msg)
        }
      })

      // For each swipe group, default to the newest variant (highest swipeIndex).
      // Regenerate appends a new variant, so showing the latest means a freshly
      // regenerated response is what you see — the original stays one swipe away.
      Object.entries(swipeGroups).forEach(([groupId, groupMessages]) => {
        const sorted = groupMessages.sort((a, b) => (a.swipeIndex || 0) - (b.swipeIndex || 0))
        const latestIndex = sorted.length - 1
        displayMessages.push(sorted[latestIndex])
        newSwipeStates[groupId] = {
          current: latestIndex,
          total: sorted.length,
          messages: sorted
        }
      })

      // Sort by creation time
      displayMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      setMessages(displayMessages)
      setSwipeStates(newSwipeStates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  const fetchChatPhotoCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=files`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const imageCount = (data.files || []).filter((f: { mimeType: string }) => f.mimeType.startsWith('image/')).length
        setChatPhotoCount(imageCount)
      }
    } catch (err) {
      console.error('Failed to fetch chat photo count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [chatId])

  const fetchChatMemoryCount = useCallback(async () => {
    try {
      // `no-store`, matching its siblings in this hook: a cached 200 would hand
      // back the stale count on the very refetch meant to correct it.
      const res = await fetch(`/api/v1/memories?chatId=${chatId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setChatMemoryCount(data.memoryCount || 0)
      }
    } catch (err) {
      console.error('Failed to fetch chat memory count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [chatId])

  // The count is read once at mount, and memories land minutes later — from
  // MEMORY_EXTRACTION and friends in the forked child, turn after turn. The
  // workspace keeps a hidden Salon tab mounted for the life of the session, so
  // without a path by which the server can say "this changed", the number
  // beside the Delete Memories button stays frozen at whatever was true when
  // the tab opened. It lives here rather than at the call site because this is
  // the hook that owns the count: a consumer cannot forget to subscribe.
  // `useRealtimeTopic` also fires on socket open, so a reconnect after a sleep
  // re-reads for free, and the offline fallback is the next mount — no poll.
  useRealtimeTopic('memories', fetchChatMemoryCount, chatId)

  return {
    chat,
    setChat,
    messages,
    setMessages,
    loading,
    error,
    chatSettings,
    setChatSettings,
    swipeStates,
    setSwipeStates,
    chatPhotoCount,
    setChatPhotoCount,
    chatMemoryCount,
    setChatMemoryCount,
    fetchChat,
    fetchChatSettings,
    fetchChatPhotoCount,
    fetchChatMemoryCount,
  }
}
